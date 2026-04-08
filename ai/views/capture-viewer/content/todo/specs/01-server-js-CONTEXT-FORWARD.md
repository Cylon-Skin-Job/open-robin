# SPEC-01 Context Forward — server.js Decomposition

This document is the resume-from-compact context for the final refactoring task. Claude and the user will tackle this together after compacting. Read this entire file before touching code.

---

## Session state at the point of this document

**Completed specs (14):** 02, 03, 04, 05a, 05b, 06, 08, 10, 15, 16, 17, 18, 19, 21 — all verified working.

**Remaining:**
- **SPEC-01** (this task) — server.js decomposition
- **SPEC-11** — compat.js cleanup, deferred until after SPEC-01 per conversation with user

**Workflow convention:**
- The user compacts the session, then we pair on SPEC-01 together
- This is NOT a background handoff to another session — user wants to sit with this one
- Opus 4.6 recommended for the session. User has been using 1M context window
- User says "restart the server" → full nuke: kill port 3001, delete dist/, delete node_modules/.vite, fresh build, fresh start, verify 200 OK

---

## Current state of server.js

**File:** `/Users/rccurtrightjr./projects/open-robin/open-robin-server/server.js`
**Size:** 1752 lines (unchanged by the thread/ws-client refactoring — those specs extracted code that server.js *depends on*, not code *inside* server.js)
**30 cases + 21 top-level functions**

### All function definitions with line numbers

| Function | Line | Purpose |
|----------|------|---------|
| `logWire` | 75 | Wire debug log rotation |
| `getWireForThread` | 188 | Global wire registry lookup |
| `registerWire` | 192 | Register wire by threadId |
| `unregisterWire` | 197 | Remove wire from registry |
| `getDefaultProjectRoot` | 206 | Resolve project root from config |
| `setSessionRoot` | 226 | Per-panel session root tracking |
| `getSessionRoot` | 231 | Read session root |
| `clearSessionRoot` | 239 | Clear session roots on disconnect |
| `getPanelPath` | 243 | Resolve panel content path via view resolver |
| `mapFileErrorCode` | 266 | fs error code translation |
| `isPathAllowed` | 287 | Two-pass path security check (logical + symlink) |
| `parseExtension` | 319 | File extension parser |
| `handleFileTreeRequest` | 325 | Folder listing (async) |
| `handleFileContentRequest` | 454 | File read with panel enrichment (async) |
| `handleRecentFilesRequest` | 540 | Recursive recent files scan (async) |
| `sendToWire` | 639 | JSON-RPC 2.0 marshaling to wire stdin |
| **Inside `wss.on('connection')` callback:** | | |
| `awaitHarnessReady` | 710 | Wait for `_harnessPromise` on new-harness wires |
| `initializeWire` | 718 | Send ACP initialize message |
| `setupWireHandlers` | 734 | Attach stdout/exit listeners to wire process |
| `handleWireMessage` | 768 | **THE BIG ONE** — 10 event type cases, 270 lines |
| `startServer` | 1639 | Bootstrap sequence (DB → handlers → watcher → triggers → cron → listen) |

### WebSocket handlers

- `ws.on('message', async (message) => {...})` at line **1043** — 25+ client message types, 527 lines
- `ws.on('close', () => {...})` at line **1575** — cleanup

### Global state (lines 176-224)

```javascript
const sessions = new Map();              // ws → session state object
const wireRegistry = new Map();          // threadId → { wire, projectRoot }
const agentWireSessions = new Map();     // agentName → wire (persona sessions)
global.__agentWireSessions = agentWireSessions;  // CRITICAL: read by runner
const sessionRoots = new Map();          // ws → { panel, rootFolder }
const AI_PANELS_PATH = ...;              // resolved ai/views/ path
```

### Session state object (created per-WebSocket at line 669)

```javascript
const session = {
  connectionId, wire: null, currentTurn: null, buffer: '',
  toolArgs: {}, activeToolId: null, hasToolCalls: false,
  currentThreadId: null, assistantParts: [],
  contextUsage: null, tokenUsage: null, messageId: null, planMode: false
};
```

Captured by closure in: `awaitHarnessReady`, `initializeWire`, `setupWireHandlers`, `handleWireMessage`, and the entire `ws.on('message')` handler. This is the biggest extraction landmine.

---

## The 14 jobs currently in server.js (original audit analysis)

