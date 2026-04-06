/**
 * Event Bus — central pub/sub for server-side automations.
 *
 * Emitters: server.js (chat), dispatch.js (tickets), runner/index.js (agents)
 * Listeners: trigger-loader.js (TRIGGERS.md-defined reactions)
 *
 * This is a notification channel for user-defined automations.
 * It does NOT replace direct module calls in the core flow.
 */

const EventEmitter = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(200);

const MAX_CHAIN_DEPTH = 5;
let currentDepth = 0;

// Same-event suppression: track the triggering event in the current chain
let currentTrigger = null;

/**
 * Extract the key field from event data for dedup comparison.
 */
function eventKey(data) {
  return data.ticketId ?? data.threadId ?? data.runId ?? null;
}

/**
 * Check if this emit is a duplicate of the event that triggered it.
 * Suppresses A→action→A loops on the same entity.
 */
function isSameEventLoop(type, data) {
  if (!currentTrigger) return false;
  if (type !== currentTrigger.type) return false;
  const key = eventKey(data);
  const triggerKey = eventKey(currentTrigger);
  return key !== null && key === triggerKey;
}

/**
 * Emit an event on the bus.
 *
 * @param {string} type - Event type (e.g. 'chat:turn_end', 'ticket:claimed')
 * @param {Object} data - Event payload (merged with type + timestamp)
 */
function emit(type, data = {}) {
  if (currentDepth >= MAX_CHAIN_DEPTH) {
    console.warn(`[EventBus] Max chain depth (${MAX_CHAIN_DEPTH}) reached, dropping: ${type}`);
    return;
  }

  if (isSameEventLoop(type, data)) {
    console.warn(`[EventBus] Same-event loop suppressed: ${type}`);
    return;
  }

  const event = { type, timestamp: Date.now(), ...data };
  const previousTrigger = currentTrigger;
  currentTrigger = event;
  currentDepth++;
  try {
    bus.emit(type, event);
    bus.emit('*', event);
  } finally {
    currentDepth--;
    currentTrigger = previousTrigger;
  }
}

/**
 * Listen for events of a given type.
 *
 * @param {string} type - Event type to listen for, or '*' for all events
 * @param {Function} handler - Called with the event object
 * @returns {Function} Unsubscribe function
 */
function on(type, handler) {
  bus.on(type, handler);
  return () => bus.off(type, handler);
}

module.exports = { emit, on, bus };
