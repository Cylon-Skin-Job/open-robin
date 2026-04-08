/**
 * ThreadWebSocketHandler - Manages WebSocket connections with thread switching
 *
 * Each WebSocket connection:
 * - Has a current panel
 * - Can switch between threads within that panel
 * - Manages one wire process at a time (per active thread)
 *
 * Multiple tabs = multiple WebSockets = independent sessions
 *
 * Coordinator module: owns shared state (Maps) and delegates to
 * thread-crud.js (CRUD handlers) and thread-messages.js (message handlers).
 */

const { ThreadManager } = require('./ThreadManager');
const { createCrudHandlers } = require('./thread-crud');
const { createMessageHandlers } = require('./thread-messages');

// Global registry: panelId -> ThreadManager
const threadManagers = new Map();

// Per-WS state: ws -> { panelId, threadId, threadManager }
const wsState = new Map();

// Pending reorder timers: ws -> timeoutId (for delayed thread list refresh)
const pendingReorderTimers = new Map();
const REORDER_DELAY_MS = 3000;

/**
 * Get or create ThreadManager for a panel.
 * If the manager already exists but panelPath changed, replace it.
 * @param {string} panelId
 * @param {object} [config] - Config including panelPath for ChatFile
 * @returns {ThreadManager}
 */
function getThreadManager(panelId, config = {}) {
  const existing = threadManagers.get(panelId);
  if (existing && existing.panelPath === (config.panelPath || null)) {
    return existing;
  }

  const manager = new ThreadManager(panelId, config);
  threadManagers.set(panelId, manager);
  // Initialize async (don't block)
  manager.init().catch(err => {
    console.error(`[ThreadManager] Failed to init ${panelId}:`, err);
  });
  return manager;
}

/**
 * Set panel for a WebSocket connection
 * @param {import('ws').WebSocket} ws
 * @param {string} panelId - Panel identifier (e.g., 'code-viewer', 'agent:bot-name')
 * @param {object} [config] - Config including panelPath for ChatFile
 * @param {string} [config.viewName] - View name for client messages (e.g., 'code-viewer')
 */
function setPanel(ws, panelId, config = {}) {
  const existing = wsState.get(ws);

  // Close current thread if switching panels
  if (existing && existing.threadId) {
    closeCurrentThread(ws);
  }

  const manager = getThreadManager(panelId, config);

  wsState.set(ws, {
    panelId,
    viewName: config.viewName || panelId,
    threadId: null,
    threadManager: manager,
  });
}

/**
 * Get current state for a WebSocket
 * @param {import('ws').WebSocket} ws
 */
function getState(ws) {
  return wsState.get(ws);
}

/**
 * Clean up when WebSocket closes
 * @param {import('ws').WebSocket} ws
 */
function cleanup(ws) {
  const state = wsState.get(ws);
  if (state && state.threadId) {
    closeCurrentThread(ws);
  }
  wsState.delete(ws);

  // Clear any pending reorder timer
  const timer = pendingReorderTimers.get(ws);
  if (timer) {
    clearTimeout(timer);
    pendingReorderTimers.delete(ws);
  }
}

/**
 * Close current thread session for a WebSocket
 * @param {import('ws').WebSocket} ws
 */
async function closeCurrentThread(ws) {
  const state = wsState.get(ws);
  if (!state || !state.threadId) return;

  const { threadManager, threadId } = state;

  // Close the wire session (suspends the thread)
  await threadManager.closeSession(threadId);

  state.threadId = null;
  console.log(`[ThreadWS] Closed thread ${threadId}`);
}

/**
 * Send thread list to client
 * @param {import('ws').WebSocket} ws
 */
async function sendThreadList(ws) {
  console.log('[ThreadWS] sendThreadList called');
  const state = wsState.get(ws);
  if (!state) {
    console.log('[ThreadWS] No state for ws, skipping');
    return;
  }

  console.log('[ThreadWS] Getting threads from manager for panel:', state.panelId);
  const threads = await state.threadManager.listThreads();
  console.log('[ThreadWS] Sending', threads.length, 'threads');

  ws.send(JSON.stringify({
    type: 'thread:list',
    threads: threads.map(t => ({
      threadId: t.threadId,
      entry: t.entry
    }))
  }));
}

/**
 * Get current thread ID for WebSocket
 * @param {import('ws').WebSocket} ws
 * @returns {string|null}
 */
function getCurrentThreadId(ws) {
  return wsState.get(ws)?.threadId || null;
}

/**
 * Get current ThreadManager for WebSocket
 * @param {import('ws').WebSocket} ws
 * @returns {ThreadManager|null}
 */
function getCurrentThreadManager(ws) {
  return wsState.get(ws)?.threadManager || null;
}

// Wire up extracted handlers with shared state
const crud = createCrudHandlers({ wsState, sendThreadList, closeCurrentThread, pendingReorderTimers, REORDER_DELAY_MS });
const messages = createMessageHandlers({ wsState });

module.exports = {
  // Setup
  setPanel,
  getState,
  cleanup,

  // Thread operations
  sendThreadList,
  ...crud,

  // Message handling
  ...messages,

  // Accessors
  getCurrentThreadId,
  getCurrentThreadManager,

  // For testing
  _getThreadManagers: () => threadManagers,
  _getWsState: () => wsState
};
