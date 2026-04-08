# SPEC-01b — Extract Startup Orchestrator from server.js

**Parent:** SPEC-01 (server.js decomposition)
**Position:** Extraction 2 of 6. Second-easiest after File Explorer. Independent of everything else.
**Depends on:** SPEC-01a (File Explorer) — must be merged first (commit `7214564` or later).
**Model recommendation:** Opus 4.6 with 1M context window.
**Estimated blast radius:** Low-Medium. Touches a fragile startup sequence with hard ordering constraints, but the code has no shared closure with the rest of server.js beyond the sessions Map and a handful of top-level helpers.

---

## Your mission

Extract the server startup orchestration out of `open-robin-server/server.js` (roughly lines 1255–1394 as of commit `7214564`) into a new single-file module at `open-robin-server/lib/startup.js`. Export a `start(deps)` function that does all the DB init, handler creation, audit-subscriber start, `server.listen()`, watcher/trigger/cron/heartbeat pipeline, AND the SIGTERM/SIGINT handlers. `server.js` calls `start(...)`, receives the initialized `robinHandlers` and `clipboardHandlers` back, and stores them in module-level mutable references that the client message router already reads from.

server.js should drop from 1394 → ~1270 lines after this extraction.

**You are extracting, not refactoring.** The startup sequence has hard ordering constraints. Preserve the order exactly. Do not reorganize, do not "improve," do not hoist requires, do not consolidate. Mechanical transplant.

---

## Context before you touch code

