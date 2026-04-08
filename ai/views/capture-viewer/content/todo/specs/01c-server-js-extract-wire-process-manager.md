# SPEC-01c — Extract Wire Process Manager from server.js

**Parent:** SPEC-01 (server.js decomposition)
**Position:** Extraction 3 of 6.
**Depends on:** SPEC-01a (File Explorer) and SPEC-01b (Startup Orchestrator) must be merged. Latest commit should be `b020fce` or later.
**Model recommendation:** Opus 4.6 with 1M context window.
**Estimated blast radius:** Medium. Two new files. Session-closure extraction (harder than 01a/01b). External callers in the client message router (SPEC-01f territory) will reach into the new module via imports.

---

## Your mission

Extract the wire-process lifecycle and the wire-registry bookkeeping out of `open-robin-server/server.js` into **two** new files under a new `open-robin-server/lib/wire/` directory:

1. **`lib/wire/wire-log.js`** — the rotating wire debug log writer (`logWire`) and its constants. ~25 lines.
2. **`lib/wire/process-manager.js`** — the `wireRegistry` Map plus `registerWire` / `unregisterWire` / `getWireForThread` helpers, the `sendToWire` JSON-RPC marshaller, and a `createWireLifecycle({ session, ws, connectionId, onWireMessage })` factory that returns the per-connection helpers `awaitHarnessReady`, `initializeWire`, `setupWireHandlers`. ~150 lines.

Two files because **max modularity, single concern per file.** Logging is one concern; wire process lifecycle is another. Merging them would save one import line and cost a thousand decisions later.

server.js should drop from 1274 → ~1175 lines after this extraction.

**You are extracting, not refactoring.** The session closure is fragile. `_harnessPromise` is fragile. The registry helpers look trivial but are used by code in regions you are not touching. Mechanical transplant with session/ws injection. No behavior changes.

---

## Context before you touch code

1. `ai/views/capture-viewer/content/todo/specs/01-server-js-CONTEXT-FORWARD.md` — the resume doc. Read gotchas **#1 Session object closure scope**, **#3 `global.__agentWireSessions`** (RELEVANT but subtle — see below), and **#6 Deferred process pattern for new-harness mode**.
2. `ai/views/capture-viewer/content/todo/specs/01-server-js-decomposition.md` — original decomposition spec.
3. `ai/views/capture-viewer/content/todo/specs/01a-server-js-extract-file-explorer.md` and `01b-server-js-extract-startup-orchestrator.md` — the two prior extractions. Read both to understand the factory-style extraction pattern, the `gotchas + what-not-to-do` rhythm, and the verification workflow. 01c follows the same shape.
4. `ai/views/capture-viewer/content/todo/REFACTOR-LOG.md` — observations and judgment calls from the debug fixes and prior extractions. Read the 01a/01b entries specifically.
5. `open-robin-server/lib/thread/thread-crud.js` — the canonical factory-of-handlers example. 01c uses a variant: `createWireLifecycle` is a factory of per-connection lifecycle methods.

**Verify line-number drift.** Before you start:

```bash
wc -l open-robin-server/server.js
# Should report 1274. If it's different, reconcile before continuing.

grep -n '^const wireRegistry\|^function sendToWire\|function awaitHarnessReady\|function initializeWire\|function setupWireHandlers\|function handleWireMessage\|function logWire' open-robin-server/server.js
```