| Job | Lines | Description |
|-----|-------|-------------|
| 1 | 1-58 | Imports (20+ requires) |
| 2 | 61-87 | Logging infrastructure (wire debug, server-live.log) |
| 3 | 89-174 | Express setup + HTTP routes (4 API endpoints + SPA fallback) |
| 4 | 176-264 | Global state (sessions, wireRegistry, agentWireSessions, sessionRoots, panel path resolution) |
| 5 | 266-630 | **File explorer** — path validation, tree, content, recent files |
| 6 | 639-656 | Wire process helpers (sendToWire JSON-RPC marshaling) |
| 7 | 662-700 | Session state object + per-connection setup |
| 8 | 710-766 | Wire initialization + stdout/exit handlers |
| 9 | 768-1037 | **Wire message router** — handleWireMessage with 10 event types + enforcement |
| 10 | 1043-1569 | **Client message router** — 25+ message types |
| 11 | 1156-1262 | **Agent session handler** — thread:open-agent (embedded in client router) |
| 12 | 1575-1609 | WS disconnect + initial greeting |
| 13 | 1616-1741 | **Startup orchestrator** — DB init, handlers, watcher, triggers, cron |
| 14 | 1744-1752 | Process signal handlers (SIGTERM/SIGINT) |

### The 10 wire event types (lines 768-1037)

| Event | Lines | Notes |
|-------|-------|-------|
| `TurnBegin` | 783-803 | Create turn, emit event, ignore spurious startup turns |
| `ContentPart` | 805-844 | Text/think parts, history tracking |
| `ToolCall` | 846-868 | Mark tool call, track in assistantParts |
| `ToolCallPart` | 871-874 | Accumulate tool arguments |
| `ToolResult` | 877-932 | **HARDWIRED ENFORCEMENT via `checkSettingsBounce` at line 886** |
| `TurnEnd` | 935-979 | Save assistant message, emit event, reset state |
| `StepBegin` | 982 | Forward to client |
| `StatusUpdate` | 985-1006 | Context/token usage, flows to audit-subscriber |
| `request` (method) | 1015-1021 | Forward agent requests to client |
| `response` (method) | 1025-1031 | Forward responses to client |

### The 25+ client message types (lines 1043-1569)

| Group | Types | Lines | Notes |
|-------|-------|-------|-------|
| Logging | `client_log` | 1055-1059 | Forward browser logs to server console |
| Thread CRUD | `thread:create`, `thread:open`, `thread:open-daily`, `thread:rename`, `thread:delete`, `thread:copyLink`, `thread:list` | 1061-1282 | Most delegate to ThreadWebSocketHandler (already extracted) |
| Agent session | `thread:open-agent` | 1156-1262 | **Complex — 100+ lines, inline** |
| File explorer | `file_tree_request`, `file_content_request`, `recent_files_request` | 1287-1300 | Call the handleFile*Request functions |
| Panel mgmt | `set_panel` | 1305-1347 | Resolve view config, send panel_changed + panel_config |
| Wire | `initialize`, `prompt`, `response` | 1353-1432 | **Wire routing for multi-harness** |
| Files | `file:move` | 1434-1457 | moveFileWithArchive + system:file_deployed event |
| Delegated | `robin:*`, `clipboard:*` | 1461-1477 | Pass to robinHandlers / clipboardHandlers |
| Harness | `harness:get_mode`, `harness:set_mode`, `harness:rollback`, `harness:list`, `harness:check_install` | 1481-1560 | Feature flag management |

---

## Critical gotchas (from earlier dependency analysis)

### 1. Session object closure scope — CRITICAL
The `session` object at line 669 is captured by 5 inner functions via closure. If any are extracted to separate modules, `session` must be passed explicitly as a parameter. Missing even one causes the extracted code to reference a stale or wrong session instance.

### 2. Middleware ordering — CRITICAL
`express.static(clientDistPath)` at line 95 MUST come before the SPA fallback at line 172. If reordered, ALL `/api/*` requests get the catch-all SPA handler and silently return `index.html`.

### 3. `global.__agentWireSessions` — HIGH RISK
Line 185-186. The runner module reads this global. If extraction moves the Map to a separate module without reassigning the global, agent notifications silently fail — no error thrown, just no notification delivered.

### 4. Startup sequence has hard order dependencies
- `initDb()` must finish before robin/clipboard handlers are created (they call `getDb()`)
- `server.listen()` must come before watcher/hooks start (they broadcast to clients)
- `loadComponents()` must run before `createActionHandlers()` (it reads modal definitions)
- If `loadComponents()` runs after action handlers are created, modals are silently not found