1. `ai/views/capture-viewer/content/todo/specs/01-server-js-CONTEXT-FORWARD.md` — the resume-from-compact doc for all of SPEC-01. Read the gotchas section, especially **#4 Startup sequence has hard order dependencies**.
2. `ai/views/capture-viewer/content/todo/specs/01-server-js-decomposition.md` — the original decomposition spec.
3. `ai/views/capture-viewer/content/todo/specs/01a-server-js-extract-file-explorer.md` — the previous extraction spec (completed). Read this for the factory-pattern template and the verification workflow. 01b follows the same shape.
4. `open-robin-server/lib/thread/thread-crud.js` — the canonical factory pattern example. 01b does not use a factory-of-handlers like 01a did (it's a lifecycle function, not a message handler), but the dep-injection style carries over.

**Verify line-number drift.** Before you start, run `wc -l open-robin-server/server.js` — should report 1394. If it's different, someone modified server.js between when this spec was written and now. Reconcile before continuing. Then confirm the landmarks:

```bash
grep -n '^const PORT\|^function startServer\|^process.on' open-robin-server/server.js
```

Should report roughly:
- `1258:const PORT = process.env.PORT || 3001;`
- `1281:function startServer() {`
- `1387:process.on('SIGTERM', async () => {`
- `1391:process.on('SIGINT', async () => {`

If any of those line numbers are off by more than ~5, stop and reconcile.

---

## Source — what you are moving

All in `open-robin-server/server.js`. Line numbers are current as of commit `7214564`.

| Region | Lines | What it does |
|---|---|---|
| `PORT` constant | 1258 | Port number from env or default 3001 |
| Mutable handler refs | 1261–1262 | `let robinHandlers = {}; let clipboardHandlers = {};` — **STAYS IN server.js** |
| `initDb().then()` bootstrap | 1265–1279 | Calls initDb, then creates handlers, starts audit subscriber, calls startServer() |
| `function startServer()` | 1281–1383 | Inside `server.listen()` callback: wiki hooks, watcher, hold registry, wrapped createTicket, components loader, action handlers, filters, trigger loader, cron scheduler, heartbeat monitor |
| `const { closeDb } = require('./lib/db');` | 1386 | Scoped import just for the signal handlers |
| SIGTERM handler | 1387–1390 | Close DB, exit 0 |
| SIGINT handler | 1391–1394 | Close DB, exit 0 |

Total span to move: lines 1258, 1265–1279, 1281–1394. The two mutable handler ref declarations at 1261–1262 **do not move** — they stay in server.js because the client message router at lines 1104 and 1114 reads from them directly and must continue to do so.

---

## What the client message router reads

Critical gotcha: the current code has a **module-level mutable reference** pattern. Don't flatten it during extraction.

```js
// server.js lines 1261-1262 (stays)
let robinHandlers = {};
let clipboardHandlers = {};
```

```js
// server.js lines 1104 and 1114 (stays — these are in the client router, SPEC-01f's territory)
const handler = robinHandlers[clientMsg.type];
// ...
const handler = clipboardHandlers[clientMsg.type];
```

These are `let` declarations that start as empty objects and get **assigned** inside the `initDb().then()` callback. By the time any client sends a `robin:*` or `clipboard:*` message, those outer references have been populated — the assignment happens before `server.listen()` completes.

Your extraction **must preserve this pattern**. `lib/startup.js` produces the two handler objects and returns them. `server.js` assigns them to the existing `let` refs in the `.then()` callback of the `start()` promise. The client router is untouched.

If you try to move the declarations into `lib/startup.js` or restructure the client router to call through a function, you are out of scope for this spec — file it as a follow-up. This spec is mechanical transplant only.

---

## Dependencies — what `start(deps)` needs

After inspecting the startup code, these are the only external things it touches:

### Injected via `deps` parameter

| Dependency | Currently at | Why inject |
|---|---|---|
| `server` | `server.js:93` (`http.createServer(app)`) | The HTTP server to call `.listen()` on. Stays in server.js. |
| `port` | `server.js:1258` (`process.env.PORT \|\| 3001`) | Port number. The `const PORT = ...` declaration can move into the startup module, but pass it as a dep for testability. Alternatively, move the declaration into startup.js and drop the dep. **Recommendation:** Move `PORT` declaration into `lib/startup.js` and read `process.env.PORT` there. Don't add a `port` dep. |
| `sessions` | `server.js:177` (`new Map()`) | The per-ws session Map. Captured by closure in the three broadcast functions (`sendChatMessage`, `broadcastModal`, `broadcastFileChange`) inside `createActionHandlers`. Stays in server.js. |
| `getDefaultProjectRoot` | `server.js:206` | Helper used in ~6 places in the startup code. Stays in server.js. |
| `AI_PANELS_PATH` | `server.js:217` (`path.join(getDefaultProjectRoot(), 'ai', 'views')`) | Used for the thread storage log line, agents base path, issues dir. Stays in server.js. |
| `loadComponents` | imported at `server.js:52` from `./lib/components/component-loader` | Loads modal definitions. **Critical ordering:** must run BEFORE `createActionHandlers` or modals silently fail to load. Could be re-imported inside startup.js instead of injected. **Recommendation:** re-import inside startup.js. No need to inject. |
| `getModalDefinition` | imported at `server.js:52` from `./lib/components/component-loader` | Used inside `createActionHandlers`. Same source as `loadComponents`. **Recommendation:** re-import inside startup.js. |

### Re-imported inside `lib/startup.js` (module-level)

| Import | Current path in server.js | New path in startup.js |
|---|---|---|
| `initDb`, `getDb`, `closeDb` | `./lib/db` | `./db` |
| `createRobinHandlers` | `./lib/robin/ws-handlers` | `./robin/ws-handlers` |
| `createClipboardHandlers` | `./lib/clipboard/ws-handlers` | `./clipboard/ws-handlers` |
| `startAuditSubscriber` | `./lib/audit/audit-subscriber` | `./audit/audit-subscriber` |
| `wikiHooks` | `./lib/wiki/hooks` | `./wiki/hooks` |
| `loadComponents`, `getModalDefinition` | `./lib/components/component-loader` | `./components/component-loader` |
| `path`, `fs` (Node builtins) | top of server.js | top of startup.js |

### Re-imported inside the `server.listen()` callback (deferred requires, preserve the pattern)

The current code does a bunch of `require()` calls INSIDE the listen callback, not at module top. This is deliberate — these modules load files and do work that shouldn't happen until the server is actually running. **Preserve this pattern exactly.** Move each inline require with a rewritten relative path:

| Inline require | Current path (from server.js) | New path (from lib/startup.js) |
|---|---|---|
| `createWatcher` | `./lib/watcher` | `./watcher` |
| `loadFilters`, `evaluateCondition` | `./lib/watcher/filter-loader` | `./watcher/filter-loader` |
| `createActionHandlers` | `./lib/watcher/actions` | `./watcher/actions` |
| `createTicket` | `path.join(getDefaultProjectRoot(), 'ai', 'views', 'issues-viewer', 'scripts', 'create-ticket')` | unchanged (absolute path) |
| `createHoldRegistry` | `./lib/triggers/hold-registry` | `./triggers/hold-registry` |
| `loadTriggers` | `./lib/triggers/trigger-loader` | `./triggers/trigger-loader` |
| `createCronScheduler` | `./lib/triggers/cron-scheduler` | `./triggers/cron-scheduler` |
| `checkHeartbeats` | `./lib/runner` | `./runner` |

### `__dirname` resolution

Line 1314 currently has `const filterDir = path.join(__dirname, 'lib', 'watcher', 'filters');`

In `lib/startup.js`, `__dirname` is already `open-robin-server/lib`, so the path becomes:

```js
const filterDir = path.join(__dirname, 'watcher', 'filters');
```

Drop the `'lib'` segment. This is the only `__dirname` use in the extracted code.

---

## Target — the new file

Create `open-robin-server/lib/startup.js`. Single file, no subdirectory. Estimated size: ~150 lines.

### Shape

```js
/**
 * Server startup orchestrator.
 *
 * Extracted from server.js — handles the full bootstrap sequence:
 *   1. initDb
 *   2. createRobinHandlers + createClipboardHandlers
 *   3. startAuditSubscriber
 *   4. server.listen()
 *   5. wiki hooks
 *   6. project file watcher + loadComponents + createActionHandlers
 *   7. agent triggers + cron scheduler
 *   8. runner heartbeat monitor
 *   9. SIGTERM/SIGINT handlers for clean shutdown
 *
 * Ordering is load-bearing. Do not reorder steps. See the gotchas in
 * SPEC-01b for the specific hard dependencies.
 *
 * Returns { robinHandlers, clipboardHandlers } so server.js can wire
 * them into the client message router (which reads from module-level
 * mutable references).
 */

const path = require('path');
const fs = require('fs');

const { initDb, getDb, closeDb } = require('./db');
const createRobinHandlers = require('./robin/ws-handlers');
const createClipboardHandlers = require('./clipboard/ws-handlers');
const { startAuditSubscriber } = require('./audit/audit-subscriber');
const wikiHooks = require('./wiki/hooks');
const { loadComponents, getModalDefinition } = require('./components/component-loader');

const PORT = process.env.PORT || 3001;

/**
 * Bootstrap and start the server. Must be called after the http.Server
 * has been created but before any client connections can arrive.
 *
 * @param {object} deps
 * @param {import('http').Server} deps.server
 * @param {Map} deps.sessions
 * @param {() => string} deps.getDefaultProjectRoot
 * @param {string} deps.AI_PANELS_PATH
 * @returns {Promise<{ robinHandlers: object, clipboardHandlers: object }>}
 */
async function start({ server, sessions, getDefaultProjectRoot, AI_PANELS_PATH }) {
  // 1. DB init — must finish before handlers are created (they call getDb)
  await initDb(getDefaultProjectRoot());
  console.log('[DB] robin.db initialized');

  // 2. Handlers — depend on DB being ready
  const robinHandlers = createRobinHandlers({ getDb, sessions, getDefaultProjectRoot });
  const clipboardHandlers = createClipboardHandlers({ getDb });

  // 3. Audit subscriber — listens to event bus, persists exchange metadata
  startAuditSubscriber();

  // 4. listen() — must come before watcher/hooks start, they broadcast to clients
  await new Promise((resolve, reject) => {
    server.listen(PORT, () => {
      console.log(`[Server] Running on http://localhost:${PORT}`);
      console.log(`[Server] Default CLI: ${process.env.KIMI_PATH || 'kimi'}`);
      console.log(`[Server] Thread storage: ${AI_PANELS_PATH}`);

      try {
        _startPipeline({ sessions, getDefaultProjectRoot, AI_PANELS_PATH });
      } catch (err) {
        // Don't crash the server if pipeline init fails — log and continue
        console.error('[Server] Pipeline init error:', err);
      }

      resolve();
    });
    server.on('error', reject);
  });

  // 5. Signal handlers — register after successful startup
  process.on('SIGTERM', _handleShutdown);
  process.on('SIGINT', _handleShutdown);

  return { robinHandlers, clipboardHandlers };
}

