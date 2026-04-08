# SPEC-01: server.js Decomposition

## Issue
`open-robin-server/server.js` is 1,752 lines performing 14+ distinct jobs. It is the single largest code standards violation in the project.

## File
`open-robin-server/server.js` — 1,752 lines

## Current Responsibilities (by line range)
| Job | Lines | Description |
|-----|-------|-------------|
| Imports | 10-58 | 20+ requires across all domains |
| Logging setup | 61-87 | Console override, wire debug log rotation |
| Express/HTTP | 89-174 | App, static serving, 4 API routes, SPA fallback |
| Global state | 176-264 | sessions, wireRegistry, agentWireSessions, sessionRoots, panel path resolution |
| File explorer | 266-630 | Path validation, folder listing, file reading, recent files |
| Wire helpers | 639-656 | sendToWire() JSON-RPC marshaling |
| WS connection handler | 662-1610 | Entire WebSocket lifecycle (session, wire init, message routing, client messages, disconnect) |
| Wire message router | 768-1037 | handleWireMessage() with 10 event types + enforcement |
| Client message handler | 1043-1569 | 25+ message types (threads, files, panels, prompts, robin, clipboard, harness) |
| Agent persona sessions | 1156-1262 | SESSION.md loading, thread resolution, context building |
| Server startup | 1616-1741 | DB init, handler creation, watcher, triggers, cron |
| Process signals | 1744-1752 | SIGTERM/SIGINT cleanup |

## Proposed Extraction Targets

### Extract 1: File Explorer Module
**Lines 266-630 -> `lib/file-explorer.js`**
- `mapFileErrorCode()`, `isPathAllowed()`, `parseExtension()`
- `handleFileTreeRequest()`, `handleFileContentRequest()`, `handleRecentFilesRequest()`
- Needs: `getPanelPath()`, `isPathAllowed()`, views, session roots
- Returns: Three handler functions

### Extract 2: Wire Message Router
**Lines 768-1037 -> `lib/wire/message-router.js`**
- `handleWireMessage()` with all event type cases
- Needs: session object, ws reference, ThreadWebSocketHandler, event-bus emit, checkSettingsBounce
- Returns: Single handler function factory

### Extract 3: Wire Process Manager
**Lines 639-656, 710-766 -> `lib/wire/process-manager.js`**
- `sendToWire()`, `awaitHarnessReady()`, `initializeWire()`, `setupWireHandlers()`
- `wireRegistry`, `registerWire()`, `unregisterWire()`, `getWireForThread()`
- Returns: Wire lifecycle management

### Extract 4: Client Message Router
**Lines 1043-1569 -> `lib/ws/client-message-router.js`**
- All `ws.on('message')` cases organized by domain
- Needs: session, ThreadWebSocketHandler, wire manager, file explorer, robin/clipboard handlers
- Returns: Single handler factory

### Extract 5: Agent Session Handler
**Lines 1156-1262 -> `lib/agent/session-handler.js`**
- `thread:open-agent` handler
- SESSION.md config loading, thread resolution, memory invalidation, context building
- Returns: Handler function

### Extract 6: Startup Orchestrator
**Lines 1616-1752 -> `lib/startup.js`**
- DB initialization, handler creation, watcher/trigger/cron bootstrap, signal handlers
- Returns: `startServer()` function

## Dependencies
- **MUST execute LAST** — server.js is the glue layer connecting all other extracted modules
- Depends on SPEC-03 (ThreadWebSocketHandler exports change)
- Depends on SPEC-04 (ThreadManager API changes)
- Depends on SPEC-11 (compat.js spawnThreadWire location)
- Shares modified files with SPEC-03, SPEC-11

## Gotchas

### Session object closure scope — CRITICAL
The `session` object (line 669) is a per-WebSocket closure captured by 5 inner functions: `awaitHarnessReady()`, `initializeWire()`, `setupWireHandlers()`, `handleWireMessage()`, and the entire `ws.on('message')` handler. If any of these are extracted to separate modules, `session` must be passed as an explicit parameter. Missing even one causes the extracted code to reference a stale or wrong session object. `setupWireHandlers()` is called from 4 different message types — different invocations could operate on different session instances if not injected correctly.

### Middleware ordering — CRITICAL
Static files (line 95) MUST come before SPA fallback (line 172), or ALL requests including `/api/*` get caught by the catch-all. If extraction reorders routes, `/api/panel-file/...` silently returns `index.html` instead of the requested file.

### `global.__agentWireSessions` — HIGH RISK
Line 185-186 assigns a Map to `global.__agentWireSessions`. The runner module reads this global to notify agent sessions of triggers. If extraction moves this to a separate module and forgets the global assignment, agent notifications silently fail — no error thrown, just no notification delivered.

### Startup sequence cannot be parallelized freely
DB init must complete before robin/clipboard handlers start. `server.listen()` must complete before watcher/hooks start (they broadcast to clients). `loadComponents()` must run before `createActionHandlers()` reads modal definitions. If `loadComponents()` runs after action handlers are created, modals are silently not found.

### checkSettingsBounce enforcement placement — MUST STAY ATOMIC
Lines 886-905: enforcement runs after parsing tool args but before saving to history. If extracted with middleware in between, the semantics change. If the `break` statement behavior is lost during extraction, bounced tools get saved to history anyway. Extract as: pass full message context, return `{ allowed: false, reason }` result object.

## Silent Fail Risks

| Risk | What Breaks | Symptom |
|------|-------------|---------|
| Event bus `emit()` not imported in extracted module | No audit logs, no trigger evaluations, TRIGGERS.md automations don't fire | Audits empty, automations silent |
| checkSettingsBounce accidentally returns `allowed: true` | Tools write to settings/ folders | Security violation, AI modifies locked config |
| wireRegistry `registerWire()` passed wrong threadId | Wire registered under wrong key, prompt routing fails | User sends message, nothing happens |
| ThreadWebSocketHandler.addAssistantMessage not passed to extracted module | Assistant messages not saved to chat history | Thread appears to have no conversation |
| Middleware reordered | API routes return index.html instead of data | Panel files, harness list silently broken |
