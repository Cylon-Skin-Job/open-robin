# SPEC-01f — Extract Client Message Router from server.js

**Parent:** SPEC-01 (server.js decomposition)
**Position:** Extraction 6 of 6. **The final extraction.** After this lands, server.js becomes a thin entry point (~500 lines) and SPEC-01 is complete.
**Depends on:** SPEC-01a, 01b, 01c, 01d, 01e all merged. Latest commit should be `561c6be` (01e) or later.
**Model recommendation:** Opus 4.6 with 1M context window.
**Estimated blast radius:** **High volume, low conceptual risk.** This is the largest extraction by line count (~440 lines), but most of those lines are already thin delegations to modules extracted by prior specs (ThreadWebSocketHandler, fileExplorer, handleThreadOpenAgent, wire helpers). The extraction is mechanical: wrap the existing `ws.on('message')` body in a factory, inject everything it closes over, and wire it up. No algorithmic changes. **The regression surface is huge** because every client message type flows through this router — if one type gets dropped or mis-dispatched, a feature silently breaks.

---

## Your mission

Extract the entire `ws.on('message', async (message) => { ... })` body AND the `ws.on('close', () => { ... })` body out of `server.js` (currently lines 339–762 and 768–783) into a new single file at `open-robin-server/lib/ws/client-message-router.js`. Use a per-connection factory pattern matching prior extractions. The factory returns `{ handleClientMessage, handleClientClose }`, which `server.js` wires into `ws.on('message', handleClientMessage)` and `ws.on('close', handleClientClose)`.

After this extraction:
- `server.js` is ~500 lines (down from 828): imports, express setup + middleware, static + SPA fallback, module-level state (sessions, sessionRoots, robin/clipboard mutable refs), per-panel-path helpers, a thin `wss.on('connection')` callback that creates four factories in order and wires their outputs, and the startup sequence call.
- All client message dispatch lives in `lib/ws/client-message-router.js`.
- The 25+ message type handlers are preserved verbatim with only path/dep-injection adjustments.

**You are extracting, not refactoring.** The `thread:create` / `thread:open` / `thread:open-daily` handlers share a visible repeated pattern (spawn wire → register → await harness → set up handlers → initialize). **Do not DRY them.** The repetition is a candidate for a post-SPEC-01 cleanup, not this spec. Same rule applies to the five `harness:*` admin handlers with their inline requires.

---

## Context before you touch code

1. `ai/views/capture-viewer/content/todo/specs/01-server-js-CONTEXT-FORWARD.md` — gotchas, especially **#1 Session closure scope**, **#2 Middleware ordering** (for the parts of server.js that stay), and the session state object structure.
2. `ai/views/capture-viewer/content/todo/specs/01a–e` — all five prior extraction specs. Understand which modules are now doing what so you know which handlers are already thin delegations. Specifically:
   - SPEC-01a: file explorer (`fileExplorer.*` methods)
   - SPEC-01b: startup orchestrator (owns `robinHandlers` / `clipboardHandlers` mutable refs via the `startServer().then(...)` callback)
   - SPEC-01c: wire process manager (`createWireLifecycle` → `{ awaitHarnessReady, initializeWire, setupWireHandlers }`; also `registerWire`, `getWireForThread`, `sendToWire` as module exports)
   - SPEC-01d: wire message router + wire-broadcaster (the `handleMessage` from `createWireMessageRouter` is different from this spec's `handleClientMessage` — don't conflate)
   - SPEC-01e: agent session handler (`handleThreadOpenAgent`)
3. `ai/views/capture-viewer/content/todo/REFACTOR-LOG.md` — read all five prior entries. Pay special attention to the factory-pattern variance notes, the mutable-reference pattern rationale, and the hoisting-dependency elimination in 01d.
4. `open-robin-server/lib/thread/thread-crud.js`, `lib/thread/thread-messages.js`, `lib/thread/agent-session-handler.js` — factory-with-injected-deps examples. The shape of `createClientMessageRouter` follows the same pattern, just with more deps.

**Verify line-number drift:**

```bash
wc -l open-robin-server/server.js
# Should report 828. If different, reconcile.

grep -n "^  ws\.on('message'\|^  ws\.on('close'\|clientMsg\.type ===" open-robin-server/server.js | head -30
```

Expected landmarks (commit `561c6be`):
- `339:  ws.on('message', async (message) => {`
- `351:      if (clientMsg.type === 'client_log') {`
- `357:      if (clientMsg.type === 'thread:create') {`
- `393:      if (clientMsg.type === 'thread:open') {`
- `428:      if (clientMsg.type === 'thread:open-daily') {`
- `452:      if (clientMsg.type === 'thread:open-agent') {`
- `498:      if (clientMsg.type === 'set_panel') {`
- `546:      if (clientMsg.type === 'initialize') {`
- `561:      if (clientMsg.type === 'prompt') {`
- `674:      if (clientMsg.type === 'harness:get_mode') {`
- `762:  });`  (close of the message handler)
- `768:  ws.on('close', () => {`
- `783:  });`  (close of the close handler)

If any are off by more than ~5, reconcile first.

---

## Source — what you are moving

### Part A: `ws.on('message')` body (lines 339–762)

423 lines, async arrow function. Structure:

```
try {
  parse the message
  log the type
  [25+ if-blocks dispatching by clientMsg.type]
  log unknown type (fallthrough)
} catch (err) {
  log + send error to client
}
```