/**
 * The post-listen pipeline: watcher, hold registry, action handlers,
 * filters, triggers, cron scheduler, heartbeat monitor.
 *
 * Split out of `start()` only for readability — the split has no
 * semantic effect. Everything here runs synchronously from inside the
 * `server.listen()` callback.
 *
 * @private
 */
function _startPipeline({ sessions, getDefaultProjectRoot, AI_PANELS_PATH }) {
  // Wiki hooks — watches ai/views/wiki-viewer/content/
  const wikiPath = path.join(getDefaultProjectRoot(), 'ai', 'views', 'wiki-viewer', 'content');
  wikiHooks.start(wikiPath);

  // Project-wide file watcher
  const { createWatcher } = require('./watcher');
  const { loadFilters } = require('./watcher/filter-loader');
  const { createActionHandlers } = require('./watcher/actions');
  const { createTicket } = require(path.join(
    getDefaultProjectRoot(), 'ai', 'views', 'issues-viewer', 'scripts', 'create-ticket'
  ));

  // Hold registry (global side effect — some other module reads __holdRegistry)
  const { createHoldRegistry } = require('./triggers/hold-registry');
  const issuesDir = path.join(AI_PANELS_PATH, 'issues-viewer');
  const holdRegistry = global.__holdRegistry = createHoldRegistry(issuesDir);

  // Wrapped createTicket: hooks trigger-created tickets into hold registry
  const wrappedCreateTicket = function (ticketData) {
    const result = createTicket(ticketData);
    if (ticketData.autoHold && ticketData.triggerName && result?.id) {
      holdRegistry.hold(ticketData.assignee, ticketData.triggerName, result.id);
    }
    return result;
  };

  const projectWatcher = createWatcher(getDefaultProjectRoot());

  // CRITICAL ORDER: loadComponents MUST run before createActionHandlers.
  // If reversed, modal definitions are silently not found.
  const filterDir = path.join(__dirname, 'watcher', 'filters');
  const componentsDir = path.join(getDefaultProjectRoot(), 'ai', 'components');
  loadComponents(componentsDir);

  const actionHandlers = createActionHandlers({
    createTicket: wrappedCreateTicket,
    projectRoot: getDefaultProjectRoot(),
    getModalDefinition,
    db: getDb(),
    sendChatMessage(target, message, role) {
      for (const [ws, sess] of sessions) {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: 'system_message',
            content: message,
            role: role || 'system',
            target,
          }));
        }
      }
    },
    broadcastModal(config) {
      for (const [ws, sess] of sessions) {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'modal:show', ...config }));
        }
      }
    },
    broadcastFileChange(payload) {
      for (const [ws, sess] of sessions) {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify(payload));
        }
      }
    },
  });
  const declFilters = loadFilters(filterDir, actionHandlers);
  for (const f of declFilters) projectWatcher.addFilter(f);

  // Agent TRIGGERS.md files
  const { loadTriggers } = require('./triggers/trigger-loader');
  const { createCronScheduler } = require('./triggers/cron-scheduler');
  const { evaluateCondition } = require('./watcher/filter-loader');

  const agentsBasePath = path.join(AI_PANELS_PATH, 'agents-viewer');
  try {
    const registry = JSON.parse(fs.readFileSync(path.join(agentsBasePath, 'registry.json'), 'utf8'));
    const { filters: triggerFilters, cronTriggers } = loadTriggers(
      getDefaultProjectRoot(), agentsBasePath, registry, actionHandlers
    );

    for (const f of triggerFilters) projectWatcher.addFilter(f);

    if (cronTriggers.length > 0) {
      const cronScheduler = createCronScheduler(wrappedCreateTicket, { evaluateCondition });
      for (const { trigger, assignee } of cronTriggers) {
        cronScheduler.register(trigger, assignee);
      }
      cronScheduler.start();
    }
  } catch (err) {
    console.error(`[Server] Failed to load agent triggers: ${err.message}`);
  }

  // Runner heartbeat monitor
  const { checkHeartbeats } = require('./runner');
  checkHeartbeats(getDefaultProjectRoot());
}