### 5. `checkSettingsBounce` enforcement placement — KNOWN ARCHITECTURAL FLAW
Lines 886-905. Currently REACTIVE (runs after the CLI has already written the file) — documented in the enforcement wiki as "a polite suggestion, not a real lock." **User confirmed this is deploy-time enforcement only, not a dev-time concern.** Preserve the current placement exactly during decomposition. Do NOT try to fix the reactive-vs-preventive issue during SPEC-01 — that's a separate architectural project.

### 6. Deferred process pattern for new-harness mode
`awaitHarnessReady()` at line 710 checks for `_harnessPromise` on wires spawned via the new harness path. If extracted, this flag check must travel with it. The Phase 2 compat layer returns dummy processes with `_harnessPromise` set — accessing other properties before the promise resolves gives dummy values.

---

## Original proposed extraction from SPEC-01

These are the 6 extractions the original spec proposed. Revisit during the session to decide if they still make sense given the completed refactoring.

### Extract 1: File Explorer Module
**Lines 266-630 → `lib/file-explorer.js`**
- `mapFileErrorCode`, `isPathAllowed`, `parseExtension`
- `handleFileTreeRequest`, `handleFileContentRequest`, `handleRecentFilesRequest`
- Needs: `getPanelPath`, view resolver, session roots (inject as params)
- Returns: Three handler functions

### Extract 2: Wire Message Router
**Lines 768-1037 → `lib/wire/message-router.js`**
- `handleWireMessage` with all 10 event type cases
- Needs: session object (inject), ws (inject), ThreadWebSocketHandler, event-bus `emit`, `checkSettingsBounce`
- **Enforcement hook MUST stay atomic inside the extracted function** — do not refactor the bounce return pattern

### Extract 3: Wire Process Manager
**Lines 639-656, 710-766 → `lib/wire/process-manager.js`**
- `sendToWire`, `awaitHarnessReady`, `initializeWire`, `setupWireHandlers`
- `wireRegistry` Map + `registerWire`/`unregisterWire`/`getWireForThread`
- Returns: Wire lifecycle management factory

### Extract 4: Client Message Router
**Lines 1043-1569 → `lib/ws/client-message-router.js`**
- All `ws.on('message')` cases organized by domain group
- Needs: session, ThreadWebSocketHandler, wire manager, file explorer, robin/clipboard handlers
- Probably uses factory pattern like ws-client split — inject shared state

### Extract 5: Agent Session Handler
**Lines 1156-1262 → `lib/agent/session-handler.js`**
- `thread:open-agent` handler (100+ lines currently inline in the client message router)
- SESSION.md config loading, thread resolution, memory invalidation, context building
- Wants its own file because it's substantially different from normal thread handlers

### Extract 6: Startup Orchestrator
**Lines 1616-1752 → `lib/startup.js`**
- DB initialization, handler creation, watcher/trigger/cron bootstrap, signal handlers
- Returns: `startServer()` function

### Result: server.js becomes a thin entry point
- ~200-300 lines
- Imports, Express setup, HTTP routes, module wiring, `startServer()` call, signal handlers
- No business logic, no handlers, no state

---

## What's already been extracted (context for decision-making)

These live outside server.js now. Server.js imports and uses them but doesn't contain them:

- `lib/thread/ThreadManager.js` (430 lines) — via SPEC-04
- `lib/thread/session-manager.js` (176 lines) — LRU eviction fix applied (was called FIFO in original spec, corrected mid-session)
- `lib/thread/auto-rename.js` (148 lines) — race guard + Kimi try/catch
- `lib/thread/ThreadWebSocketHandler.js` (187 lines) — now coordinator only
- `lib/thread/thread-crud.js` (365 lines) — via SPEC-03 factory pattern
- `lib/thread/thread-messages.js` (93 lines)

Imports server.js currently has (line 20): `const { ThreadWebSocketHandler } = require('./lib/thread');`

All thread handlers in server.js' client message router just delegate to `ThreadWebSocketHandler.handle*()`. Those lines are already thin.

---

## Recommended execution order during our pairing session

1. **Start with a fresh read of server.js** to verify line numbers haven't drifted
2. **Extract 1: File Explorer** — cleanest, fewest dependencies, lowest risk (pure pass-through functions that validate paths and read filesystem). Proves the pattern.
3. **Extract 6: Startup Orchestrator** — also independent. Mechanical moves, minimal closure coupling.
4. **Extract 3: Wire Process Manager** — needs the wire registry to travel with it. `global.__agentWireSessions` gotcha applies.
5. **Extract 2: Wire Message Router** — fragile. Contains enforcement hook. Must preserve session closure semantics.
6. **Extract 5: Agent Session Handler** — complex but self-contained. The 100+ lines for thread:open-agent.
7. **Extract 4: Client Message Router** — last because it depends on everything else being extracted first.
8. **Final pass** — server.js should collapse to the thin entry point.