The 25+ handlers in order, with current behavior category:

| # | Type | Lines | Category | Current state |
|---|---|---|---|---|
| 1 | `client_log` | 351–355 | Direct | Logs forwarded client messages. Trivial. |
| 2 | `thread:create` | 357–391 | Delegate + wire-spawn | Calls `ThreadWebSocketHandler.handleThreadCreate`, then spawns wire via the repeated wire-spawn sequence. |
| 3 | `thread:open` | 393–426 | Delegate + wire-spawn | Same pattern, different delegate call. |
| 4 | `thread:open-daily` | 428–450 | Delegate + wire-spawn | Same pattern. |
| 5 | `thread:open-agent` | 452–455 | Delegate | **Already thin (01e).** `await handleThreadOpenAgent(clientMsg)`. |
| 6 | `thread:rename` | 457–460 | Delegate | Thin. |
| 7 | `thread:delete` | 462–465 | Delegate | Thin. |
| 8 | `thread:copyLink` | 467–470 | Delegate | Thin. |
| 9 | `thread:list` | 472–475 | Delegate | Thin. |
| 10 | `file_tree_request` | 480–483 | Delegate | Thin — uses `fileExplorer` (01a). |
| 11 | `file_content_request` | 485–488 | Delegate | Thin. |
| 12 | `recent_files_request` | 490–493 | Delegate | Thin. |
| 13 | `set_panel` | 498–540 | Direct + delegate | Significant logic: resolves chat config via `views.resolveChatConfig`, calls `ThreadWebSocketHandler.setPanel`, sends `panel_changed`, conditionally sends `panel_config`. |
| 14 | `initialize` | 546–558 | Direct wire send | Uses `sendToWire` for manual wire initialize. |
| 15 | `prompt` | 561–615 | Direct + delegate | **The biggest handler.** Resolves wire via `getWireForThread`, tracks via `ThreadWebSocketHandler.handleMessageSend`, sends via `wire._sendMessage` (new harness) or `sendToWire` (legacy). System context injection. |
| 16 | `response` | 617–625 | Direct wire send | Uses `sendToWire` for response forwarding. |
| 17 | `file:move` | 627–650 | Direct | Calls `moveFileWithArchive`, emits `system:file_deployed`. |
| 18 | `robin:*` startsWith | 654–660 | Delegate (dynamic) | Reads from module-level mutable `robinHandlers[clientMsg.type]`. |
| 19 | `clipboard:*` startsWith | 664–670 | Delegate (dynamic) | Same pattern with `clipboardHandlers`. |
| 20 | `harness:get_mode` | 674–684 | Inline require + direct | `require('./lib/harness/compat')` + `require('./lib/harness/feature-flags')` inline. |
| 21 | `harness:set_mode` | 686–704 | Inline require + direct | Inline require of feature-flags. |
| 22 | `harness:rollback` | 706–715 | Inline require + direct | Inline require of compat. |
| 23 | `harness:list` | 719–734 | Inline require + direct | Inline require of lib/harness. |
| 24 | `harness:check_install` | 736–753 | Inline require + direct | Inline require of lib/harness. |
| 25 | Unknown fallthrough | 755–756 | Log only | `console.log('[WS] Unknown message type:', clientMsg.type)`. |

### Part B: `ws.on('close')` body (lines 768–783)

15 lines. Structure:

```js
ws.on('close', () => {
  console.log('[WS] Client disconnected:', connectionId.slice(0,8));
  ThreadWebSocketHandler.cleanup(ws);
  // NOTE: We do NOT kill the wire here. [detailed comment preserved verbatim]
  if (session.wire) {
    console.log('[WS] Detaching from wire (not killing), pid:', session.wire.pid);
  }
  sessions.delete(ws);
  clearSessionRoot(ws);
});
```

**Both `ws.on('message')` and `ws.on('close')` get extracted into the same factory** — they share the per-connection closure (session, ws, connectionId) and moving them together keeps the per-connection handler setup in one place.

### Not moving — stays in server.js

- The `wss.on('connection', (ws) => { ... })` callback itself stays. Its body becomes much smaller but the callback frame remains.
- Session object creation at line ~259 (`const session = { ... }`).
- The default panel setup block (lines ~324–337 — the `defaultChatConfig` + `ThreadWebSocketHandler.setPanel` call).
- The four factory calls (createWireMessageRouter from 01d, createWireLifecycle from 01c, createAgentSessionHandler from 01e, createClientMessageRouter NEW).
- The initial greeting messages at lines 789–802 (two `ws.send` calls with `type: 'connected'` and `type: 'panel_config'`).
- Module-level state: `sessions`, `sessionRoots`, `let robinHandlers = {}; let clipboardHandlers = {};`.
- Per-panel-path helpers: `setSessionRoot`, `getSessionRoot`, `clearSessionRoot`, `getPanelPath`.
- Express app setup, static middleware, SPA fallback.
- The startup sequence (`startServer({...}).then(result => { robinHandlers = ...; })`).

---

## Dependencies — `createClientMessageRouter(deps)`

The handler body references a lot. Here's the full dep list, categorized.

### Module-level imports in `lib/ws/client-message-router.js` (hoist at top of new file)

Path prefix is `../` because the new file is one level deeper (`lib/ws/`) than most lib modules.