async function _handleShutdown() {
  await closeDb();
  process.exit(0);
}

module.exports = { start };
```

Only `start` is exported. `_startPipeline` and `_handleShutdown` are internal helpers with leading underscores.

---

## Wiring — what changes in server.js

### 1. Add the import near the other `lib/` imports (around lines 19–52)

```js
const { start: startServer } = require('./lib/startup');
```

Note: we import as `startServer` to preserve the name that used to exist locally — it's a slightly-more-descriptive alias and avoids a collision with `server` (the http.Server). Place this import next to the other startup-adjacent requires.

### 2. Delete the redundant individual requires from server.js

These imports currently live at the top of server.js but are now owned by `lib/startup.js`:

- `./lib/components/component-loader` (line 52) — was only used for `loadComponents` and `getModalDefinition`, which now live inside startup.js
- `./lib/audit/audit-subscriber` (line 46) — `startAuditSubscriber` is now called from inside startup.js

**BUT:** check for other usages before deleting. Run:

```bash
grep -n 'loadComponents\|getModalDefinition\|startAuditSubscriber' open-robin-server/server.js
```

After the extraction, only the startup.js import remains — so these require lines in server.js can be deleted. If the grep shows any other references in server.js that I missed, report it and do not delete the imports.

### 3. Replace the startup bootstrap block

Delete lines 1255–1394 entirely (from the `// Server Startup` section header through the SIGINT handler). Replace with:

```js
// ============================================================================
// Server Startup
// ============================================================================

// Module-level mutable handler references. Populated when startServer() resolves.
// The client message router (lines ~1104 and ~1114 in the ws.on('message') handler)
// reads from these. See SPEC-01b for the mutable-reference pattern rationale.
let robinHandlers = {};
let clipboardHandlers = {};

startServer({
  server,
  sessions,
  getDefaultProjectRoot,
  AI_PANELS_PATH,
})
  .then(result => {
    robinHandlers = result.robinHandlers;
    clipboardHandlers = result.clipboardHandlers;
  })
  .catch(err => {
    console.error('[Server] Startup failed:', err);
    process.exit(1);
  });
```

That's it. ~20 lines of replacement for ~140 lines of extraction.

### 4. Verify nothing else in server.js references the deleted code

After the extraction, these greps should come up clean (return zero matches in server.js, OR return only the new startup-module import):

```bash
grep -n 'function startServer\|initDb(' open-robin-server/server.js
grep -n "process.on('SIGTERM\|process.on('SIGINT" open-robin-server/server.js
grep -n 'wikiHooks.start\|createWatcher\|createActionHandlers\|createHoldRegistry' open-robin-server/server.js
grep -n 'loadComponents\|getModalDefinition\|startAuditSubscriber' open-robin-server/server.js
grep -n 'closeDb' open-robin-server/server.js
```

Every match should be in startup.js, not server.js. If any match remains in server.js, investigate before proceeding.

---

## Gotchas — preserve these exactly

