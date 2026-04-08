/**
 * Agent Persona Wire Sessions
 *
 * Module-private Map tracking active agent persona wires, keyed by bot
 * name. Separate from wireRegistry (thread-based chat wires) in
 * lib/wire/process-manager.js — these are two different registries
 * serving two different purposes.
 *
 * Extracted from server.js per SPEC-01e. Also owns the side-effect
 * assignment to global.__agentWireSessions, read directly by
 * lib/runner/index.js when dispatching trigger notifications to active
 * persona sessions. The global is assigned at module load time — the
 * load is guaranteed to happen during server.js startup via the
 * transitive import through lib/thread/agent-session-handler.js.
 *
 * Do not mutate agentWireSessions from outside this module. Use the
 * exported register/unregister helpers.
 */

// Module-private state. Do not export directly.
const agentWireSessions = new Map();

// Side effect: expose to runner via global. This must happen at module
// load time — the runner reads `global.__agentWireSessions` directly.
global.__agentWireSessions = agentWireSessions;

/**
 * Register a bot's active wire. Automatically wires up an exit handler
 * that removes the entry when the wire process terminates.
 *
 * @param {string} botName
 * @param {import('child_process').ChildProcess} wire
 */
function registerAgentSession(botName, wire) {
  agentWireSessions.set(botName, wire);
  wire.on('exit', () => agentWireSessions.delete(botName));
}

/**
 * Manually unregister a bot's wire. Normally not needed — the exit
 * handler from registerAgentSession does the cleanup. Exported for
 * explicit disposal use cases.
 *
 * @param {string} botName
 */
function unregisterAgentSession(botName) {
  agentWireSessions.delete(botName);
}

/**
 * Look up a bot's active wire.
 *
 * @param {string} botName
 * @returns {import('child_process').ChildProcess|undefined}
 */
function getAgentSession(botName) {
  return agentWireSessions.get(botName);
}

module.exports = {
  registerAgentSession,
  unregisterAgentSession,
  getAgentSession,
};