```js
const path = require('path');
const { v4: generateId } = require('uuid');

const ThreadWebSocketHandler = require('../thread');
const { spawnThreadWire } = require('../harness/compat');
const { registerWire, getWireForThread, sendToWire } = require('../wire/process-manager');
const views = require('../views');
const { moveFileWithArchive } = require('../file-ops');
const { emit } = require('../event-bus');
```

**Do NOT hoist the inline harness requires.** The five `harness:*` handlers currently do inline `require()` calls inside their handler bodies. Preserve that. See Gotcha #3.

### Factory deps (per-connection injection)

| Dep | Type | Source | Used by |
|---|---|---|---|
| `ws` | WebSocket | per-connection closure in server.js | every send, the close handler |
| `session` | object | per-connection (line ~259 of server.js) | most handlers (mutation: `session.wire`, `session.currentThreadId`, `session.pendingUserInput`, `session.pendingSystemContext`) |
| `connectionId` | string | per-connection (line ~256) | logging in thread:create's `[WS] Message type: ... Conn: ${connectionId.slice(0,8)}` AND the close handler's `[WS] Client disconnected: ...` line |
| `projectRoot` | string | per-connection (line ~256) | `thread:create`/`open`/`open-daily` wire spawn calls (4th arg to `spawnThreadWire`) |
| `fileExplorer` | object | server.js factory call `createFileExplorerHandlers({...})` | `file_tree_request`, `file_content_request`, `recent_files_request` |
| `wireLifecycle` | object | per-connection from `createWireLifecycle({...})` (01c) | `thread:create`/`open`/`open-daily` wire spawn sequences — destructure `{ awaitHarnessReady, initializeWire, setupWireHandlers }` inside the factory |
| `handleThreadOpenAgent` | function | per-connection from `createAgentSessionHandler({...})` (01e) | `thread:open-agent` handler (line 452) |
| `sessions` | Map | server.js module-level `const sessions = new Map()` | close handler only (`sessions.delete(ws)`) |
| `setSessionRoot` | function | server.js helper | `set_panel` handler only |
| `clearSessionRoot` | function | server.js helper | close handler only |
| `getDefaultProjectRoot` | function | server.js helper | `set_panel` handler + `file:move` handler (re-resolves fresh) |
| `getRobinHandlers` | `() => object` | **getter closure** over server.js's `let robinHandlers` | `robin:*` dispatcher |
| `getClipboardHandlers` | `() => object` | **getter closure** over server.js's `let clipboardHandlers` | `clipboard:*` dispatcher |

**13 deps total.** Verbose but explicit. Each one is necessary. Do not try to group or consolidate them.

### Why getter functions for `robinHandlers` / `clipboardHandlers`

These are `let` module-level variables in server.js, initialized to `{}` and reassigned inside the `startServer().then(result => { ... })` callback from SPEC-01b. At the time `createClientMessageRouter({...})` runs (inside `wss.on('connection')`, after startup has completed), the variables are already populated — so in principle you could inject them by value.