### 1. Hard ordering constraints — DO NOT REORDER

This is THE load-bearing gotcha for this extraction. The startup sequence has four documented hard dependencies:

1. **`initDb()` must finish before handlers are created.** `createRobinHandlers` calls `getDb()` internally. If handlers are created before the DB promise resolves, `getDb()` returns undefined and the handlers silently do nothing.
2. **`server.listen()` must come before watcher/hooks start.** The watcher and `wikiHooks.start` both broadcast change events to connected clients via the sessions Map. If they start before the server is listening, there are no clients to broadcast to — no immediate crash, but initial state notifications are lost.
3. **`loadComponents()` must run before `createActionHandlers()`.** `loadComponents` populates an internal registry that `getModalDefinition` reads from. `createActionHandlers` captures `getModalDefinition` into its action callbacks. If `loadComponents` runs after, `getModalDefinition` returns undefined for every key — modals silently fail to display. No error thrown.
4. **Audit subscriber before handlers are used, but after DB is ready.** `startAuditSubscriber` subscribes to the event bus to persist exchange metadata. It's called between handler creation and `server.listen()` in the current code. Preserve this placement.

Current order in the spec template above is correct. Do not move any step up or down.

### 2. `robinHandlers` / `clipboardHandlers` mutable reference pattern

See the earlier section "What the client message router reads." The declarations `let robinHandlers = {}; let clipboardHandlers = {};` stay in server.js. The startup module returns the populated objects. server.js's `.then()` callback assigns them. Do not try to replace this pattern with a cleaner one — that's SPEC-01f's territory (client message router extraction).

### 3. `global.__holdRegistry` assignment

Line 1300 does `global.__holdRegistry = createHoldRegistry(issuesDir);`. This global is read by something else in the codebase (likely the runner or a trigger handler). **Preserve the global assignment exactly.** Do not move it to a module export or a returned value. The whole point is that the global is reachable from anywhere without an import chain.

Same gotcha as `global.__agentWireSessions` from SPEC-01c (Wire Process Manager) — globals like this are load-bearing infrastructure, not code smell.

### 4. `wrappedCreateTicket` closure over `holdRegistry`

The `wrappedCreateTicket` function closes over the local `holdRegistry` reference to hook auto-hold behavior into trigger-created tickets. It's passed to `createActionHandlers` AND to `createCronScheduler`. Keep both call sites using the same wrapped version. Don't split the wrapping.

### 5. Deferred inline `require()`s — keep them inline

The current code does a bunch of `require()` calls INSIDE the `server.listen()` callback rather than at module top. This is deliberate: these modules load config files, set up timers, or do other work that should not run until the server is actually listening. **Do not hoist them to module-level imports.** Move each one with its updated relative path, and keep it inside `_startPipeline` where it currently lives inside the listen callback.

### 6. The agent triggers try/catch is intentionally lenient

Lines 1360–1377 wrap the entire "load triggers + start cron scheduler" block in a try/catch that just logs the error. This means if `registry.json` is missing, unparseable, or any trigger fails to load, the rest of the server still comes up. **Preserve this.** Do not split the try/catch into multiple narrower ones. Do not rethrow. Do not add retries.

### 7. Broadcast loops iterate the `sessions` Map, not sessions array

The three broadcast functions (`sendChatMessage`, `broadcastModal`, `broadcastFileChange`) iterate `sessions` as `for (const [ws, sess] of sessions)`. They check `ws.readyState === 1` (WebSocket OPEN state) before sending. Preserve both the iteration pattern and the readyState guard. Do not introduce a helper. Do not switch to `sessions.forEach`. Do not cache the keys.

One detail: `sess` is destructured but not used inside `sendChatMessage` or `broadcastModal` or `broadcastFileChange`. It's present in the destructure for symmetry. Leave it.

### 8. `PORT` can move into startup.js

