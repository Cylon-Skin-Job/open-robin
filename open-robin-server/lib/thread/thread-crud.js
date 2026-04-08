/**
 * Thread CRUD Handlers
 *
 * Extracted from ThreadWebSocketHandler.js — handles thread create, open,
 * open-daily, rename, delete, and copy-link operations.
 *
 * Uses a factory pattern so the coordinator can inject shared state (Maps)
 * and helper functions. All functions close over the same scope, which is
 * critical because handleThreadCreate and handleThreadOpenDaily both call
 * handleThreadOpen internally.
 */

const { v4: uuidv4 } = require('uuid');

/**
 * @param {object} deps
 * @param {Map} deps.wsState - Per-WS state map (shared with coordinator)
 * @param {Function} deps.sendThreadList - Send thread list to client
 * @param {Function} deps.closeCurrentThread - Close current thread session
 * @param {Map} deps.pendingReorderTimers - Pending reorder timers (shared with coordinator)
 * @param {number} deps.REORDER_DELAY_MS - Delay for thread list refresh
 */
function createCrudHandlers({ wsState, sendThreadList, closeCurrentThread, pendingReorderTimers, REORDER_DELAY_MS }) {

  /**
   * Generate a timestamped default thread name.
   * e.g. "New Chat 04/06 2:34 PM"
   * @returns {string}
   */
  function newChatName() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    let hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `New Chat ${month}/${day} ${hours}:${minutes}:${seconds} ${ampm}`;
  }

  /**
   * Handle thread:create message
   * @param {import('ws').WebSocket} ws
   * @param {object} msg
   * @param {string} [msg.name]
   * @param {string} [msg.harnessId] - Harness selection ('kimi' | 'robin')
   * @param {object} [msg.harnessConfig] - BYOK configuration
   */
  async function handleThreadCreate(ws, msg) {
    const state = wsState.get(ws);
    if (!state) {
      ws.send(JSON.stringify({ type: 'error', message: 'No panel set' }));
      return;
    }

    // Generate thread ID (will be Kimi session ID)
    const threadId = uuidv4();
    const name = msg.name || newChatName();
    const harnessId = msg.harnessId || 'kimi';

    try {
      // Create thread with harness selection
      const { threadId: createdId, entry } = await state.threadManager.createThread(threadId, name, {
        harnessId,
        harnessConfig: msg.harnessConfig
      });

      // Set the harness mode for this thread
      const { setThreadMode } = require('../harness/feature-flags');
      const mode = harnessId === 'kimi' ? 'legacy' : 'new';
      setThreadMode(threadId, mode);

      ws.send(JSON.stringify({
        type: 'thread:created',
        threadId: createdId,
        panel: state.viewName,
        thread: entry
      }));

      // Send updated list
      await sendThreadList(ws);

      // Automatically open the new thread
      await handleThreadOpen(ws, { threadId: createdId });

    } catch (err) {
      console.error('[ThreadWS] Create failed:', err);
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  }

  /**
   * Handle thread:open message
   * @param {import('ws').WebSocket} ws
   * @param {object} msg
   * @param {string} msg.threadId
   */
  async function handleThreadOpen(ws, msg) {
    const state = wsState.get(ws);
    if (!state) {
      ws.send(JSON.stringify({ type: 'error', message: 'No panel set' }));
      return;
    }

    const { threadId } = msg;
    const { threadManager } = state;

    // Check if thread exists
    const thread = await threadManager.getThread(threadId);
    if (!thread) {
      ws.send(JSON.stringify({ type: 'error', message: `Thread not found: ${threadId}` }));
      return;
    }

    // Close current thread if any
    if (state.threadId && state.threadId !== threadId) {
      await closeCurrentThread(ws);
    }

    // If this thread is already active elsewhere, that's fine (multiple tabs can view same thread)
    // But only one wire process per thread (managed by ThreadManager)

    state.threadId = threadId;

    // Set harness mode based on thread's stored preference
    const { setThreadMode } = require('../harness/feature-flags');
    const harnessId = thread.entry?.harnessId || 'kimi';
    const mode = harnessId === 'kimi' ? 'legacy' : 'new';
    setThreadMode(threadId, mode);

    // Mark as resumed in index
    await threadManager.index.markResumed(threadId);

    // Send thread history (both formats during transition)
    const history = await threadManager.getHistory(threadId);
    const richHistory = await threadManager.getRichHistory(threadId);

    // Extract context usage from the last exchange's metadata
    const exchanges = richHistory?.exchanges || [];
    const lastExchange = exchanges.length > 0 ? exchanges[exchanges.length - 1] : null;
    const contextUsage = lastExchange?.metadata?.contextUsage ?? null;

    console.log(`[ThreadWS] Opening thread ${threadId.slice(0,8)}, exchanges: ${exchanges.length}, lastExchange metadata:`, lastExchange?.metadata);
    console.log(`[ThreadWS] Sending contextUsage:`, contextUsage);

    ws.send(JSON.stringify({
      type: 'thread:opened',
      threadId,
      panel: state.viewName,
      thread: thread.entry,
      history: history?.messages || [],  // Legacy format
      exchanges: exchanges,  // Rich format with tool calls
      contextUsage  // Restore context usage from last exchange
    }));

    // Update MRU order immediately (so other views see it as recently used)
    await threadManager.index.touch(threadId);

    // Delay the thread list reorder by 3 seconds when just clicking a thread
    // (This gives the user time to see the thread before the list reorders)
    const existingTimer = pendingReorderTimers.get(ws);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      pendingReorderTimers.delete(ws);
      sendThreadList(ws).catch(err => {
        console.error('[ThreadWS] Delayed sendThreadList failed:', err);
      });
    }, REORDER_DELAY_MS);

    pendingReorderTimers.set(ws, timer);

    console.log(`[ThreadWS] Opened thread ${threadId} (panel: ${state.panelId}, harness: ${harnessId}) - reorder in ${REORDER_DELAY_MS}ms`);
  }

  /**
   * Handle thread:open-daily message
   *
   * Date-based session model: one thread per day, auto-selected.
   * - Computes today's date string (YYYY-MM-DD)
   * - If a thread exists for today, opens it (resumes Kimi session)
   * - If not, creates a new thread with the date as the threadId
   *
   * @param {import('ws').WebSocket} ws
   * @param {object} msg
   */
  async function handleThreadOpenDaily(ws, msg) {
    const state = wsState.get(ws);
    if (!state) {
      ws.send(JSON.stringify({ type: 'error', message: 'No panel set' }));
      return;
    }

    const { threadManager } = state;
    // Preserve the requesting panel so thread:opened is routed correctly.
    // If the message includes a panel (e.g., 'issues'), temporarily override
    // the viewName so handleThreadOpen sends the right panel name to the client.
    const originalViewName = state.viewName;
    if (msg.panel) {
      state.viewName = msg.panel;
    }

    // Today's date in local time as the thread ID
    const now = new Date();
    const todayId = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const existing = await threadManager.getThread(todayId);

    if (existing) {
      // Resume today's session
      console.log(`[ThreadWS] Daily thread exists: ${todayId}, resuming`);
      await handleThreadOpen(ws, { threadId: todayId });
    } else {
      // Create today's session
      console.log(`[ThreadWS] No daily thread for ${todayId}, creating`);
      try {
        await threadManager.createThread(todayId, todayId);

        ws.send(JSON.stringify({
          type: 'thread:created',
          threadId: todayId,
          panel: state.viewName,
          thread: { name: todayId, createdAt: now.toISOString(), messageCount: 0, status: 'active' }
        }));

        await handleThreadOpen(ws, { threadId: todayId });
      } catch (err) {
        console.error('[ThreadWS] Daily create failed:', err);
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
      }
    }

    // Restore original view name context
    if (msg.panel) {
      state.viewName = originalViewName;
    }
  }

  /**
   * Handle thread:rename message
   * @param {import('ws').WebSocket} ws
   * @param {object} msg
   * @param {string} msg.threadId
   * @param {string} msg.name
   */
  async function handleThreadRename(ws, msg) {
    const state = wsState.get(ws);
    if (!state) {
      ws.send(JSON.stringify({ type: 'error', message: 'No panel set' }));
      return;
    }

    const { threadId, name } = msg;

    try {
      const result = await state.threadManager.renameThread(threadId, name);
      if (!result) {
        ws.send(JSON.stringify({ type: 'error', message: `Thread not found: ${threadId}` }));
        return;
      }

      ws.send(JSON.stringify({
        type: 'thread:renamed',
        threadId,
        name
      }));

      await sendThreadList(ws);

    } catch (err) {
      console.error('[ThreadWS] Rename failed:', err);
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  }

  /**
   * Handle thread:delete message
   * @param {import('ws').WebSocket} ws
   * @param {object} msg
   * @param {string} msg.threadId
   */
  async function handleThreadDelete(ws, msg) {
    const state = wsState.get(ws);
    if (!state) {
      ws.send(JSON.stringify({ type: 'error', message: 'No panel set' }));
      return;
    }

    const { threadId } = msg;
    const { threadManager } = state;

    // If deleting current thread, close it first
    if (state.threadId === threadId) {
      await closeCurrentThread(ws);
      state.threadId = null;
    }

    try {
      const deleted = await threadManager.deleteThread(threadId);
      if (!deleted) {
        ws.send(JSON.stringify({ type: 'error', message: `Thread not found: ${threadId}` }));
        return;
      }

      ws.send(JSON.stringify({
        type: 'thread:deleted',
        threadId
      }));

      await sendThreadList(ws);

    } catch (err) {
      console.error('[ThreadWS] Delete failed:', err);
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  }

  /**
   * Handle thread:copyLink message
   * @param {import('ws').WebSocket} ws
   * @param {object} msg
   * @param {string} msg.threadId
   */
  async function handleThreadCopyLink(ws, msg) {
    const state = wsState.get(ws);
    if (!state) {
      ws.send(JSON.stringify({ type: 'error', message: 'No panel set' }));
      return;
    }

    const { threadId } = msg;

    try {
      const thread = await state.threadManager.getThread(threadId);
      if (!thread) {
        ws.send(JSON.stringify({ type: 'error', message: `Thread not found: ${threadId}` }));
        return;
      }

      ws.send(JSON.stringify({
        type: 'thread:link',
        threadId,
        filePath: thread.filePath
      }));

    } catch (err) {
      console.error('[ThreadWS] Copy link failed:', err);
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  }

  return {
    handleThreadCreate,
    handleThreadOpen,
    handleThreadOpenDaily,
    handleThreadRename,
    handleThreadDelete,
    handleThreadCopyLink
  };
}

module.exports = { createCrudHandlers };