**But:** the mutable-reference pattern (from SPEC-01b) is load-bearing. If you pass the objects by value at factory creation time, any future reassignment (e.g., a hot-reload scenario, or a startup race the executing session hasn't seen) would leave the factory with a stale reference.

**Safer:** inject getter closures. The getter closes over the `let` in server.js's scope and dereferences at call time, not at factory creation time. Server.js becomes:

```js
const { handleClientMessage, handleClientClose } = createClientMessageRouter({
  // ... other deps ...
  getRobinHandlers: () => robinHandlers,
  getClipboardHandlers: () => clipboardHandlers,
});
```

Inside the factory:

```js
if (clientMsg.type.startsWith('robin:')) {
  const handler = getRobinHandlers()[clientMsg.type];
  if (handler) {
    await handler(ws, clientMsg);
    return;
  }
}
```

The `getRobinHandlers()` call resolves the current value every time a `robin:*` message arrives. The mutable-reference pattern from SPEC-01b is preserved intact.

---

## Target — the new file

Create `open-robin-server/lib/ws/` directory if it doesn't exist (it may — 01f is the first file to land in `lib/ws/`). Then create `open-robin-server/lib/ws/client-message-router.js`.

Estimated size: **~500 lines.** Most of the volume is verbatim handler bodies; only the factory boilerplate and the minor dep-path adjustments add new lines.

### Module shape

```js
/**
 * Client Message Router — dispatches incoming WebSocket client messages.
 *
 * Extracted from server.js per SPEC-01f. This is the final extraction
 * under SPEC-01 (server.js decomposition). Handles the full 25+ handler
 * switch for client message types: thread lifecycle (create/open/
 * open-daily/rename/delete/copyLink/list), agent session (thread:
 * open-agent), file explorer (tree/content/recent), panel management
 * (set_panel), wire protocol (initialize/prompt/response), file
 * operations (file:move), robin system panel (robin:*), clipboard
 * (clipboard:*), and harness admin (harness:get_mode/set_mode/
 * rollback/list/check_install).
 *
 * Also handles ws.on('close') for per-connection cleanup.
 *
 * Per-connection factory. Called once per WebSocket connection inside
 * wss.on('connection'), after all the other factories have been
 * created (wire lifecycle, wire message router, agent session handler,
 * file explorer). Closes over ws, session, connectionId, projectRoot,
 * and the per-connection helpers.
 *
 * Architectural note: most of the handlers in this module are thin
 * delegations to already-extracted modules. The three wire-spawning
 * handlers (thread:create, thread:open, thread:open-daily) share a
 * visible repeated wire-spawn sequence — the repetition is intentional
 * for this extraction and is a candidate for post-SPEC-01 DRY cleanup.
 */

const path = require('path');
const { v4: generateId } = require('uuid');

const ThreadWebSocketHandler = require('../thread');
const { spawnThreadWire } = require('../harness/compat');
const { registerWire, getWireForThread, sendToWire } = require('../wire/process-manager');
const views = require('../views');
const { moveFileWithArchive } = require('../file-ops');
const { emit } = require('../event-bus');

/**
 * Create a per-connection client message router.
 *
 * @param {object} deps
 * @param {import('ws').WebSocket} deps.ws
 * @param {object} deps.session - per-connection session state (mutated)
 * @param {string} deps.connectionId
 * @param {string} deps.projectRoot
 * @param {object} deps.fileExplorer - from createFileExplorerHandlers (01a)
 * @param {{ awaitHarnessReady, initializeWire, setupWireHandlers }} deps.wireLifecycle - from createWireLifecycle (01c)
 * @param {(clientMsg: object) => Promise<void>} deps.handleThreadOpenAgent - from createAgentSessionHandler (01e)
 * @param {Map} deps.sessions - server.js module-level sessions Map (for close handler)
 * @param {Function} deps.setSessionRoot
 * @param {Function} deps.clearSessionRoot
 * @param {() => string} deps.getDefaultProjectRoot
 * @param {() => object} deps.getRobinHandlers - getter closure over server.js let robinHandlers
 * @param {() => object} deps.getClipboardHandlers - getter closure over server.js let clipboardHandlers
 * @returns {{ handleClientMessage: Function, handleClientClose: Function }}
 */
function createClientMessageRouter({
  ws,
  session,
  connectionId,
  projectRoot,
  fileExplorer,
  wireLifecycle,
  handleThreadOpenAgent,
  sessions,
  setSessionRoot,
  clearSessionRoot,
  getDefaultProjectRoot,
  getRobinHandlers,
  getClipboardHandlers,
}) {

  const { awaitHarnessReady, initializeWire, setupWireHandlers } = wireLifecycle;

  async function handleClientMessage(message) {
    const text = message.toString();
    console.log('[WS →]:', text.slice(0, 200));

    try {
      const clientMsg = JSON.parse(text);
      console.log('[WS] Message type:', clientMsg.type, 'Conn:', session.connectionId.slice(0,8), 'Has wire:', !!session.wire, 'Wire pid:', session.wire?.pid || 'none');

      // === Thread Management Messages ===

      // Client logging - forward to server logs
      if (clientMsg.type === 'client_log') {
        const { level, message, data, timestamp } = clientMsg;
        console.log(`[CLIENT ${level.toUpperCase()}] ${message}`, data || '');
        return;
      }

      if (clientMsg.type === 'thread:create') {
        // ... verbatim from server.js:357-391, with no changes ...
        return;
      }

      // ... all 25+ handlers, each verbatim ...

      // === Harness admin — inline requires preserved ===

      if (clientMsg.type === 'harness:get_mode') {
        const { getModeStatus } = require('../harness/compat');        // path rewrite
        const { getHarnessMode } = require('../harness/feature-flags'); // path rewrite
        // ... rest verbatim ...
        return;
      }

      // ... etc ...

      // Unknown message type
      console.log('[WS] Unknown message type:', clientMsg.type);

    } catch (err) {
      console.error('[WS] Message handling error:', err);
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  }

  function handleClientClose() {
    console.log('[WS] Client disconnected:', connectionId.slice(0,8));

    // Clean up thread state
    ThreadWebSocketHandler.cleanup(ws);

    // NOTE: We do NOT kill the wire here. The wire is tied to the thread,
    // not the WebSocket connection. Other connections may need to use it.
    // The wire will timeout naturally after 9 minutes of idle.
    if (session.wire) {
      console.log('[WS] Detaching from wire (not killing), pid:', session.wire.pid);
    }

    sessions.delete(ws);
    clearSessionRoot(ws);
  }

  return { handleClientMessage, handleClientClose };
}

module.exports = { createClientMessageRouter };
```

**Transcribe the current `ws.on('message')` body character-for-character into `handleClientMessage`** and the current `ws.on('close')` body into `handleClientClose`. The transformations are narrow:

1. `robinHandlers[clientMsg.type]` → `getRobinHandlers()[clientMsg.type]`
2. `clipboardHandlers[clientMsg.type]` → `getClipboardHandlers()[clientMsg.type]`
3. Inline `require('./lib/harness/compat')` → `require('../harness/compat')` (and likewise for `feature-flags`, `lib/harness`)
4. `ThreadWebSocketHandler` — already a module-level import in the new file; no rewrite.
5. `fileExplorer.handleFileTreeRequest(...)` → same (injected as a dep, same property access)
6. `handleThreadOpenAgent(clientMsg)` → same (injected as a dep)
7. `sessionRoots` is NOT referenced directly; only `setSessionRoot` and `clearSessionRoot` are called. No rewrite beyond injection.
8. `sessions.delete(ws)` in close handler — `sessions` is injected as a dep.

Nothing else in the handler bodies changes. Every other line is verbatim.

---

## Wiring — what changes in server.js

### 1. Add the import at the top of server.js

Near the other `lib/` imports (around lines 53–67):

```js
const { createClientMessageRouter } = require('./lib/ws/client-message-router');
```

### 2. Call the factory inside `wss.on('connection')`

**Order matters.** The client router factory must be called AFTER the wire message router, wire lifecycle, and agent session handler factories, because it depends on their outputs.

Inside `wss.on('connection', (ws) => { ... })`, after the existing factory calls from 01c–e, add:

```js
// Per-connection client message router (SPEC-01f). Depends on the
// wire lifecycle, agent session handler, and file explorer. Must be
// created AFTER those factories.
const { handleClientMessage, handleClientClose } = createClientMessageRouter({
  ws,
  session,
  connectionId,
  projectRoot,
  fileExplorer,
  wireLifecycle: { awaitHarnessReady, initializeWire, setupWireHandlers },
  handleThreadOpenAgent,
  sessions,
  setSessionRoot,
  clearSessionRoot,
  getDefaultProjectRoot,
  getRobinHandlers: () => robinHandlers,
  getClipboardHandlers: () => clipboardHandlers,
});
```

### 3. Replace `ws.on('message')` and `ws.on('close')` with thin wire-ups

Delete the entire `ws.on('message', async (message) => { ... })` block (lines 339–762) and the entire `ws.on('close', () => { ... })` block (lines 768–783). Replace with:

```js
ws.on('message', handleClientMessage);
ws.on('close', handleClientClose);
```

Two lines replacing ~440.

### 4. The initial greeting messages STAY inline

Lines 789–802 (two `ws.send` calls for `type: 'connected'` and `type: 'panel_config'`) stay in `wss.on('connection')` exactly where they are. They run once per connection at connect time, not in response to a client message. They're initialization, not dispatch.

### 5. Verify all references are gone

```bash
# Should return zero matches
grep -n "clientMsg.type" open-robin-server/server.js

# Should return zero matches
grep -n "ws.on('message'" open-robin-server/server.js

# Should return zero matches (close handler moved)
grep -n "ws.on('close'" open-robin-server/server.js

# Should return exactly two matches: one import, one factory call
grep -n "createClientMessageRouter" open-robin-server/server.js

# Should return exactly two matches: the wire-ups
grep -n "handleClientMessage\|handleClientClose" open-robin-server/server.js

# Should return only modules that use it internally — NOT server.js itself
grep -n "robinHandlers\[" open-robin-server/server.js
# → zero matches (moved to the router via getRobinHandlers getter)

grep -n "clipboardHandlers\[" open-robin-server/server.js
# → zero matches

# Final server.js line count
wc -l open-robin-server/server.js
# Should report approximately 500 lines, down from 828
```

---

## Gotchas — preserve these exactly

### 1. Session closure scope

The factory captures `session`, `ws`, `connectionId`, `projectRoot` via the destructured deps. Each WS connection calls the factory once, getting its own independent closure. Do not hoist the factory call outside `wss.on('connection')`.

Specific mutations the handlers make to `session`:
- `session.wire` (set, killed, nulled)
- `session.currentThreadId`
- `session.pendingUserInput`
- `session.pendingSystemContext`

All these mutations must continue to operate on the per-connection session object. Because the factory closes over `session` via destructuring, each connection's `handleClientMessage` operates on its own `session` instance. Correct by construction — **but only if the factory is called inside the connection handler.**

### 2. Do not DRY the three wire-spawn sequences

`thread:create` (lines 357–391), `thread:open` (393–426), and `thread:open-daily` (428–450) all have a repeated sequence:

```js
session.wire = spawnThreadWire(threadId, projectRoot);
registerWire(threadId, session.wire, projectRoot, ws);
await awaitHarnessReady(session.wire);
setupWireHandlers(session.wire, threadId);
initializeWire(session.wire);
// ... plus threadManager.openSession(...)
```

It's tempting to extract this into a `spawnAndWireup(threadId)` helper. **Do not.** This spec is mechanical extraction. Preserve the repetition verbatim. The DRY cleanup is a candidate for a post-SPEC-01 follow-up — specifically, once the 6 extractions are all landed and the shape is settled, that helper can emerge naturally.

If you find yourself writing a shared helper, stop and move the code back to verbatim copies.

### 3. Inline harness requires stay inline, with path rewrites

The five `harness:*` handlers do inline `require('./lib/harness/*')` calls:

- `harness:get_mode`: `require('./lib/harness/compat')` + `require('./lib/harness/feature-flags')`
- `harness:set_mode`: `require('./lib/harness/feature-flags')`
- `harness:rollback`: `require('./lib/harness/compat')`
- `harness:list`: `require('./lib/harness')`
- `harness:check_install`: `require('./lib/harness')`

**Preserve the inline pattern.** Do NOT hoist these to module-level requires in the new file. The inline pattern is deliberate — these modules are only needed when an admin-triggered harness command arrives, which is rare. Hoisting them would load the harness management stack at module-load time unnecessarily.

**Do update the paths** — from the new file's location (`lib/ws/client-message-router.js`), the path prefix changes:

| Old | New |
|---|---|
| `./lib/harness/compat` | `../harness/compat` |
| `./lib/harness/feature-flags` | `../harness/feature-flags` |
| `./lib/harness` | `../harness` |

### 4. `ThreadWebSocketHandler` vs injected `threadWebSocketHandler`

Unlike the 01e extraction (agent-session-handler), which injects `threadWebSocketHandler` lowercase as a factory dep, **this spec imports `ThreadWebSocketHandler` at the top of the new file as a module-level require**:

```js
const ThreadWebSocketHandler = require('../thread');
```

The reason is cost-benefit: the client router calls `ThreadWebSocketHandler.*` methods ~10 times (`handleThreadCreate`, `handleThreadOpen`, `handleThreadOpenDaily`, `handleThreadRename`, `handleThreadDelete`, `handleThreadCopyLink`, `sendThreadList`, `handleMessageSend`, `setPanel`, `getState`, `cleanup`, `getCurrentThreadId`). Injecting it would make the factory dep list ugly and provide no benefit — the module reference is stable across the whole process lifetime.

So: **direct require.** Handler bodies reference `ThreadWebSocketHandler.*` unchanged.

### 5. Initial greeting messages stay in server.js

The two `ws.send` calls at lines 789–802 (one for `type: 'connected'`, one for `type: 'panel_config'`) run ONCE per connection at connect time. They are not dispatch — they're initialization. Keep them in `server.js` inside `wss.on('connection')`, after all the factory calls. They use `connectionId`, `projectRoot`, and `path.basename(projectRoot)` — all available in that scope.

### 6. `generateId` is used in the new module

`generateId` (aliased from `uuid.v4`) is referenced inside the `initialize` handler (line 551) and the `prompt` handler (line 603). Import it at the top of the new file:

```js
const { v4: generateId } = require('uuid');
```

### 7. The outer try/catch wraps the entire handler body

The current code has:

```js
ws.on('message', async (message) => {
  const text = message.toString();
  console.log(...);
  try {
    const clientMsg = JSON.parse(text);
    // ... all 25 handlers ...
  } catch (err) {
    console.error('[WS] Message handling error:', err);
    ws.send(JSON.stringify({ type: 'error', message: err.message }));
  }
});
```

**Preserve the try/catch structure exactly.** The message parse happens inside the try (so a malformed JSON triggers the catch and sends an error). The `text = message.toString()` and the first `console.log('[WS →]:', ...)` happen OUTSIDE the try (they don't throw). Preserve that layout.

### 8. `robinHandlers` / `clipboardHandlers` use getter functions

See the "Why getter functions" section above. In the handler body:

```js
if (clientMsg.type.startsWith('robin:')) {
  const handler = getRobinHandlers()[clientMsg.type];
  if (handler) {
    await handler(ws, clientMsg);
    return;
  }
}
```

**Do NOT destructure `robinHandlers` / `clipboardHandlers` from deps at factory creation time.** The values are `{}` until the startup sequence completes; destructuring would freeze an empty object. Call the getter every time a message arrives.

### 9. `handleClientMessage` and `handleClientClose` names (not `handleMessage`)

The 01d factory (`createWireMessageRouter`) returns `{ handleMessage }`. If you also name the 01f factory return `{ handleMessage, handleClose }`, you get a name collision in `wss.on('connection')` where both are destructured. **Use different names: `handleClientMessage`, `handleClientClose`.** The "client" prefix distinguishes them from the wire message router's handler.

### 10. `file:move` preserves the `emit('system:file_deployed', ...)` call

The `file:move` handler at lines 627–650 calls `moveFileWithArchive`, then emits `system:file_deployed`, then sends `file:moved` or `file:move_error` to the client. The `emit` call is NOT a `chat:*` event — it's a system event. It continues to go through the bus. `moveFileWithArchive` and `emit` are both module-level imports in the new file.

### 11. `set_panel` has its own local shadowing of `projectRoot`

At line 501, the `set_panel` handler does `const projectRoot = getDefaultProjectRoot();` — shadowing the per-connection `projectRoot` from the outer scope. This is a fresh re-resolution in case config changed mid-session. **Preserve the local re-declaration verbatim.** Do not collapse it to use the outer `projectRoot`.

Same thing happens in `file:move` at line 630.

### 12. Unknown message types still log but do not send errors

At line 755–756, unknown message types just `console.log` and fall through. They do NOT send an error to the client. Preserve this: if you're tempted to add `ws.send({ type: 'error', message: 'Unknown type' })`, don't.

### 13. The close handler's detailed comment block preserves verbatim

Lines 774–776:

```js
// NOTE: We do NOT kill the wire here. The wire is tied to the thread,
// not the WebSocket connection. Other connections may need to use it.
// The wire will timeout naturally after 9 minutes of idle.
```

Keep this comment exactly in `handleClientClose`. It documents a critical invariant.

### 14. `ThreadWebSocketHandler.cleanup(ws)` must come before `sessions.delete(ws)`

Order matters in the close handler. `cleanup(ws)` reads thread state from its internal Map (keyed by ws), using the ws as the lookup. If `sessions.delete(ws)` ran first (or at all — it doesn't affect the thread cleanup), it would be harmless in the current code because they're different Maps, but preserve the current order anyway.

---

## Verification checklist

### Sanity checks (static)

1. `wc -l open-robin-server/server.js` — approximately 500 lines (down from 828).
2. `wc -l open-robin-server/lib/ws/client-message-router.js` — approximately 500 lines.
3. `node -e "require('./open-robin-server/lib/ws/client-message-router')"` — loads clean.
4. `node -e "require('./open-robin-server/server.js')"` — EADDRINUSE acceptable; any SyntaxError/ReferenceError/TypeError is a fail.
5. Grep checks from "Verify all references are gone" above — all must pass.
6. `node -e "require('./open-robin-server/server.js'); console.log(typeof global.__agentWireSessions);"` — should still print `object` (the 01e transitive load chain is untouched).

### Runtime checks

Run `./restart-kimi.sh`. If it fails, stop and report.

7. `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/` → `200`.
8. `tail -50 open-robin-server/server-live.log` — clean startup, no errors.

### Regression tests (every feature must still work)

These exercise every message type the router dispatches. If any of them fail, a handler was lost or mis-wired during the extraction.

9. **Chat round-trip (normal)** — create a new thread, send a message, receive the assistant response. Exercises: `thread:create`, `prompt`, `client_log`, the wire spawn sequence, and the 01d wire message router returning events.
10. **Open existing thread** — click an existing thread in the list, verify it loads. Exercises: `thread:open`, the wire spawn sequence, and history loading.
11. **File explorer** — navigate folders, click a file, see content. Exercises: `file_tree_request`, `file_content_request`. (`recent_files_request` if the UI surfaces it.)
12. **Set panel** — switch between views (code-viewer → capture-viewer → wiki-viewer). Exercises: `set_panel`, thread list refresh.
13. **Thread rename / delete / copy link** — if the UI exposes these, exercise them. They're thin delegations so the risk is low.
14. **Robin system panel** — click the raven icon, panel should populate. Exercises: `robin:*` dispatch via the getter function. **This is the specific test for Gotcha #8** (getter-function pattern for mutable handler refs).
15. **Clipboard** — if the UI surfaces it, copy/paste through the clipboard manager. Exercises: `clipboard:*` dispatch via getter function.
16. **File move** — if the UI surfaces it, drag a file between folders. Exercises: `file:move` handler, `moveFileWithArchive`, `emit('system:file_deployed', ...)`.
17. **Agent session** — open an agent persona (if you have one configured). Exercises: `thread:open-agent` → `handleThreadOpenAgent` delegation. Regression check for SPEC-01e.
18. **Harness admin** — if the UI exposes harness mode switching, exercise `harness:get_mode`. Otherwise verify that the inline requires at least load without error (implicit in runtime check #4).

### Disconnect test

19. Close the browser tab. Server log should show `[WS] Client disconnected: ${connectionId}` and no errors. The wire should NOT be killed (per Gotcha #13's comment). Tail the log to verify.

20. `./restart-kimi.sh` at the very end to confirm a clean shutdown-restart cycle after the full extraction.

---

## What NOT to do

- **Do not** DRY the three wire-spawn sequences (Gotcha #2).
- **Do not** hoist the inline harness requires (Gotcha #3).
- **Do not** use value injection for `robinHandlers` / `clipboardHandlers` (Gotcha #8).
- **Do not** collapse the local `projectRoot` shadowing in `set_panel` / `file:move` (Gotcha #11).
- **Do not** split the file into sub-files (e.g. `client-router/thread-handlers.js`, `client-router/harness-handlers.js`). That's a follow-up spec. This extraction is a single-file move.
- **Do not** rename the handler functions to drop the "Client" prefix (Gotcha #9).
- **Do not** add error responses for unknown message types (Gotcha #12).
- **Do not** reorder `cleanup(ws)` and `sessions.delete(ws)` in the close handler (Gotcha #14).
- **Do not** touch the initial greeting messages at server.js lines 789–802 (Gotcha #5).
- **Do not** touch the session object creation or the default panel setup at the top of `wss.on('connection')`.
- **Do not** move the startup sequence (`startServer({...}).then(...)`).
- **Do not** move `let robinHandlers = {}; let clipboardHandlers = {};` out of server.js — they stay as module-level state.
- **Do not** touch `sessions`, `sessionRoots`, `setSessionRoot`, `getSessionRoot`, `clearSessionRoot`, `getPanelPath`, `getDefaultProjectRoot`, or `AI_PANELS_PATH`. They stay in server.js.
- **Do not** push the commit. Commit locally only.
- **Do not** update this spec doc.
- **Do not** mark SPEC-01 complete until the user verifies and confirms.

---

## Commit

One commit. Message:

```
Extract client message router from server.js into lib/ws/

Part 6 of 6 under SPEC-01 (server.js decomposition). This is the
FINAL extraction — after this lands, server.js is a thin entry
point (~500 lines) and SPEC-01 is complete.

- NEW: lib/ws/client-message-router.js (~500 lines)
  Per-connection factory createClientMessageRouter({ ws, session,
  connectionId, projectRoot, fileExplorer, wireLifecycle,
  handleThreadOpenAgent, sessions, setSessionRoot, clearSessionRoot,
  getDefaultProjectRoot, getRobinHandlers, getClipboardHandlers })
  returning { handleClientMessage, handleClientClose }.

  Handles the full 25+ client message type dispatch:
  - Thread lifecycle (create / open / open-daily / rename / delete /
    copyLink / list) with the repeated wire-spawn sequence preserved
    verbatim
  - Agent session via handleThreadOpenAgent delegation (01e)
  - File explorer via fileExplorer.* delegation (01a)
  - Panel management (set_panel)
  - Wire protocol (initialize / prompt / response)
  - File operations (file:move with emit('system:file_deployed'))
  - Robin system panel (robin:* dispatch via getRobinHandlers getter)
  - Clipboard (clipboard:* dispatch via getClipboardHandlers getter)
  - Harness admin (5 handlers with inline requires preserved, paths
    rewritten from ./lib/harness/* to ../harness/*)

  Also moves the ws.on('close') cleanup handler.

  getter function pattern for robinHandlers / clipboardHandlers
  preserves the mutable-reference pattern from SPEC-01b — the router
  reads the current value at message-dispatch time, not at factory
  creation time.

- MODIFIED: server.js (828 -> ~500 lines)
  - Adds import for createClientMessageRouter
  - Adds factory call inside wss.on('connection') after the wire
    message router, wire lifecycle, and agent session handler factories
  - Replaces the 423-line ws.on('message') body and the 15-line
    ws.on('close') body with two thin event wire-ups:
      ws.on('message', handleClientMessage);
      ws.on('close', handleClientClose);
  - Preserves the initial greeting messages (type: 'connected' and
    type: 'panel_config') inline after the factory calls

Preserves:
  - Session closure semantics
  - The three repeated wire-spawn sequences (no DRY cleanup — that's
    a candidate for post-SPEC-01 follow-up)
  - Inline harness requires (lazy loading of admin modules)
  - The set_panel / file:move local projectRoot shadowing
  - global.__agentWireSessions transitive load chain (untouched)
  - checkSettingsBounce atomicity (untouched, in the 01d wire message
    router)
  - Mutable-reference pattern for robinHandlers / clipboardHandlers,
    accessed via getter functions injected into the router factory

server.js final trajectory: 1752 -> 1394 (01a) -> 1274 (01b) -> 1178 (01c)
                            -> 919 (01d) -> 828 (01e) -> ~500 (01f)

SPEC-01 decomposition complete.
```

**Commit only. Do not push.**

---

## Reporting back

When you're done, report:

1. **Line counts** — wc -l for server.js and the new client-message-router.js.
2. **Verification results** — each of the 20 checks with a one-line result.
3. **Regression test results** — specifically confirm each of #9 through #18 that exercised a feature. If you can't drive one (e.g., no agent persona configured, no clipboard UI), say so and skip it.
4. **Deviations from spec** — any judgment calls.
5. **Commit hash.**
6. **Anything unexpected** — particularly:
   - Any handler that referenced something you had to inject that isn't in the dep list above
   - Name collisions you had to resolve
   - Path rewrites you made beyond the ones documented
   - Regression in any feature that USED to work
7. **Confirmation that the mutable-reference pattern works under the getter function approach** — specifically, open the Robin panel after restart and confirm it populates. If the Robin panel is blank, the getter pattern broke.

If a regression test fails, stop and report precisely which handler is broken and how. The most likely failure modes for this spec:

- **Lost handler:** a message type fell through the copy-paste. Symptom: a feature silently stops working while other features are fine. Fix: diff the original ws.on('message') body against the new handleClientMessage body line-by-line.
- **Path rewrite miss:** an inline require still has `./lib/harness/...` instead of `../harness/...`. Symptom: `Cannot find module './lib/harness/compat'`. Fix: update the path.
- **Getter vs value confusion:** robinHandlers destructured at factory creation time instead of via getter. Symptom: Robin panel blank; `[WS]` log shows `robin:*` messages but no handler runs. Fix: convert to getter pattern per Gotcha #8.
- **Session closure bleed:** factory called at module load instead of inside wss.on('connection'). Symptom: chat appears in wrong tab, or session state corrupted across connections. Fix: move factory call inside the connect callback.

---

## Files you will touch

- `open-robin-server/lib/ws/client-message-router.js` — NEW, ~500 lines (you may need to create the `lib/ws/` directory)
- `open-robin-server/server.js` — MODIFIED, delete ~440 lines (message + close handler bodies), add 1 import + ~18 lines of wiring (factory call + two event wire-ups)

Two files total. One new, one modified. One commit.

---

## After this SPEC lands

**SPEC-01 is complete.** The six-extraction decomposition of server.js from 1752 lines into six focused modules plus a thin entry point is done.

The user and IDE session will:

1. Verify the work here (line counts, static greps, regression tests).
2. Append a "SPEC-01f — Client Message Router" section to REFACTOR-LOG.md with the observations.
3. Append a "SPEC-01 complete" meta-summary to REFACTOR-LOG.md covering the full decomposition.
4. Commit the REFACTOR-LOG updates.
5. Push all commits from the checkpoint (`12e86f4`) through the final SPEC-01 commit to origin as one coordinated batch.
6. Close out task #5 in the IDE session's task list.

Then the conversation moves to post-SPEC-01 work. Candidates on the roadmap (from the REFACTOR-LOG follow-ups):

- Fix the memory-mtime session-invalidation no-op bug in `agent-session-handler.js` (Gotcha #7 from 01e)
- Fix the `workspace: 'code-viewer'` hardcoding in `message-router.js` chat emits (01d follow-up)
- DRY the three wire-spawn sequences into a helper (01f follow-up from this spec's Gotcha #2)
- Clean up stale doc comments (`process-manager.js:16`, any others discovered)
- Archive or delete the stale `DEBUG-robin-overlay-blank.md`
- Introduce the Open Robin canonical thread ID architecture (user's longer-term plan from the 01d decision-making phase)
- SPEC-23b through 23f (chunking queue work) — unblocked now that SPEC-23a has been absorbed into SPEC-01d

**Do not start any of those during SPEC-01f.** This spec's job is just the extraction. Stop after SPEC-01f lands and let the user drive the next cycle.
