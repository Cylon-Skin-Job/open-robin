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
   * Handle message:send - add user message to thread
   * @param {import('ws').WebSocket} ws
   * @param {object} msg
   * @param {string} msg.content
   */
  async function handleMessageSend(ws, msg) {
    const state = wsState.get(ws);
    if (!state || !state.threadId) {
      ws.send(JSON.stringify({ type: 'error', message: 'No thread open' }));
      return;
    }

    const { threadManager, threadId } = state;
    const { content } = msg;

    try {
      // Add message to thread
      await threadManager.addMessage(threadId, {
        role: 'user',
        content,
        hasToolCalls: false
      });

      // Update MRU
      await threadManager.index.touch(threadId);

      ws.send(JSON.stringify({
        type: 'message:sent',
        threadId,
        content
      }));

    } catch (err) {
      console.error('[ThreadWS] Send message failed:', err);
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  }

  /**
   * Add assistant message to thread (called after streaming completes)
   * @param {import('ws').WebSocket} ws
   * @param {string} content
   * @param {boolean} hasToolCalls
   * @param {object} [metadata] - Optional metadata (contextUsage, tokenUsage, etc.)
   */
  async function addAssistantMessage(ws, content, hasToolCalls = false, metadata = null) {
    const state = wsState.get(ws);
    if (!state || !state.threadId) return;

    const { threadManager, threadId } = state;

    const message = {
      role: 'assistant',
      content,
      hasToolCalls
    };

    if (metadata && Object.keys(metadata).length > 0) {
      await threadManager.addMessageWithMetadata(threadId, message, metadata);
    } else {
      await threadManager.addMessage(threadId, message);
    }
  }

  return { handleMessageSend, addAssistantMessage };
}

module.exports = { createMessageHandlers };
