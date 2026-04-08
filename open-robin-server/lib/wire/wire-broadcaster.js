/**
 * Wire Broadcaster — bus → WebSocket fan-out for chat events.
 *
 * Extracted per SPEC-01d / SPEC-23a. Subscribes to chat:* events on the
 * event bus and routes each to the specific client whose connection
 * owns the thread that produced the event.
 *
 * Routing: uses getClientForThread(threadId), provided at init time.
 * Today that resolves via wireRegistry in lib/wire/process-manager.js
 * (augmented in this spec to carry a ws reference per entry).
 *
 * Architectural template: lib/audit/audit-subscriber.js. Same shape:
 * subscribe to bus events at startup, do work on each, no state.
 *
 * This module owns ONE job: translating bus events to wire messages
 * and delivering them to the right client. It does NOT own:
 *   - Event parsing (that's the wire message router)
 *   - Per-client session state (that's server.js)
 *   - The wire registry (that's lib/wire/process-manager.js)
 */

const { on } = require('../event-bus');

/**
 * Initialize the wire broadcaster. Call once at server startup,
 * BEFORE server.listen() opens the port. The returned object is
 * informational — there's no stop() because the process lifetime
 * owns the subscribers.
 *
 * @param {object} deps
 * @param {(threadId: string) => import('ws').WebSocket|null} deps.getClientForThread
 *        Called on every chat event; returns the ws that owns the thread,
 *        or null if the thread has no live wire.
 * @returns {{ started: boolean }}
 */
function createWireBroadcaster({ getClientForThread }) {

  function sendToThread(threadId, wireMessage) {
    const ws = getClientForThread(threadId);
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify(wireMessage));
  }

  on('chat:turn_begin', (event) => {
    sendToThread(event.threadId, {
      type: 'turn_begin',
      turnId: event.turnId,
      userInput: event.userInput,
    });
  });

  on('chat:content', (event) => {
    sendToThread(event.threadId, {
      type: 'content',
      text: event.text,
      turnId: event.turnId,
    });
  });

  on('chat:thinking', (event) => {
    sendToThread(event.threadId, {
      type: 'thinking',
      text: event.text,
      turnId: event.turnId,
    });
  });

  on('chat:tool_call', (event) => {
    sendToThread(event.threadId, {
      type: 'tool_call',
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      turnId: event.turnId,
    });
  });

  on('chat:tool_result', (event) => {
    sendToThread(event.threadId, {
      type: 'tool_result',
      toolCallId: event.toolCallId,
      toolArgs: event.toolArgs,
      toolOutput: event.toolOutput,
      toolDisplay: event.toolDisplay,
      isError: event.isError,
      turnId: event.turnId,
    });
  });

  on('chat:turn_end', (event) => {
    sendToThread(event.threadId, {
      type: 'turn_end',
      turnId: event.turnId,
      fullText: event.fullText,
      hasToolCalls: event.hasToolCalls,
    });
  });

  on('chat:status_update', (event) => {
    sendToThread(event.threadId, {
      type: 'status_update',
      contextUsage: event.contextUsage,
      tokenUsage: event.tokenUsage,
    });
  });

  console.log('[WireBroadcaster] Started');
  return { started: true };
}

module.exports = { createWireBroadcaster };