Expected output (landmarks as of this spec writing):
- `75:function logWire(direction, data) {`
- `181:const wireRegistry = new Map();`
- `278:function sendToWire(wire, method, params, id = null) {`
- `349:  async function awaitHarnessReady(wire) {` (note the leading indentation — it's nested inside `wss.on('connection')`)
- `357:  function initializeWire(wire) {`
- `373:  function setupWireHandlers(wire, threadId) {`
- `407:  function handleWireMessage(msg) {`

If any of those line numbers are off by more than ~5, stop and reconcile.

---

## Source — what you are moving

All in `open-robin-server/server.js`. Line numbers are current as of commit `b020fce`.

### Wire log region (moves to `lib/wire/wire-log.js`)

| Line | Code | Action |
|---|---|---|
| 61 | `const WIRE_LOG_FILE = path.join(__dirname, 'wire-debug.log');` | **MOVE** (with `__dirname` path rewrite — see Gotcha #6) |
| 63 | `const MAX_WIRE_LOG_SIZE = 10 * 1024 * 1024;` | **MOVE** |
| 75–87 | `function logWire(direction, data) { ... }` | **MOVE** |

### Wire registry region (moves to `lib/wire/process-manager.js`)

| Line | Code | Action |
|---|---|---|
| 179–180 | `// Global wire registry by thread ID...` (comment block) | **MOVE** (rewrite if you want, or keep verbatim) |
| 181 | `const wireRegistry = new Map();` | **MOVE** — becomes module-private, not exported |
| 188–190 | `function getWireForThread(threadId) { ... }` | **MOVE** — exported |
| 192–195 | `function registerWire(threadId, wire, projectRoot) { ... }` | **MOVE** — exported |
| 197–200 | `function unregisterWire(threadId) { ... }` | **MOVE** — exported |

### Wire marshaller (moves to `lib/wire/process-manager.js`)

| Line | Code | Action |
|---|---|---|
| 271–273 | `// ==== Wire Process Functions ====` section header | Optional — rewrite or delete from server.js |
| 275–276 | `// NOTE: spawnThreadWire is now imported from ./lib/harness/compat` comment | **STAYS in server.js** — tells future readers why `spawnThreadWire` isn't here |
| 278–295 | `function sendToWire(wire, method, params, id = null) { ... }` | **MOVE** — exported |

### Per-connection lifecycle helpers (move into the `createWireLifecycle` factory inside `lib/wire/process-manager.js`)

These three are currently **nested function declarations inside the `wss.on('connection')` callback**. Moving them out of that closure is the hardest part of this extraction. See Gotcha #1.

| Line | Code | Action |
|---|---|---|
| 344–348 | `// Wire Process Handlers` comment block | **MOVE** into factory doc comment (or delete) |
| 349–355 | `async function awaitHarnessReady(wire) { ... }` | **MOVE** into the factory |
| 357–371 | `function initializeWire(wire) { ... }` | **MOVE** into the factory |
| 373–405 | `function setupWireHandlers(wire, threadId) { ... }` | **MOVE** into the factory |

### NOT moving

- **`agentWireSessions`** (line 185) and `global.__agentWireSessions = agentWireSessions` (line 186). **STAYS in server.js.** Different concern (agent persona tracking, read by `lib/runner/index.js` via the global). Separate future extraction candidate; not this spec.
- **`SERVER_LOG_FILE`** (line 62) and the `console.log` override (lines 66–73). **STAYS in server.js.** General-purpose server logging is not the same concern as wire-debug logging. Do not move.
- **`handleWireMessage`** (line 407). **STAYS in server.js** — this is SPEC-01d's territory (Wire Message Router, to be combined with SPEC-23a).
- **`wss.on('connection', ...)` callback body.** STAYS. The factory call replaces only the three nested function definitions; everything else in the connection handler is untouched.
- **The per-connection `session` object** (line 308). STAYS. The factory takes it as a parameter.
- **`generateId`** import (line 15). STAYS. `process-manager.js` will re-import `uuid` for its own use.

---

## Dependencies

### `lib/wire/wire-log.js`

Imports needed:
- `fs` — for file operations
- `path` — for resolving the log file path

Dependencies from server.js: **none**. This file is entirely self-contained.

### `lib/wire/process-manager.js`

Imports needed:
- `uuid` (for `generateId` inside `initializeWire`) — `const { v4: generateId } = require('uuid');`
- `./wire-log` — for `logWire`

**Note on `sendToWire` logging:** `sendToWire` currently calls `console.log('[→ Wire]:', method, json.slice(0, 300));`. That's `console.log`, not `logWire`. Keep it as `console.log` — it goes through server.js's console.log override and lands in `server-live.log`, NOT `wire-debug.log`. Don't accidentally switch it to `logWire`.

**Dependencies injected into `createWireLifecycle({ ... })` per call (per-connection):**

| Dep | Type | Source | Why |
|---|---|---|---|
| `session` | object | server.js line 308 (per-connection `let session = { ... }`) | `setupWireHandlers` reads/writes `session.buffer`, `session.wire`. |
| `ws` | WebSocket | server.js `wss.on('connection', (ws) => { ... })` | Used for `ws.send(...)`, `ws.readyState` check in `setupWireHandlers`. |
| `connectionId` | string | server.js line 305 (`generateId()` at connection time) | Used in the `Session ${connectionId} exited` log line inside `setupWireHandlers`. |
| `onWireMessage` | function | server.js line 407 (`function handleWireMessage(msg)`) | `setupWireHandlers` calls it per parsed line. **This relies on JavaScript function declaration hoisting** — see Gotcha #5. |

**No other dependencies.** The factory does NOT need `logWire` as an injected dep — it's imported at module level.

---

## Target — the two new files

### File 1: `open-robin-server/lib/wire/wire-log.js`

~25 lines.

```js
/**
 * Wire debug log — rotating append-only log of wire stdin/stdout traffic.
 *
 * Extracted from server.js. Writes to open-robin-server/wire-debug.log,
 * rotating to wire-debug.log.old when size exceeds 10MB.
 *
 * Separate from server-live.log (which captures console.log output) —
 * the wire log is raw wire-protocol traffic for debugging handshake and
 * event-routing issues.
 */

const fs = require('fs');
const path = require('path');

// Resolve to open-robin-server/wire-debug.log regardless of where this
// file lives in the lib/ tree.
const WIRE_LOG_FILE = path.join(__dirname, '..', '..', 'wire-debug.log');
const MAX_WIRE_LOG_SIZE = 10 * 1024 * 1024; // 10MB

function logWire(direction, data) {
  try {
    const stats = fs.statSync(WIRE_LOG_FILE);
    if (stats.size > MAX_WIRE_LOG_SIZE) {
      try { fs.unlinkSync(WIRE_LOG_FILE + '.old'); } catch {}
      fs.renameSync(WIRE_LOG_FILE, WIRE_LOG_FILE + '.old');
    }
  } catch {}

  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ${direction}: ${data}\n`;
  fs.appendFileSync(WIRE_LOG_FILE, entry);
}

module.exports = { logWire, WIRE_LOG_FILE, MAX_WIRE_LOG_SIZE };
```

Only `logWire` is used today. `WIRE_LOG_FILE` and `MAX_WIRE_LOG_SIZE` are exported alongside it for future test access / diagnostics; no current code reads them directly.

### File 2: `open-robin-server/lib/wire/process-manager.js`

~150 lines. Module shape:

```js
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
// threadId → { wire, projectRoot }
const wireRegistry = new Map();

function getWireForThread(threadId) {
  return wireRegistry.get(threadId)?.wire || null;
}

function registerWire(threadId, wire, projectRoot) {
  wireRegistry.set(threadId, { wire, projectRoot });
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
    params,
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
      capabilities: { supports_question: true },
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
  registerWire,
  unregisterWire,
  // Marshalling
  sendToWire,
  // Per-connection factory
  createWireLifecycle,
};
```

Do **not** export `wireRegistry` itself. The Map is module-private; all access goes through `getWireForThread` / `registerWire` / `unregisterWire`. If you find any code in the repo that was directly reading `wireRegistry`, that's a surprise — report it, don't work around it.

---

## Wiring — what changes in server.js

### 1. Add imports near the other `lib/` imports

```js
const {
  createWireLifecycle,
  sendToWire,
  registerWire,
  unregisterWire,
  getWireForThread,
} = require('./lib/wire/process-manager');
```

Note: `logWire` does NOT need to be imported into server.js — the only remaining caller is inside `setupWireHandlers`, which is now in the process-manager module and imports it directly. If you find any other `logWire` reference in server.js after the extraction, something is wrong.

Run this to confirm after extraction:
```bash
grep -n 'logWire\|WIRE_LOG_FILE\|MAX_WIRE_LOG_SIZE' open-robin-server/server.js
```
Should return zero matches.

### 2. Delete the wire log region

Delete lines 61, 63, and 75–87 in `server.js`. Keep line 62 (`SERVER_LOG_FILE`) and lines 66–73 (`console.log` override) — both stay.

The `// Logging` comment at line 60 can stay as a comment for the console.log override block that remains.

### 3. Delete the wire registry region

Delete lines 179–181 and 188–200 in `server.js`. **Keep lines 183–186** (the `agentWireSessions` Map and global assignment) exactly as they are.

After the deletion, the region around former-line 185 should read:

```js
// Store active sessions (ws -> session state)
const sessions = new Map();

// Agent persona wire sessions (agentName -> wire)
// Used by hold registry and runner to notify active persona sessions
const agentWireSessions = new Map();
global.__agentWireSessions = agentWireSessions;

// ============================================================================
// Project Root & Path Resolution
// ============================================================================
```

### 4. Delete `sendToWire`

Delete lines 278–295 in `server.js`. Keep lines 271–276 (the section header comment and the `spawnThreadWire` note).

### 5. Replace the three nested functions with the factory call

Inside `wss.on('connection', (ws) => { ... })`, locate the block starting around line 340 (`// ==== Wire Process Handlers ====`). Delete lines 340–405 (the comment block plus the three nested function declarations).

In their place, insert:

```js
// Per-connection wire lifecycle helpers. onWireMessage relies on function
// declaration hoisting — handleWireMessage is defined further down in this
// connection handler but is available here because it's a function declaration.
const { awaitHarnessReady, initializeWire, setupWireHandlers } = createWireLifecycle({
  session,
  ws,
  connectionId,
  onWireMessage: handleWireMessage,
});
```

All existing call sites (lines 715, 717, 720, 757, 759, 761, 784, 785, 786, 884, 885, 886) continue to work unchanged — they reference the destructured local names.

### 6. `handleWireMessage` at line 407 — do not touch

Specifically, do NOT convert it to `const handleWireMessage = ...` or `const handleWireMessage = function ...`. The factory call above depends on function-declaration hoisting. Changing the declaration form would break the hoisting and the factory would receive `undefined` for `onWireMessage`. See Gotcha #5.

### 7. Verify all external call sites still resolve

After the extraction, `registerWire`, `sendToWire`, and `getWireForThread` are all imported from `./lib/wire/process-manager`. The call sites that used them as local names (lines ~713, 755, 783, 883 for `registerWire`; ~997, 1057, 1068 for `sendToWire`; ~1012, 1066 for `getWireForThread`) now resolve via the imports — no change to those lines themselves.

Run these greps after the extraction:

```bash
grep -n 'sendToWire\|registerWire\|unregisterWire\|getWireForThread' open-robin-server/server.js
```

Should return only:
- One line near the top: the destructured `require('./lib/wire/process-manager')` import
- The external call sites in the client message router and connection handler

Zero matches for `function sendToWire`, `function registerWire`, `function unregisterWire`, `function getWireForThread`.

```bash
grep -n 'function awaitHarnessReady\|function initializeWire\|function setupWireHandlers' open-robin-server/server.js
```

Should return zero matches.

```bash
grep -rn 'wireRegistry\b' open-robin-server/ --include='*.js'
```

Should return exactly one match: the Map declaration in `lib/wire/process-manager.js`. If it returns more, something wasn't extracted; if it returns zero, the extraction dropped the Map itself.

---

## Gotchas — preserve these exactly

### 1. Session object closure — the big one

The three extracted functions currently close over the per-connection `session` object (line 308):

- `setupWireHandlers` reads and writes `session.buffer` (the accumulating stdout buffer) and `session.wire` (set to `null` on exit).
- `awaitHarnessReady` does not touch `session` but lives in the same closure.
- `initializeWire` does not touch `session` but lives in the same closure.

After extraction, the factory takes `session` as an explicit parameter. Inside the factory, `session` is a closure variable captured at factory-call time. Each WS connection gets its own factory invocation and therefore its own independent `session` reference. **This is correct because the factory is called inside `wss.on('connection')`, once per connection, after `session` is initialized.**

The failure mode to avoid: if you move the factory call OUTSIDE `wss.on('connection')` and try to share a single factory across connections, sessions will get mixed up. Do not do that. The factory must be called per connection, inside the connection handler.

### 2. `global.__agentWireSessions` — NOT moving

Line 186 sets `global.__agentWireSessions = agentWireSessions`. The runner (`lib/runner/index.js`) reads that global directly. **This is a different concern from the wire-registry extraction.** Leave it in server.js. Do not move it, do not assign it inside the new module, do not try to fold it into `wireRegistry`. It tracks *agent persona wires*, keyed by agent name; the wire registry tracks *thread wires*, keyed by threadId. Two different Maps, two different purposes.

If you delete the `agentWireSessions` declaration or the global assignment, agent runner notifications silently stop working — no error thrown. Check that both lines 185 and 186 are still present after your extraction.

### 3. `_harnessPromise` deferred pattern — preserve exactly

Both `awaitHarnessReady` and `initializeWire` check `wire._harnessPromise`:

- `awaitHarnessReady` awaits it if present (new harness) or no-ops (legacy Kimi).
- `initializeWire` skips the ACP initialize call if `_harnessPromise` is present (the harness already initialized its ACP session).

The `_harnessPromise` property is set by `lib/harness/compat.js` on wire objects spawned via the new harness path. Preserve both checks verbatim. Do not merge the two branches. Do not rename the property. Do not hoist the check outside the functions.

Failure mode: if you drop the check in `awaitHarnessReady`, legacy Kimi wires hang (there's no promise to await). If you drop it in `initializeWire`, new-harness wires double-initialize their ACP session and confuse the harness state machine.

### 4. `unregisterWire` call inside `setupWireHandlers.on('exit')` 

Line 399: `if (threadId) unregisterWire(threadId);` — this runs inside the `wire.on('exit')` callback. After the extraction, `unregisterWire` is a module-level function in `lib/wire/process-manager.js`; the factory-internal `setupWireHandlers` calls it via the module-level closure (not an injected dep). **That's correct** — don't inject `unregisterWire` via `deps`. The factory is defined in the same file as `unregisterWire`, so the inner `setupWireHandlers` can reference it directly via lexical scope.

### 5. Function declaration hoisting for `handleWireMessage`

The factory call:

```js
const { awaitHarnessReady, initializeWire, setupWireHandlers } = createWireLifecycle({
  session,
  ws,
  connectionId,
  onWireMessage: handleWireMessage,  // ← defined ~60 lines below this line
});
```

appears **before** `function handleWireMessage(msg) { ... }` in the source. This works because `handleWireMessage` is a **function declaration**, which JavaScript hoists to the top of its enclosing function scope (here, the `wss.on('connection')` arrow function body). The identifier is bound at the top of the scope with the function value; by the time the factory call executes, `handleWireMessage` is already defined.

**Two ways to break this:**

1. Convert `function handleWireMessage(msg)` to `const handleWireMessage = (msg) => { ... }`. Arrow functions assigned to `const` are NOT hoisted — the factory would receive `undefined` at the time of the call, and `setupWireHandlers` would throw a TypeError when a wire message arrives.
2. Move the factory call outside the connection handler (already forbidden by Gotcha #1).

Do not touch the declaration form of `handleWireMessage`. If you want to reorganize the connection handler later, that's SPEC-01d's territory.

### 6. `WIRE_LOG_FILE` path adjustment

The current code has `path.join(__dirname, 'wire-debug.log')` where `__dirname` is `open-robin-server/`. In the new file `lib/wire/wire-log.js`, `__dirname` is `open-robin-server/lib/wire/` — two directories deeper. Adjust to:

```js
const WIRE_LOG_FILE = path.join(__dirname, '..', '..', 'wire-debug.log');
```

This resolves to the same file on disk: `open-robin-server/wire-debug.log`. Do NOT change the log file's location. `restart-kimi.sh` and any operator tooling expects it at that path.

### 7. `console.log` override stays in server.js

Do not move the override at server.js lines 66–73 into wire-log.js. That override captures ALL `console.log` calls (not just wire-related) and writes them to `server-live.log`. It's server-wide infrastructure, not wire-specific. Wire-log.js is only the `logWire` function and its constants.

Concretely, wire-log.js has:
- `WIRE_LOG_FILE`
- `MAX_WIRE_LOG_SIZE`
- `function logWire(...)`

Wire-log.js does NOT have:
- `SERVER_LOG_FILE`
- The `console.log` override

### 8. `sendToWire` uses `console.log` not `logWire`

Notice that `sendToWire` logs outgoing wire traffic with `console.log('[→ Wire]:', ...)` — not with `logWire`. Preserve that. Don't "fix" it to use `logWire` during extraction. The current separation is:

- `console.log('[→ Wire]')` — outbound traffic → lands in `server-live.log` (via the console override)
- `logWire('WIRE_IN', line)` — inbound traffic → lands in `wire-debug.log`

That's asymmetric but intentional (the user has probably tuned this for their debug workflow). If it looks broken, file it, don't fix it here.

### 9. Max modularity — do not merge wire-log into process-manager

The two concerns are:
1. **Wire process lifecycle** — spawning, init, stdout parsing, registry bookkeeping, marshalling
2. **Wire debug logging** — rotating file writer for wire traffic

These are separate concerns. They are co-located physically (`lib/wire/`) but must remain in separate files (`process-manager.js` and `wire-log.js`). The user has explicitly called out "max modularity, single concern per file." Do not consolidate.

### 10. `registerWire` / `sendToWire` / `getWireForThread` have external callers

These three functions are called from the client message router (lines ~713, 755, 783, 883, 997, 1012, 1057, 1066, 1068 in the current server.js). The client router stays in server.js for now — SPEC-01f will extract it. After SPEC-01c, the call sites in the router use the imported versions from `./lib/wire/process-manager`; the call syntax is unchanged.

Do NOT try to refactor the client router to use a different pattern during this extraction. Extraction only. The router is untouched.

---

## Verification checklist

After the extraction, run these in order. Stop and report if any step fails.

### Sanity checks (static)

1. `wc -l open-robin-server/server.js` — should report approximately 1175 lines (down from 1274).
2. `wc -l open-robin-server/lib/wire/wire-log.js` — should report approximately 25 lines.
3. `wc -l open-robin-server/lib/wire/process-manager.js` — should report approximately 150 lines.
4. `node -e "require('./open-robin-server/lib/wire/wire-log')"` from repo root — loads clean.
5. `node -e "require('./open-robin-server/lib/wire/process-manager')"` from repo root — loads clean.
6. `node -e "require('./open-robin-server/server.js')"` from repo root — may throw `EADDRINUSE`; that's fine. Any `SyntaxError` / `ReferenceError` / `TypeError` is a fail.
7. Grep checks:
   ```bash
   grep -n 'logWire\|WIRE_LOG_FILE\|MAX_WIRE_LOG_SIZE' open-robin-server/server.js
   # → zero matches
   
   grep -n 'function sendToWire\|function registerWire\|function unregisterWire\|function getWireForThread' open-robin-server/server.js
   # → zero matches
   
   grep -n 'function awaitHarnessReady\|function initializeWire\|function setupWireHandlers' open-robin-server/server.js
   # → zero matches
   
   grep -n 'global.__agentWireSessions' open-robin-server/server.js
   # → exactly one match (line ~184, preserved)
   
   grep -rn '\bwireRegistry\b' open-robin-server/ --include='*.js'
   # → exactly one match: the Map declaration in lib/wire/process-manager.js
   
   grep -n 'createWireLifecycle' open-robin-server/server.js
   # → exactly two matches: one in the require line, one in the factory call inside wss.on('connection')
   ```

### Runtime checks

Run `./restart-kimi.sh`. If it fails, the extraction broke something — stop and report.

8. `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/` → `200`.
9. `tail -40 open-robin-server/server-live.log` — should show the expected startup sequence (DB init → listen → wiki → watcher → etc.) with no errors. No reference to missing `logWire` or `wireRegistry` or undefined `handleWireMessage`.
10. Open the browser at `http://localhost:3001`. The page loads. Console has no red errors.
11. **Create a new chat thread and send a message.** This exercises the full wire lifecycle: `createWireLifecycle` → `setupWireHandlers` attaches listeners → wire responds → `handleWireMessage` runs → content flows back to the client. If the page hangs or the chat never responds, the hoisting gotcha (Gotcha #5) was likely violated.
12. Check `open-robin-server/wire-debug.log` — should have new `WIRE_IN` entries with the current timestamp, confirming `logWire` is working from its new location.
13. Tail `server-live.log` for the outbound traffic logs — should see `[→ Wire]: initialize` and `[→ Wire] SENT: initialize` for any new wire, confirming `sendToWire` is working.
14. **Clean shutdown test:** `lsof -ti:3001 | xargs kill -TERM`. Server exits cleanly, no stack trace, port freed within a few seconds.

---

## What NOT to do

- **Do not** move `agentWireSessions` or the `global.__agentWireSessions` assignment. See Gotcha #2.
- **Do not** move `SERVER_LOG_FILE` or the `console.log` override. See Gotcha #7.
- **Do not** move `handleWireMessage` — that's SPEC-01d.
- **Do not** convert `handleWireMessage` from a function declaration to a const arrow/function expression. See Gotcha #5.
- **Do not** merge `lib/wire/wire-log.js` and `lib/wire/process-manager.js` into a single file. See Gotcha #9.
- **Do not** export `wireRegistry` directly. The Map is module-private.
- **Do not** change `sendToWire` to use `logWire` instead of `console.log`. See Gotcha #8.
- **Do not** modify the `_harnessPromise` check in `awaitHarnessReady` or `initializeWire`. See Gotcha #3.
- **Do not** touch `lib/harness/compat.js`. It's the SPEC-11 follow-up target and has its own gotchas.
- **Do not** inject `unregisterWire` into the factory. It's in the same module as `setupWireHandlers` and resolves via module scope. See Gotcha #4.
- **Do not** hoist the factory call outside `wss.on('connection')`. See Gotcha #1.
- **Do not** touch the client message router call sites — they keep using the imported names without modification.
- **Do not** refactor the sendToWire asymmetry between console.log and logWire. File it, don't fix it.
- **Do not** push the commit. Commit locally only.
- **Do not** update this spec doc. The user does that.
- **Do not** start SPEC-01d. Stop after SPEC-01c and let the user drive the next cycle.

---

## Commit

One commit. Message:

```
Extract wire process manager from server.js into lib/wire/

Part 3 of 6 under SPEC-01 (server.js decomposition). Creates a
new lib/wire/ directory with two single-concern files:

- lib/wire/wire-log.js
  The rotating wire-debug.log writer (logWire) and its constants.
  Self-contained: only fs + path, no server.js coupling.

- lib/wire/process-manager.js
  The module-private wireRegistry Map and its three helpers
  (registerWire / unregisterWire / getWireForThread), the sendToWire
  JSON-RPC marshaller, and a createWireLifecycle factory that
  produces per-connection awaitHarnessReady / initializeWire /
  setupWireHandlers helpers.

server.js imports the factory + the registry helpers + sendToWire
from lib/wire/process-manager. Inside wss.on('connection'), the
three nested lifecycle functions are replaced with a single
createWireLifecycle({ session, ws, connectionId, onWireMessage:
handleWireMessage }) call that destructures the three helpers.
The call relies on function-declaration hoisting so
handleWireMessage (defined further down in the connection handler)
is in scope.

agentWireSessions and global.__agentWireSessions are NOT moved —
different concern (agent persona tracking, read by runner via the
global). Separate future extraction candidate.

_harnessPromise deferred-initialization pattern preserved verbatim
in both awaitHarnessReady and initializeWire. sendToWire's asymmetric
logging (console.log for outbound, logWire for inbound via setup-
WireHandlers) preserved.

server.js: 1274 → ~1175 lines.
```

**Commit only. Do not push.**

---

## Reporting back

When you're done, report:

1. **Actual line counts** — `wc -l` for server.js, wire-log.js, and process-manager.js.
2. **Verification results** — each of the 14 checks with a one-line result. ✓ or ✗.
3. **Chat round-trip result** — specifically, whether creating a thread and sending a message succeeded and the response came back. This is the critical functional test because it exercises the full `createWireLifecycle` → `handleWireMessage` loop.
4. **Any deviations from the spec** — judgment calls.
5. **Commit hash** — SHA of your extraction commit.
6. **Anything unexpected** — surprising grep hits, closure issues, hoisting confusion, path resolution problems for `WIRE_LOG_FILE`, anything the spec didn't anticipate.

If you encounter a blocker — in particular, if the chat round-trip fails — stop and describe the failure mode precisely. Don't attempt a fix unless it's an obvious typo in your own edit. If `handleWireMessage` is undefined at the factory call site, that's the hoisting gotcha — double-check that `handleWireMessage` is still a `function` declaration, not a `const`.

---

## Files you will touch

- `open-robin-server/lib/wire/wire-log.js` — new file
- `open-robin-server/lib/wire/process-manager.js` — new file
- `open-robin-server/server.js` — delete ~100 lines (wire log + registry + sendToWire + three factory methods), add ~10 lines (imports + factory call)

Three files total. Two new, one edit. One commit.

---

## After this SPEC lands

The user and the IDE Claude session will verify the work. Next up is SPEC-01d (Wire Message Router, combined with SPEC-23a bus consolidation). That spec is substantially more complex because it touches a fragile region and folds in a second refactor. It will be drafted separately after 01c lands.
