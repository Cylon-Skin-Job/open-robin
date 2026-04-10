/**
 * Thread Message Handlers
 *
 * Extracted from ThreadWebSocketHandler.js — handles user message sending
 * and assistant message recording.
 *
 * Uses a factory pattern so the coordinator can inject the shared wsState Map.
 */

/**
 * @param {object} deps
 * @param {Map} deps.wsState - Per-WS state map (shared with coordinator)
 */
function createMessageHandlers({ wsState }) {

  /**
   * Handle message:send - add user message to thread. SPEC-26b: scope-aware.
   * @param {import('ws').WebSocket} ws
   * @param {object} msg
   * @param {string} msg.content
   * @param {'project'|'view'} [msg.scope]
   */
  async function handleMessageSend(ws, msg) {
    const state = wsState.get(ws);
    if (!state) {
      ws.send(JSON.stringify({ type: 'error', message: 'No panel set' }));
      return;
    }

    // SPEC-26b: scope comes from the message; default 'view' for backward
    // compat. The currently active thread for that scope is the target.
    const scope = msg.scope === 'project' ? 'project' : 'view';
    const threadId = state.threadIds?.[scope];
    if (!threadId) {
      ws.send(JSON.stringify({ type: 'error', message: `No active ${scope} thread` }));
      return;
    }

    const manager = state.threadManagers[scope];
    const { content } = msg;

    try {
      // Add message to thread
      await manager.addMessage(threadId, {
        role: 'user',
        content,
        hasToolCalls: false
      });

      // Update MRU
      await manager.index.touch(threadId);

      ws.send(JSON.stringify({
        type: 'message:sent',
        threadId,
        scope,
        content
      }));

    } catch (err) {
      console.error('[ThreadWS] Send message failed:', err);
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  }

  /**
   * Add assistant message to thread (called after streaming completes).
   * SPEC-26b: scope-aware; caller passes scope from session.currentScope.
   * @param {import('ws').WebSocket} ws
   * @param {string} content
   * @param {boolean} hasToolCalls
   * @param {object} [metadata] - Optional metadata (contextUsage, tokenUsage, etc.)
   * @param {'project'|'view'} [scope='view']
   */
  async function addAssistantMessage(ws, content, hasToolCalls = false, metadata = null, scope = 'view') {
    const state = wsState.get(ws);
    if (!state) return;

    const threadId = state.threadIds?.[scope];
    if (!threadId) return;

    const manager = state.threadManagers[scope];
    const message = {
      role: 'assistant',
      content,
      hasToolCalls
    };

    if (metadata && Object.keys(metadata).length > 0) {
      await manager.addMessageWithMetadata(threadId, message, metadata);
    } else {
      await manager.addMessage(threadId, message);
    }
  }

  return { handleMessageSend, addAssistantMessage };
}

module.exports = { createMessageHandlers };