Unlike the handler refs, `PORT` is only read in `startServer()` (now `start()`). Move the `const PORT = process.env.PORT || 3001;` declaration into startup.js at module level. Delete it from server.js. Do not add `port` as a `deps` parameter — it's an env concern, not a server.js concern.

### 9. Signal handlers: only close DB

The current SIGTERM/SIGINT handlers ONLY call `closeDb()` and `process.exit(0)`. There is no other cleanup. Nothing else in server.js needs to run on shutdown. Safe to move entirely into `lib/startup.js`.

If during the extraction you discover that something else in server.js depends on signal handling (e.g. draining WebSocket connections, flushing a log, unwinding subscriptions), **stop and report before proceeding.** Do not invent shutdown logic that wasn't there.

### 10. `startServer` name collision with http.Server

The current local function is named `startServer`. The http.Server is named `server`. When you import `{ start }` from startup.js, name the import `startServer` to preserve the mnemonic. Do NOT name it `start` in server.js — that's too generic and collides with nothing-useful.

---

## Verification checklist

After the extraction, run these checks in order. Stop and report if any step fails.

### Sanity checks (static, don't need a running server)

1. `wc -l open-robin-server/server.js` — should report approximately 1270 lines (down from 1394). If much different, diff is wrong.
2. `wc -l open-robin-server/lib/startup.js` — should report approximately 150 lines.
3. `node -e "require('./open-robin-server/lib/startup')"` from repo root — should complete without throwing. Confirms syntax is valid and all inline requires that run at module load (not the deferred ones inside `_startPipeline`) resolve.
4. `node -e "require('./open-robin-server/server.js')"` from repo root — may throw `EADDRINUSE` or similar port-conflict errors; that's fine (proves requires resolved and the start sequence was reached). Any `SyntaxError`, `ReferenceError`, or `TypeError` is a fail.
5. Grep checks:
   - `grep -n 'function startServer\|initDb(\|closeDb\|wikiHooks.start\|createWatcher\|createActionHandlers\|createHoldRegistry\|loadComponents\|getModalDefinition\|startAuditSubscriber' open-robin-server/server.js` — should return **zero matches** inside server.js function/statement bodies, and at most one match for each name in an `import`/`require` line if something still needs it. Ideally, the grep returns only `require('./lib/startup')`.
   - `grep -n 'global.__holdRegistry' open-robin-server/` — should return exactly one match, in `lib/startup.js`. If it's not there, the global assignment was lost during extraction.
   - `grep -n 'process.on' open-robin-server/server.js` — should return zero matches. Signal handlers moved.

### Runtime checks (server must be running)

Run `./restart-kimi.sh` from the repo root. It does the full nuke: pkills all `node server.js`, clears port 3001, rebuilds the client, starts the server, verifies it's serving. If the script exits with an error, the extraction broke something — stop and report.

6. `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/` → `200`.
7. `tail -30 open-robin-server/server-live.log` should show the expected startup log lines in the expected order:
   ```
   [DB] robin.db initialized
   [Server] Running on http://localhost:3001
   [Server] Default CLI: kimi
   [Server] Thread storage: /Users/rccurtrightjr./projects/open-robin/ai/views
   ```
   Plus later entries from watcher and trigger loader. No errors, no stack traces.
8. Open `http://localhost:3001` in a browser. The page should load. Check console — no red errors.
9. Open the Robin panel in the UI. It should populate (validates `robinHandlers` was correctly returned from startup.js and assigned to the server.js outer ref).
10. Clipboard still works (test by copying something via the app — validates `clipboardHandlers` same way).
11. Trigger a file change inside the project root and watch for a `[Watcher]` log entry — validates the watcher started.
12. **Clean shutdown test:** `kill -TERM $(lsof -ti:3001)` (SIGTERM). The server should exit cleanly with no stack trace. `tail` the log — you should NOT see an unhandled rejection or "failed to close DB" message. Then restart via `./restart-kimi.sh`.

---

## What NOT to do

