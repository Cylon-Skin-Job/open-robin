/**
 * Thread CRUD Handlers
 *
 * Extracted from ThreadWebSocketHandler.js — exposes handleThreadOpenAssistant
 * (the unified create-or-resume dispatcher), handleThreadRename,
 * handleThreadDelete, and handleThreadCopyLink.
 *
 * handleThreadCreate and handleThreadOpen remain as private helpers inside
 * the factory, called only by handleThreadOpenAssistant. They are not
 * exported — external callers must use the dispatcher so upsert semantics
 * are enforced.
 *
 * Uses a factory pattern so the coordinator can inject shared state (Maps)
 * and helper functions. All functions close over the same scope, which is
 * critical because handleThreadOpenAssistant calls handleThreadCreate /
 * handleThreadOpen, and handleThreadCreate calls handleThreadOpen internally.
 */

/**
 * @param {object} deps
 * @param {Map} deps.wsState - Per-WS state map (shared with coordinator)
 * @param {Function} deps.sendThreadList - Send thread list to client (scope-aware, SPEC-26b)
 * @param {Function} deps.closeThread - Close a scoped thread session (SPEC-26b)
 * @param {Map} deps.pendingReorderTimers - Pending reorder timers (shared with coordinator)
 * @param {number} deps.REORDER_DELAY_MS - Delay for thread list refresh
 */
