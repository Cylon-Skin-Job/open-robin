/**
 * Wire process manager.
 *
 * Extracted from server.js. Owns:
 *   - The global wireRegistry Map (threadId → { wire, projectRoot })
 *   - registerWire / unregisterWire / getWireForThread
 *   - sendToWire (JSON-RPC 2.0 marshalling to wire stdin)
 *   - createWireLifecycle factory (per-connection awaitHarnessReady /
 *     initializeWire / setupWireHandlers)
 *
 * The registry Map is module-private. All access goes through the three
 * exported helper functions.
 *
 * Does NOT own:
 *   - agentWireSessions (per-agent persona wires) — still in server.js,
 *     assigned to global.__agentWireSessions for the runner to read
 *   - handleWireMessage (the event router) — SPEC-01d's territory
 *   - Wire spawning (that's in lib/harness/compat.js)
 */

const { v4: generateId } = require('uuid');
const { logWire } = require('./wire-log');

// ── Registry ────────────────────────────────────────────────────────────────

// Module-private Map. Do not export.
// threadId → { wire, projectRoot, ws }
const wireRegistry = new Map();

function getWireForThread(threadId) {
  return wireRegistry.get(threadId)?.wire || null;
}

function getClientForThread(threadId) {
  return wireRegistry.get(threadId)?.ws || null;
}

function registerWire(threadId, wire, projectRoot, ws) {
  wireRegistry.set(threadId, { wire, projectRoot, ws });
  console.log(`[WireRegistry] Registered wire for thread ${threadId.slice(0,8)}, pid: ${wire?.pid}`);
}

function unregisterWire(threadId) {
  wireRegistry.delete(threadId);
  console.log(`[WireRegistry] Unregistered wire for thread ${threadId.slice(0,8)}`);
}

// ── Marshalling ─────────────────────────────────────────────────────────────

function sendToWire(wire, method, params, id = null) {
  const message = {
    jsonrpc: '2.0',
    method,
    params
  };
  if (id) {
    message.id = id;
  }
  const json = JSON.stringify(message);
  console.log('[→ Wire]:', method, json.slice(0, 300));
  if (wire && wire.stdin && !wire.killed) {
    wire.stdin.write(json + '\n');
    console.log('[→ Wire] SENT:', method);
  } else {
    console.error('[→ Wire] FAILED: wire not ready (killed:', wire?.killed, ', stdin:', !!wire?.stdin, ')');
  }
}

// ── Per-connection lifecycle ────────────────────────────────────────────────

/**
 * Create the per-connection wire lifecycle helpers. Call this once per
 * WebSocket connection inside wss.on('connection'), passing the connection's
 * session state object, the ws, the connection id, and a callback that
 * handles parsed wire messages (i.e. the current `handleWireMessage` inside
 * the connection handler).
 *
 * @param {object} deps
 * @param {object} deps.session - per-connection session state (mutated by setupWireHandlers)
 * @param {import('ws').WebSocket} deps.ws
 * @param {string} deps.connectionId
 * @param {(msg: object) => void} deps.onWireMessage - invoked per parsed wire line
 * @returns {{ awaitHarnessReady, initializeWire, setupWireHandlers }}
 */
function createWireLifecycle({ session, ws, connectionId, onWireMessage }) {

  /**
   * If wire was spawned via the new harness (has _harnessPromise), wait for
   * it to resolve before attaching stdout listeners. For legacy Kimi wires
   * this is a no-op.
   */
  async function awaitHarnessReady(wire) {
    if (wire._harnessPromise) {
      console.log('[WS] Awaiting harness initialization...');
      await wire._harnessPromise;
      console.log('[WS] Harness ready');
    }
  }

  function initializeWire(wire) {
    // Skip for new-harness wires — ACP session is already initialized inside the harness
    if (wire._harnessPromise) {
      console.log('[Wire] Skipping initialize for new harness (ACP already initialized)');
      return;
    }
    const id = generateId();
    console.log('[Wire] Initializing wire...');
    sendToWire(wire, 'initialize', {
      protocol_version: '1.4',
      client: { name: 'open-robin', version: '0.1.0' },
      capabilities: { supports_question: true }
    }, id);
    console.log('[Wire] Initialize sent with id:', id);
  }

  function setupWireHandlers(wire, threadId) {
    wire.stdout.on('data', (data) => {
      session.buffer += data.toString();

      let lines = session.buffer.split('\n');
      session.buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;

        console.log('[← Wire]:', line.length > 500 ? line.slice(0, 500) + '...' : line);
        logWire('WIRE_IN', line);

        try {
          const msg = JSON.parse(line);
          onWireMessage(msg);
        } catch (err) {
          console.error('[Wire] Parse error:', err.message);
          ws.send(JSON.stringify({ type: 'parse_error', line: line.slice(0, 200) }));
        }
      }
    });

    wire.on('exit', (code) => {
      console.log(`[Wire] Session ${connectionId} exited with code ${code}`);
      if (session.wire === wire) session.wire = null;
      if (threadId) unregisterWire(threadId);
      // Only notify if WebSocket is still open
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'wire_disconnected', code }));
      }
    });
  }

  return { awaitHarnessReady, initializeWire, setupWireHandlers };
}

module.exports = {
  // Registry
  getWireForThread,
  getClientForThread,
  registerWire,
  unregisterWire,
  // Marshalling
  sendToWire,
  // Per-connection factory
  createWireLifecycle,
};