After each extraction:
- Build-check (`npm run build` in server? actually just require it — check it doesn't throw)
- Full nuke + rebuild + restart cycle
- Manual verification that the app still works
- Git commit (user's call on whether to commit per-extraction or at the end)

---

## Related memories to check when resuming

These should be loaded from memory automatically, but verify they're present:

- `feedback_session_autoname_race.md` — fire-and-forget subprocess race pattern (applies to wire process extraction)
- `project_harness_migration_state.md` — Kimi works, ACP harnesses partially broken, compat.js is load-bearing
- `project_theming_architecture.md` — theme/style/layout three-layer vision (irrelevant for SPEC-01 but useful general context)
- `feedback_sqlite_readfile_blob.md` — NEW: the readfile() BLOB gotcha from this session
- `feedback_no_architecture_decisions.md` — don't make architectural decisions without the user
- `feedback_kill_all_processes.md` — three restart levels, always kill -9
- `feedback_server_restart_kimi.md` — restart automatically after changes

---

## Files that reference server.js behaviors

Nothing imports from server.js (it's an entry point, not a module). But these files interact with state that server.js owns:

- `lib/runner/index.js` — reads `global.__agentWireSessions` to notify agent sessions of triggers
- `lib/harness/compat.js` — called from server.js at thread:create/thread:open (lines 1072, 1104, etc.)
- `lib/enforcement.js` — `checkSettingsBounce` imported at line 46
- `lib/robin/ws-handlers.js` — `createRobinHandlers({ getDb, sessions, getDefaultProjectRoot })` at line 24
- `lib/clipboard/ws-handlers.js` — `createClipboardHandlers({ getDb })` at line 27
- `lib/thread/ThreadWebSocketHandler.js` — all thread CRUD handlers
- `lib/views.js` — panel discovery and resolution
- `lib/wiki/hooks.js` — file watching for wiki collections
- `lib/audit/audit-subscriber.js` — audit event streaming
- `lib/components/component-loader.js` — modal definitions
- `lib/file-ops.js` — `moveFileWithArchive`
- `lib/event-bus.js` — `emit()` used throughout the wire message router and client router

---

## Open questions to ask the user before starting

1. **Commit strategy** — commit per-extraction or one big commit at the end?
2. **Agent session handler (Extract 5)** — is this worth its own file, or should it stay in the client message router but get organized better? The 100+ lines of SESSION.md loading and context building are fairly self-contained but only one message type uses them.
3. **Wire registry (`wireRegistry` Map)** — should it stay in server.js and be passed into the wire process manager, or should it move into the wire process manager's module-level state? The latter is cleaner but requires updating every reference.
4. **Startup orchestrator** — does the user want `startServer()` to be a class or a function factory? The current code is a plain function with closures. Keeping it a function is lower risk.
5. **Do we keep the current 6-extraction plan or consolidate?** For example, extracts 2 + 3 could merge into a single `lib/wire/` module with both the router and the process manager.

---

## How to resume from this document

After compacting:
1. User will reference this file: `ai/views/capture-viewer/content/todo/specs/01-server-js-CONTEXT-FORWARD.md`
2. Read this entire file before touching code
3. Verify the line numbers are still accurate — run `wc -l open-robin-server/server.js` and spot-check a few function line numbers listed above
4. Re-read `ai/views/capture-viewer/content/todo/specs/01-server-js-decomposition.md` (the original spec) for the gotchas section
5. Ask the user the 5 open questions above before starting any extraction
6. Start with Extract 1 (File Explorer) as the warm-up

---

## Verification checklist after ALL extractions done

- [ ] server.js is under 300 lines
- [ ] `npm run build` (client) succeeds
- [ ] Server starts without errors: `node server.js`
- [ ] HTTP 200 on `/`
- [ ] Thread create works (send a message)
- [ ] Thread list loads
- [ ] File explorer opens folders
- [ ] Robin panel opens with all tabs
- [ ] Settings write lock still bounces (test: ask AI to write to `settings/something.css` — should get restricted error)
- [ ] `global.__agentWireSessions` is still assigned (grep for it)
- [ ] Middleware order preserved (static before SPA fallback)
- [ ] Startup sequence preserved (DB → handlers → watcher → listen)
- [ ] Smoke test runs clean: `node test/smoke-spec03-spec15.js`