function createCrudHandlers({ wsState, sendThreadList, closeThread, pendingReorderTimers, REORDER_DELAY_MS }) {

  /**
   * Generate a timestamp-based thread ID.
   *
   * Format: YYYY-MM-DDTHH-MM-SS-mmm (e.g. "2026-04-08T14-30-22-123")
   *
   * This format is:
   * - Filesystem-safe (no colons — colons break on Windows and some tooling)
   * - Lexicographically sortable (chronological sort by string comparison)
   * - Human-readable at a glance
   * - Millisecond-precise (collision-resistant within a single process;
   *   two threads created in the same millisecond is not a concern for
   *   human-driven chat creation)
   *
   * Local time, not UTC. A chat created at 2:34 PM Pacific shows `14-30` in
   * its ID, not `21-30`. Matches user intuition for "when did I create that
   * chat".
   *
   * @returns {string}
   */
  function generateThreadId() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${yyyy}-${mm}-${dd}T${hh}-${mi}-${ss}-${ms}`;
  }

  /**
   * Handle thread:create message. SPEC-26b: scope-aware.
   * @param {import('ws').WebSocket} ws
   * @param {object} msg
   * @param {string} [msg.name]
   * @param {string} [msg.harnessId] - Harness selection ('kimi' | 'robin')
   * @param {object} [msg.harnessConfig] - BYOK configuration
   * @param {'project'|'view'} [scope='view']
   */
  async function handleThreadCreate(ws, msg, scope = 'view') {
    const state = wsState.get(ws);
    if (!state) {
      ws.send(JSON.stringify({ type: 'error', message: 'No panel set' }));
      return;
    }

    const manager = state.threadManagers?.[scope];
    if (!manager) {
      ws.send(JSON.stringify({ type: 'error', message: `No ${scope} ThreadManager` }));
      return;
    }

    // Generate thread ID — timestamp-based, filesystem-safe, lexicographically
    // sortable. See generateThreadId() above for format.
    const threadId = generateThreadId();
    const name = msg.name || null;
    const harnessId = msg.harnessId || 'kimi';

    try {
      // Create thread with harness selection
      const { threadId: createdId, entry } = await manager.createThread(threadId, name, {
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
        scope, // echo so the client routes the response correctly (SPEC-26c)
        thread: entry
      }));

      // Send updated list (scoped)
      await sendThreadList(ws, scope);

      // Automatically open the new thread
      await handleThreadOpen(ws, { threadId: createdId }, scope);

    } catch (err) {
      console.error('[ThreadWS] Create failed:', err);
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  }

  /**
   * Handle thread:open message. SPEC-26b: scope-aware.
   * Opening a thread of one scope does NOT close the other scope's thread.
   * @param {import('ws').WebSocket} ws
   * @param {object} msg
   * @param {string} msg.threadId
   * @param {'project'|'view'} [scope='view']
   */
  async function handleThreadOpen(ws, msg, scope = 'view') {
    const state = wsState.get(ws);
    if (!state) {
      ws.send(JSON.stringify({ type: 'error', message: 'No panel set' }));
      return;
    }

    const { threadId } = msg;
    const manager = state.threadManagers?.[scope];
    if (!manager) {
      ws.send(JSON.stringify({ type: 'error', message: `No ${scope} ThreadManager` }));
      return;
    }

    // Check if thread exists
    const thread = await manager.getThread(threadId);
    if (!thread) {
      ws.send(JSON.stringify({ type: 'error', message: `Thread not found: ${threadId}` }));
      return;
    }

    // Close currently active thread of THE SAME SCOPE if switching threads.
    // The other scope's thread stays alive — this is the "two parallel
    // chats" model.
    if (state.threadIds[scope] && state.threadIds[scope] !== threadId) {
      await closeThread(ws, scope);
    }

    // If this thread is already active elsewhere, that's fine (multiple tabs can view same thread)
    // But only one wire process per thread (managed by ThreadManager)

    state.threadIds[scope] = threadId;

    // Set harness mode based on thread's stored preference
    const { setThreadMode } = require('../harness/feature-flags');
    const harnessId = thread.entry?.harnessId || 'kimi';
    const mode = harnessId === 'kimi' ? 'legacy' : 'new';
    setThreadMode(threadId, mode);

    // Mark as resumed in index
    await manager.index.markResumed(threadId);

    // Send thread history (both formats during transition)
    const history = await manager.getHistory(threadId);
    const richHistory = await manager.getRichHistory(threadId);

    // Extract context usage from the last exchange's metadata
    const exchanges = richHistory?.exchanges || [];
    const lastExchange = exchanges.length > 0 ? exchanges[exchanges.length - 1] : null;
    const contextUsage = lastExchange?.metadata?.contextUsage ?? null;

    console.log(`[ThreadWS] Opening ${scope} thread ${threadId.slice(0,8)}, exchanges: ${exchanges.length}, lastExchange metadata:`, lastExchange?.metadata);
    console.log(`[ThreadWS] Sending contextUsage:`, contextUsage);

    ws.send(JSON.stringify({
      type: 'thread:opened',
      threadId,
      panel: state.viewName,
      scope, // echo so the client routes the response correctly (SPEC-26c)
      thread: thread.entry,
      history: history?.messages || [],  // Legacy format
      exchanges: exchanges,  // Rich format with tool calls
      contextUsage  // Restore context usage from last exchange
    }));

    // Update MRU order immediately (so other views see it as recently used)
    await manager.index.touch(threadId);

    // Delay the thread list reorder by 3 seconds when just clicking a thread
    // (This gives the user time to see the thread before the list reorders)
    const existingTimer = pendingReorderTimers.get(ws);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      pendingReorderTimers.delete(ws);
      sendThreadList(ws, scope).catch(err => {
        console.error('[ThreadWS] Delayed sendThreadList failed:', err);
      });
    }, REORDER_DELAY_MS);

    pendingReorderTimers.set(ws, timer);

    console.log(`[ThreadWS] Opened ${scope} thread ${threadId} (panel: ${state.panelId}, harness: ${harnessId}) - reorder in ${REORDER_DELAY_MS}ms`);
  }

  /**
   * Handle thread:open-assistant message — the unified create-or-resume verb.
   *
   * Upsert semantics: if msg.threadId is provided and the thread exists in the
   * index, resume it (fires thread:opened). Otherwise, create a new thread
   * (fires thread:created, then thread:opened via handleThreadCreate's chained
   * call to handleThreadOpen).
   *
   * This is the single entry point for opening any assistant thread —
   * it replaces the old split create/open/open-daily/open-agent protocol.
   * The "assistant" suffix matches the Chat Assistants vs Background
   * Workers taxonomy in ai/views/agents-viewer/ — background workers
   * use the runner path (lib/runner/) and never touch thread:* messages.
   *
   * @param {import('ws').WebSocket} ws
   * @param {object} msg
   * @param {string} [msg.threadId] - If present and valid, resume. Otherwise create.
   * @param {string} [msg.name] - Optional display name for new threads (default null).
   * @param {string} [msg.harnessId] - Harness selection for new threads ('kimi' | 'robin').
   * @param {object} [msg.harnessConfig] - BYOK configuration for new threads.
   */
  async function handleThreadOpenAssistant(ws, msg) {
    const state = wsState.get(ws);
    if (!state) {
      ws.send(JSON.stringify({ type: 'error', message: 'No panel set' }));
      return;
    }

    // SPEC-26b: extract scope from msg, default to 'view' for backward compat
    // with pre-26b clients that don't know about dual scopes. The defensive
    // check rejects arbitrary strings — only 'project' or 'view' accepted.
    const scope = msg.scope === 'project' ? 'project' : 'view';
    const manager = state.threadManagers?.[scope];
    if (!manager) {
      ws.send(JSON.stringify({ type: 'error', message: `No ${scope} ThreadManager` }));
      return;
    }

    // Upsert: if client supplied a threadId and it exists in this scope,
    // resume it. Otherwise create a new thread in this scope.
    if (msg.threadId) {
      const existing = await manager.getThread(msg.threadId);
      if (existing) {
        return handleThreadOpen(ws, msg, scope);
      }
      // threadId provided but thread doesn't exist — fall through to create.
      // This handles the race where a client tries to resume a freshly-deleted
      // thread. Creating a new one is the least-surprising outcome.
      console.warn(
        `[ThreadWS] thread:open-assistant with unknown threadId ${msg.threadId} (scope=${scope}) — creating new`
      );
    }

    // No threadId, or threadId not found → create a new thread.
    return handleThreadCreate(ws, msg, scope);
  }

  /**
   * Handle thread:rename message. SPEC-26b: scope-aware.
   * @param {import('ws').WebSocket} ws
   * @param {object} msg
   * @param {string} msg.threadId
   * @param {string} msg.name
   * @param {'project'|'view'} [msg.scope]
   */
  async function handleThreadRename(ws, msg) {
    const state = wsState.get(ws);
    if (!state) {
      ws.send(JSON.stringify({ type: 'error', message: 'No panel set' }));
      return;
    }

    const scope = msg.scope === 'project' ? 'project' : 'view';
    const manager = state.threadManagers?.[scope];
    if (!manager) {
      ws.send(JSON.stringify({ type: 'error', message: `No ${scope} ThreadManager` }));
      return;
    }

    const { threadId, name } = msg;

    try {
      const result = await manager.renameThread(threadId, name);
      if (!result) {
        ws.send(JSON.stringify({ type: 'error', message: `Thread not found: ${threadId}` }));
        return;
      }

      ws.send(JSON.stringify({
        type: 'thread:renamed',
        threadId,
        scope,
        name
      }));

      await sendThreadList(ws, scope);

    } catch (err) {
      console.error('[ThreadWS] Rename failed:', err);
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  }

  /**
   * Handle thread:delete message. SPEC-26b: scope-aware.
   * @param {import('ws').WebSocket} ws
   * @param {object} msg
   * @param {string} msg.threadId
   * @param {'project'|'view'} [msg.scope]
   */
  async function handleThreadDelete(ws, msg) {
    const state = wsState.get(ws);
    if (!state) {
      ws.send(JSON.stringify({ type: 'error', message: 'No panel set' }));
      return;
    }

    const scope = msg.scope === 'project' ? 'project' : 'view';
    const manager = state.threadManagers?.[scope];
    if (!manager) {
      ws.send(JSON.stringify({ type: 'error', message: `No ${scope} ThreadManager` }));
      return;
    }

    const { threadId } = msg;

    // If deleting the currently-active thread for THIS scope, close it first.
    if (state.threadIds[scope] === threadId) {
      await closeThread(ws, scope);
      state.threadIds[scope] = null;
    }

    try {
      const deleted = await manager.deleteThread(threadId);
      if (!deleted) {
        ws.send(JSON.stringify({ type: 'error', message: `Thread not found: ${threadId}` }));
        return;
      }

      ws.send(JSON.stringify({
        type: 'thread:deleted',
        threadId,
        scope
      }));

      await sendThreadList(ws, scope);

    } catch (err) {
      console.error('[ThreadWS] Delete failed:', err);
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  }

  /**
   * Handle thread:copyLink message. SPEC-26b: scope-aware.
   * @param {import('ws').WebSocket} ws
   * @param {object} msg
   * @param {string} msg.threadId
   * @param {'project'|'view'} [msg.scope]
   */
  async function handleThreadCopyLink(ws, msg) {
    const state = wsState.get(ws);
    if (!state) {
      ws.send(JSON.stringify({ type: 'error', message: 'No panel set' }));
      return;
    }

    const scope = msg.scope === 'project' ? 'project' : 'view';
    const manager = state.threadManagers?.[scope];
    if (!manager) {
      ws.send(JSON.stringify({ type: 'error', message: `No ${scope} ThreadManager` }));
      return;
    }

    const { threadId } = msg;

    try {
      const thread = await manager.getThread(threadId);
      if (!thread) {
        ws.send(JSON.stringify({ type: 'error', message: `Thread not found: ${threadId}` }));
        return;
      }

      ws.send(JSON.stringify({
        type: 'thread:link',
        threadId,
        scope,
        filePath: thread.filePath
      }));

    } catch (err) {
      console.error('[ThreadWS] Copy link failed:', err);
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  }

  return {
    handleThreadOpenAssistant,
    handleThreadRename,
    handleThreadDelete,
    handleThreadCopyLink
  };
}

module.exports = { createCrudHandlers };