- **Do not** reorder any step in the startup sequence. See Gotcha #1.
- **Do not** move the `robinHandlers` / `clipboardHandlers` `let` declarations into startup.js.
- **Do not** replace the mutable-reference pattern with a getter/setter, a class, or a passed-in reference object. See Gotcha #2.
- **Do not** remove the `global.__holdRegistry` assignment. See Gotcha #3.
- **Do not** split `wrappedCreateTicket` into two functions (one for action handlers, one for cron). See Gotcha #4.
- **Do not** hoist the deferred inline requires out of `_startPipeline`. See Gotcha #5.
- **Do not** narrow the agent triggers try/catch. See Gotcha #6.
- **Do not** optimize the broadcast loops. See Gotcha #7.
- **Do not** add a `port` parameter to `deps`. Move the declaration.
- **Do not** introduce any new shutdown logic. See Gotcha #9.
- **Do not** split `lib/startup.js` into multiple files (e.g. `startup/index.js`, `startup/pipeline.js`, `startup/shutdown.js`). Single file for this extraction; further splitting can be a follow-up spec.
- **Do not** touch the client message router (`ws.on('message')`) — it continues to read `robinHandlers[clientMsg.type]` and `clipboardHandlers[clientMsg.type]` from the module-level `let` declarations in server.js. Out of scope.
- **Do not** push the commit. Commit locally only.
- **Do not** update this spec doc to mark it complete. The user does that.
- **Do not** attempt to fix unrelated issues you notice in server.js. File them, don't fix them.
- **Do not** start SPEC-01c. Stop after SPEC-01b and let the user drive the next cycle.

---

## Commit

One commit. Message:

```
Extract startup orchestrator from server.js into lib/startup.js

Part 2 of 6 under SPEC-01 (server.js decomposition). Moves the
full server bootstrap sequence out of server.js:

- initDb + handler creation + audit subscriber (pre-listen init)
- server.listen() + post-listen pipeline (wiki hooks, watcher,
  hold registry, components loader, action handlers, filters,
  agent triggers, cron scheduler, heartbeat monitor)
- SIGTERM/SIGINT shutdown handlers

Exports start(deps) which returns { robinHandlers, clipboardHandlers }.
server.js keeps the two mutable handler refs as module-level let
declarations so the client message router can read them; the
.then() callback of start() assigns the returned handlers into
those refs. This preserves the existing mutable-reference pattern
— refactoring it is SPEC-01f's territory.

All inline deferred require()s are preserved inside the post-listen
pipeline with updated relative paths (./lib/foo → ./foo).
global.__holdRegistry assignment is preserved. Ordering constraints
(initDb → handlers → audit → listen → loadComponents → actionHandlers)
are preserved exactly.

server.js: 1394 → ~1270 lines.
```

**Commit only. Do not push.**

---

## Reporting back

When you're done, report:

1. **Actual line counts** — `wc -l` results for server.js (new) and lib/startup.js (new). If they diverge from the estimates above by more than ~30 lines, explain why.
2. **Verification results** — each of the 12 checks with a one-line result. ✓ or ✗.
3. **Clean shutdown test result** — specifically call out whether SIGTERM exited cleanly with no error log.
4. **Any deviations from the spec** — judgment calls you made.
5. **Commit hash** — the SHA of your extraction commit.
6. **Anything unexpected** — surprising grep hits, import path issues, side effects you didn't expect from running the code.

If you encounter a blocker (tests failing, import resolution issues, ordering breakage), stop and describe the blocker. Do not attempt a fix unless it's an obvious typo in your own edit.

---

## Files you will touch

- `open-robin-server/lib/startup.js` — new file, create it
- `open-robin-server/server.js` — delete ~140 lines (startup bootstrap + startServer function + signal handlers + 2 redundant top-level imports), add 1 import, add ~15 lines of wiring at the new startup location

That's it. Two files. One create + edits to server.js.

---

## After this SPEC lands

The user and the IDE Claude session will verify the work, then move on to SPEC-01c (Wire Process Manager extraction). Each of the six extractions gets its own spec. Do not start the next one.
