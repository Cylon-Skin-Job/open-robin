# server.js Refactor Plan

## What Went Wrong

`server.js` is 1,752 lines. It contains all of the following crammed into a single file:

- Static file serving
- REST API routes (`/api/harnesses`, `/api/panel-file`, `/api/harnesses/:id/status`)
- File tree reading and path resolution logic
- File content reading and path security checks
- Recent files scanning (recursive `scanDir`)
- Wire process spawning, registration, and teardown
- ACP vs Kimi-wire protocol detection and routing (`awaitHarnessReady`, `initializeWire`, `_harnessPromise` checks)
- Wire message parsing (raw line buffering, JSON.parse)
- Wire message handling — all event type switching (`TurnBegin`, `ContentPart`, `ThinkingPart`, `ToolCall`, `ToolResult`, `TurnEnd`, `StepBegin`, `StatusUpdate`, etc.)
- Thread open/create/daily/agent routing
- WebSocket message routing (40+ `clientMsg.type` branches inside one `ws.on('message')` handler)
- Session state management (per-connection objects tracking wire, buffer, currentTurn, pendingUserInput, pendingSystemContext, etc.)
- Auto-rename trigger logic
- Clipboard handling
- Harness status polling
- Inline hacks added during debugging: `session.pendingUserInput`, `wire._sendMessage`, `wire._harnessPromise`, `session.wire === wire` identity checks

None of this belongs in one file. The original direction was bolt-on modules and a route controller pattern. That was not followed.

---

## What the Architecture Should Be

```
kimi-ide-server/
  server.js                        ← Entry point only: mount routes, start HTTP/WS
  routes/
    api.js                         ← REST routes (/api/*)
    ws.js                          ← WebSocket server setup, delegates to controllers
  controllers/
    wire-controller.js             ← All wire lifecycle: spawn, init, teardown, reconnect
    message-controller.js          ← All ws.on('message') routing — one handler per type
    file-controller.js             ← File tree, file content, recent files
    thread-controller.js           ← Thread open/create/daily/agent (delegates to ThreadWebSocketHandler)
    clipboard-controller.js        ← Clipboard read/write
    harness-controller.js          ← Harness status, selection
  lib/
    wire/
      wire-registry.js             ← Wire registration map (already exists, stays)
      wire-session.js              ← Per-connection session state (extracted from closure)
      wire-message-handler.js      ← TurnBegin/ContentPart/TurnEnd/etc. event switch
      wire-protocol.js             ← sendToWire, kimi-wire format helpers
    harness/                       ← Already modular, stays as-is
    thread/                        ← Already modular, stays as-is
```

---

## Refactor Order

### Step 1 — Extract wire message handling
`handleWireMessage` is 270 lines of event-type switching. Extract to `lib/wire/wire-message-handler.js`. It receives a canonical wire message and a context object (ws, session) and dispatches. No logic in server.js.

### Step 2 — Extract wire lifecycle
`setupWireHandlers`, `initializeWire`, `awaitHarnessReady`, `sendToWire`, `registerWire`, `unregisterWire` → `controllers/wire-controller.js`. Export: `spawnAndConnect(threadId, projectRoot, ws, session)` — one call that does the whole spawn → await → attach → init sequence.

### Step 3 — Extract file operations
`handleFileTreeRequest`, `handleFileContentRequest`, `handleRecentFilesRequest`, `isPathAllowed`, `parseExtension`, `getPanelPath`, `mapFileErrorCode` → `controllers/file-controller.js`.

### Step 4 — Extract WebSocket message router
The `ws.on('message')` handler (currently ~600 lines) → `controllers/message-controller.js`. Each `clientMsg.type` becomes a named method. The controller imports wire-controller, file-controller, thread-controller. server.js just calls `messageController.handle(ws, message, session)`.

### Step 5 — Extract session state
The per-connection `session` object (wire, buffer, currentTurn, pendingUserInput, etc.) → `lib/wire/wire-session.js`. A factory function `createSession()` returns a clean state object with defined shape. No more ad-hoc property additions during debugging.

### Step 6 — Fix the ACP prompt routing properly
`sendToWire` writes Kimi-wire format. Non-Kimi harnesses speak ACP. The translation belongs in `lib/wire/wire-protocol.js` as `sendPrompt(wire, userInput, options)` — it checks if the wire has a harness session and routes accordingly. No `wire._sendMessage` hacks on the process object. No `if (wire._harnessPromise)` checks scattered in server.js.

### Step 7 — server.js becomes 50 lines
```js
const app = express();
const { createApiRouter } = require('./routes/api');
const { createWsServer } = require('./routes/ws');

app.use('/api', createApiRouter());
app.use(express.static(distPath));
app.get(/.*/, (req, res) => res.sendFile(indexPath));

const server = app.listen(PORT);
createWsServer(server);
```

---

## Rules for the Refactor

1. **Kimi goes first.** Get the Kimi wire working identically through the new module structure before touching any other harness.
2. **One module, one job.** If a file parses wire events, it does not also manage session state.
3. **No logic in server.js.** server.js mounts things. It does not contain conditionals.
4. **Protocol translation in the protocol layer.** ACP vs Kimi-wire conversion lives in `lib/wire/wire-protocol.js`, not scattered as duck-typed properties on process objects.
5. **Session state has a defined shape.** No ad-hoc property additions during debugging. If a field is needed, add it to the factory in `wire-session.js`.
6. **No `wire._anything` hacks.** If the wire needs to carry metadata, define it in wire-session, not on the child process object.
