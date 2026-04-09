# SPEC-01e — Extract Agent Session Handler from server.js

**Parent:** SPEC-01 (server.js decomposition)
**Position:** Extraction 5 of 6.
**Depends on:** SPEC-01a, 01b, 01c, 01d all merged. Latest commit should be `c4767ff` (01d) or later.
**Model recommendation:** Opus 4.6 with 1M context window.
**Estimated blast radius:** Medium. One non-trivial factory extraction plus one small dedicated-concern module. Session closure semantics apply. Not as fragile as 01d, but has the `agentWireSessions` global-assignment wrinkle that was flagged back in 01c.

---

## Your mission

Extract the `thread:open-agent` handler (currently lines 440–546 inside the `ws.on('message')` block of `server.js`) into a new file at `open-robin-server/lib/thread/agent-session-handler.js`. Use a per-connection factory, matching the pattern established by 01c (`createWireLifecycle`) and 01d (`createWireMessageRouter`).

In the same pass, extract the `agentWireSessions` Map + its `global.__agentWireSessions` assignment + two small helper functions into a new file at `open-robin-server/lib/wire/agent-sessions.js`. Max modularity — one concern per file.

**Two new files. One modified (server.js). One commit.** server.js drops from 919 → ~810 lines.

The `agent-session-handler.js` factory is called once per WebSocket connection, inside `wss.on('connection')`. It closes over the per-connection `ws`, `session`, `projectRoot`, and the wire lifecycle helpers (from `createWireLifecycle`). Module-level imports handle everything else.

**You are extracting, not refactoring.** Preserve `thread:open-agent`'s behavior exactly. The session invalidation logic, the agent-thread-manager caching via `ThreadWebSocketHandler.setPanel`, the registry lookup for bot name → agent folder, the `agentWireSessions.set(botName, session.wire)` registration, the `.on('exit', ...)` unregister cleanup — all verbatim. Only the location moves.

---

## Context before you touch code

1. `ai/views/capture-viewer/content/todo/specs/01-server-js-CONTEXT-FORWARD.md` — gotchas, especially **#1 Session closure scope** and **#3 `global.__agentWireSessions`**.
2. `ai/views/capture-viewer/content/todo/specs/01a–d` — prior extraction specs. Read 01c for the per-connection factory pattern and 01d for the "create router first, then lifecycle" ordering rule.
3. `ai/views/capture-viewer/content/todo/REFACTOR-LOG.md` — read the SPEC-01c and SPEC-01d entries, particularly the `agentWireSessions` surprise.
4. `open-robin-server/lib/wire/process-manager.js` — the source of `registerWire`. Shows the "module-private state + helper exports" pattern you'll mirror for `agent-sessions.js`.
5. `open-robin-server/lib/thread/thread-crud.js` and `thread-messages.js` — factory patterns you'll follow.
6. `open-robin-server/lib/session/session-loader.js` — the inline require inside the current handler (`parseSessionConfig`, `buildSystemContext`, `checkSessionInvalidation`, `getStrategy`). You will MOVE this require from inline to the top of the new file (see Gotcha #5).

**Verify line-number drift:**

```bash
wc -l open-robin-server/server.js
# Should report 919. If different, reconcile.

grep -n 'thread:open-agent\|agentWireSessions' open-robin-server/server.js
```

Expected landmarks as of commit `c4767ff`:
- `177:const agentWireSessions = new Map();`
- `178:global.__agentWireSessions = agentWireSessions;`
- `440:      if (clientMsg.type === 'thread:open-agent') {`
- `537:            agentWireSessions.set(botName, session.wire);`
- `538:            session.wire.on('exit', () => agentWireSessions.delete(botName));`

If off by more than ~5, reconcile first.

---

## Source — what you are moving

### Part A: `agentWireSessions` Map (lines 177–178)

```js
// Agent persona wire sessions (agentName -> wire)
// Used by hold registry and runner to notify active persona sessions
const agentWireSessions = new Map();
global.__agentWireSessions = agentWireSessions;
```

These two lines move to `lib/wire/agent-sessions.js` as module-level state. The `global.__agentWireSessions` assignment **must still happen at server boot**, triggered via a transitive require chain (see Gotcha #2).

### Part B: `thread:open-agent` handler (lines 440–546)

106 lines. Starts at `if (clientMsg.type === 'thread:open-agent') {` and ends at `}` before the next `if (clientMsg.type === 'thread:rename')` block at line 548.

Handler responsibilities (do not re-architect any of these):

1. Validate `agentPath` argument
2. Close current wire if switching (`session.wire.kill('SIGTERM')`)
3. Inline require of `./lib/session/session-loader` — **MOVE to top-level require in the new file**
4. Load `SESSION.md` config via `parseSessionConfig`
5. Create ThreadManager for this agent via `ThreadWebSocketHandler.setPanel` with a synthetic panelId derived from agentPath
6. Resolve thread via the strategy returned by `getStrategy(config.threadModel)`
7. Check session invalidation via `checkSessionInvalidation` (memory-mtime mode)
8. Build system context via `buildSystemContext`, assign to `session.pendingSystemContext`
9. Fetch history + rich history from the agent's ThreadManager
10. Extract context usage from the last exchange's metadata
11. Send `thread:opened` to the client
12. Spawn wire via `spawnThreadWire`
13. Register wire via `registerWire(threadId, session.wire, projectRoot, ws)` (note the 4-arg signature from 01d)
14. Call wire lifecycle: `awaitHarnessReady` → `setupWireHandlers` → `initializeWire`
15. Read `registry.json`, find the bot name whose `folder` matches `agentPath`, register agent session
16. Open session via `agentThreadManager.openSession(threadId, session.wire, ws)`

### NOT moving

- Any other `thread:*` handler. Only `thread:open-agent`.
- `ThreadWebSocketHandler.setPanel` itself — it stays in the thread module.
- `spawnThreadWire` — stays in `lib/harness/compat.js`.
- `registerWire` — stays in `lib/wire/process-manager.js`.
- `checkSettingsBounce` or anything else from 01d.
- The `wss.on('connection')` body beyond the handler itself — stays.

---

## Target — two new files

### File 1: `open-robin-server/lib/wire/agent-sessions.js`

~30 lines. Module shape:

```js
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
```

**Key design points:**

- The Map is module-private — not exported.
- `global.__agentWireSessions = agentWireSessions` is a **top-level side-effect statement**. It runs exactly once, the first time any file requires this module.
- The `.on('exit', ...)` auto-cleanup is folded into `registerAgentSession` (it was inline in the original server.js handler — folding it is a small simplification that doesn't change behavior, because it's the same two-line idiom verbatim, just moved behind the helper).
- `getAgentSession` is exported for symmetry with `process-manager.js`'s `getWireForThread`. Not currently used by anyone outside the runner's global read, but it belongs in the module's API.

### File 2: `open-robin-server/lib/thread/agent-session-handler.js`

~140 lines. Module shape:

```js
/**
 * Agent Session Handler
 *
 * Handles the thread:open-agent client message. Loads SESSION.md config
 * for a named agent persona, resolves a thread via the agent's
 * ThreadManager + strategy, spawns a wire, wires up the per-connection
 * lifecycle helpers, and registers the agent session by bot name.
 *
 * Extracted from server.js per SPEC-01e. Lives in lib/thread/ rather
 * than lib/agent/ because it is morally a thread operation — it sits
 * alongside thread-crud.js and thread-messages.js as a thread handler
 * factory, and uses ThreadWebSocketHandler / ThreadManager as its
 * primary collaborators.
 *
 * Per-connection factory: called once per WebSocket connection inside
 * wss.on('connection'), after createWireLifecycle has produced the
 * lifecycle helpers.
 */

const path = require('path');
const fs = require('fs');

const {
  parseSessionConfig,
  buildSystemContext,
  checkSessionInvalidation,
  getStrategy,
} = require('../session/session-loader');

const { spawnThreadWire } = require('../harness/compat');
const { registerWire } = require('../wire/process-manager');
const { registerAgentSession } = require('../wire/agent-sessions');

/**
 * Create a per-connection thread:open-agent handler.
 *
 * @param {object} deps
 * @param {import('ws').WebSocket} deps.ws - the connection's WebSocket
 * @param {object} deps.session - per-connection session state object (mutated)
 * @param {string} deps.projectRoot - resolved at connection time
 * @param {string} deps.AI_PANELS_PATH - absolute ai/views/ path
 * @param {() => string} deps.getDefaultProjectRoot - re-evaluated at handler-call time for live config reload
 * @param {object} deps.threadWebSocketHandler - the ThreadWebSocketHandler module
 * @param {{ awaitHarnessReady, initializeWire, setupWireHandlers }} deps.wireLifecycle - from createWireLifecycle
 * @returns {{ handleThreadOpenAgent: (clientMsg: object) => Promise<void> }}
 */
function createAgentSessionHandler({
  ws,
  session,
  projectRoot,
  AI_PANELS_PATH,
  getDefaultProjectRoot,
  threadWebSocketHandler,
  wireLifecycle,
}) {

  const { awaitHarnessReady, initializeWire, setupWireHandlers } = wireLifecycle;

  async function handleThreadOpenAgent(clientMsg) {
    const { agentPath } = clientMsg;
    if (!agentPath) {
      ws.send(JSON.stringify({ type: 'error', message: 'Missing agentPath' }));
      return;
    }

    // Close current wire if switching
    if (session.wire) {
      session.wire.kill('SIGTERM');
      session.wire = null;
    }

    const agentFolderPath = path.join(AI_PANELS_PATH, 'agents-viewer', agentPath);

    // Load SESSION.md config
    const config = parseSessionConfig(agentFolderPath);
    if (!config) {
      ws.send(JSON.stringify({ type: 'error', message: `No SESSION.md in ${agentPath}` }));
      return;
    }

    // Get or create ThreadManager for this agent (single instance, cached)
    // Use absolute path to agent's chat folder as the stable DB key
    const agentChatPath = path.join(agentFolderPath, 'chat');
    threadWebSocketHandler.setPanel(ws, agentChatPath, {
      panelPath: agentFolderPath,
      projectRoot: getDefaultProjectRoot(),
      viewName: `agent:${agentPath}`,
    });
    const agentThreadManager = threadWebSocketHandler.getState(ws).threadManager;
    await agentThreadManager.init();

    // Get strategy and resolve thread
    const strategy = getStrategy(config.threadModel);
    const { threadId, isNew } = await strategy.resolveThread(agentThreadManager);

    if (!threadId) {
      ws.send(JSON.stringify({ type: 'error', message: 'Strategy returned no thread' }));
      return;
    }

    // Check session invalidation
    if (config.sessionInvalidation === 'memory-mtime' && !isNew) {
      const thread = await agentThreadManager.index.get(threadId);
      const lastMessage = thread?.resumedAt ? new Date(thread.resumedAt).getTime() : 0;
      if (checkSessionInvalidation(agentFolderPath, lastMessage)) {
        console.log(`[WS] MEMORY.md changed — archiving thread ${threadId}`);
        await agentThreadManager.index.suspend(threadId);
        // Resolve a fresh thread
        const fresh = await strategy.resolveThread(agentThreadManager);
        if (fresh.threadId && fresh.threadId !== threadId) {
          // Use the fresh thread
          Object.assign(fresh, { threadId: fresh.threadId });
        }
      }
    }

    session.currentThreadId = threadId;

    // Build system context from SESSION.md's system-context list
    const systemContext = buildSystemContext(agentFolderPath, config.systemContext);
    session.pendingSystemContext = systemContext;

    // Send thread history to client
    const history = await agentThreadManager.getHistory(threadId);
    const richHistory = await agentThreadManager.getRichHistory(threadId);

    // Extract context usage from the last exchange's metadata
    const exchanges = richHistory?.exchanges || [];
    const lastExchange = exchanges.length > 0 ? exchanges[exchanges.length - 1] : null;
    const contextUsage = lastExchange?.metadata?.contextUsage ?? null;

    ws.send(JSON.stringify({
      type: 'thread:opened',
      threadId,
      thread: await agentThreadManager.index.get(threadId),
      history: history?.messages || [],
      exchanges: exchanges,
      contextUsage,
      agentPath,
      strategy: { canBrowseOld: strategy.canBrowseOld, canCreateNew: strategy.canCreateNew },
    }));

    // Spawn wire
    console.log(`[WS] Spawning wire for agent persona: ${agentPath}, thread: ${threadId}`);
    session.wire = spawnThreadWire(threadId, projectRoot);
    registerWire(threadId, session.wire, projectRoot, ws);
    await awaitHarnessReady(session.wire);
    setupWireHandlers(session.wire, threadId);
    initializeWire(session.wire);

    // Track agent wire session for notifications
    const registry = JSON.parse(
      fs.readFileSync(path.join(AI_PANELS_PATH, 'agents-viewer', 'registry.json'), 'utf8')
    );
    for (const [botName, agent] of Object.entries(registry.agents || {})) {
      if (agent.folder === agentPath) {
        registerAgentSession(botName, session.wire);
        break;
      }
    }

    await agentThreadManager.openSession(threadId, session.wire, ws);
    console.log(`[WS] Agent persona session opened: ${agentPath}`);
  }

  return { handleThreadOpenAgent };
}

module.exports = { createAgentSessionHandler };
```

**Transcribe the current handler body character-for-character** with three precise transformations:

1. **The inline `require` at current line 453** becomes a top-of-file require:
   ```js
   // BEFORE (inline inside the handler):
   const { parseSessionConfig, buildSystemContext, checkSessionInvalidation, getStrategy } = require('./lib/session/session-loader');

   // AFTER (top of lib/thread/agent-session-handler.js):
   const {
     parseSessionConfig,
     buildSystemContext,
     checkSessionInvalidation,
     getStrategy,
   } = require('../session/session-loader');
   ```
   Note the path rewrite: `./lib/session/session-loader` → `../session/session-loader` because the new file lives in `lib/thread/` and needs to hop up one level.

2. **The two-line agentWireSessions registration** collapses into a single `registerAgentSession` call:
   ```js
   // BEFORE (current lines 537-538):
   agentWireSessions.set(botName, session.wire);
   session.wire.on('exit', () => agentWireSessions.delete(botName));

   // AFTER:
   registerAgentSession(botName, session.wire);
   ```
   Same behavior, wrapped in the helper from `lib/wire/agent-sessions.js`. The exit handler logic moves into `registerAgentSession` (verbatim — same arrow function, same `.on('exit', ...)` call).

3. **`ThreadWebSocketHandler.setPanel(...)` and `ThreadWebSocketHandler.getState(...)`** become `threadWebSocketHandler.setPanel(...)` and `threadWebSocketHandler.getState(...)` — the capitalized module reference becomes the lowercase injected dep name. Semantically identical (just renamed via destructuring at the factory boundary). **Do not add a local alias** like `const TWH = threadWebSocketHandler;` — use the lowercased name directly in the handler body.

Nothing else in the handler body changes. Every other line is verbatim.

---

## Wiring — what changes in server.js

### 1. Delete the `agentWireSessions` declaration (lines 177–178)

Remove:

```js
// Agent persona wire sessions (agentName -> wire)
// Used by hold registry and runner to notify active persona sessions
const agentWireSessions = new Map();
global.__agentWireSessions = agentWireSessions;
```

server.js no longer references `agentWireSessions` directly. The global assignment still happens, via the transitive require chain: `server.js → lib/thread/agent-session-handler.js → lib/wire/agent-sessions.js → global.__agentWireSessions = ...` at module load time. See Gotcha #2.

### 2. Add the import for `createAgentSessionHandler`

Near the other `lib/` imports at the top of server.js (around lines 30–62):

```js
const { createAgentSessionHandler } = require('./lib/thread/agent-session-handler');
```

This single import is what triggers the transitive load of `lib/wire/agent-sessions.js` and sets the global. It must happen at the top-of-file (module-level require), not inside a handler. See Gotcha #2.

### 3. Create the per-connection factory inside `wss.on('connection')`

Just after the `createWireLifecycle` call (introduced in 01c) and `createWireMessageRouter` call (introduced in 01d), add:

```js
const { handleThreadOpenAgent } = createAgentSessionHandler({
  ws,
  session,
  projectRoot,
  AI_PANELS_PATH,
  getDefaultProjectRoot,
  threadWebSocketHandler: ThreadWebSocketHandler,
  wireLifecycle: { awaitHarnessReady, initializeWire, setupWireHandlers },
});
```

**Order matters.** This call must come AFTER both `createWireLifecycle` (because it passes the three lifecycle helpers) and the initial `session` declaration (because it closes over `session`).

### 4. Replace the handler body with a single call

Delete lines 440–546 (the entire `if (clientMsg.type === 'thread:open-agent') { ... }` block) and replace with:

```js
if (clientMsg.type === 'thread:open-agent') {
  await handleThreadOpenAgent(clientMsg);
  return;
}
```

Four lines replacing 106. The handler itself lives in the factory closure, capturing `ws`, `session`, `projectRoot`, and the wire lifecycle.

### 5. Verify nothing else in server.js references the deleted code

```bash
# Should be zero matches
grep -n "agentWireSessions" open-robin-server/server.js

# Should be zero matches
grep -n "parseSessionConfig\|buildSystemContext\|checkSessionInvalidation\|getStrategy" open-robin-server/server.js

# Should be exactly one match (the import line)
grep -n "createAgentSessionHandler" open-robin-server/server.js

# Should be exactly ONE match: the factory call inside wss.on('connection')
grep -n "handleThreadOpenAgent" open-robin-server/server.js
# Actually two matches: the factory destructure + the call. Adjust expectation accordingly.

# Should be exactly one match: in lib/wire/agent-sessions.js (the global assignment)
grep -rn "global.__agentWireSessions" open-robin-server/ --include='*.js'

# Should appear in exactly two files: lib/wire/agent-sessions.js (declaration) and
# lib/thread/agent-session-handler.js (the registerAgentSession call).
# NO matches in server.js.
grep -rn "agentWireSessions\b" open-robin-server/ --include='*.js'
```

---

## Gotchas — preserve these exactly

### 1. Session closure scope

The handler closes over `session` (mutated: `session.wire`, `session.currentThreadId`, `session.pendingSystemContext`), `ws` (used for client sends), and `projectRoot` (passed to `spawnThreadWire` and `registerWire`). All three are per-connection values. The factory must be called **inside `wss.on('connection')`**, once per connection, after `session` has been initialized (around line 259) and after `projectRoot` has been resolved (line 256).

**The failure mode:** if the factory is called at module load time or at startup instead of per-connection, it would try to close over variables that don't exist yet and all connections would share a single session. Same failure as the 01d gotcha.

### 2. `global.__agentWireSessions` — the transitive load chain

This is the central gotcha of this spec. The runner (`lib/runner/index.js`) reads `global.__agentWireSessions` directly. That global must be assigned before any code that reads it runs.

In the current code, the assignment happens at `server.js:178`, which runs at server.js module load. After the extraction, the assignment is at the top of `lib/wire/agent-sessions.js`. For the assignment to fire in time, `agent-sessions.js` must be loaded early — specifically, before `lib/startup.js` does `require('./runner')` inside `_startPipeline` (which runs after `server.listen()`).

**The chain that guarantees this:**

```
server.js (module load)
  ↓ requires lib/thread/agent-session-handler.js (top-of-file require in step 2)
    ↓ requires lib/wire/agent-sessions.js (top-of-file require)
      ↓ executes `global.__agentWireSessions = agentWireSessions;` (side effect)
server.js finishes loading
  ↓ calls startup.js's start()
    ↓ eventually runs _startPipeline
      ↓ requires lib/runner inside the listen callback
        ↓ runner reads global.__agentWireSessions — it's set, because server.js
          finished its module-level requires long before listen fired.
```

**The thing that would break this chain:** if you don't import `agent-session-handler.js` at the **top** of server.js (module-level require), the transitive load never happens. For example, if you tried to do a conditional require inside the handler block, the global would not be assigned until the first `thread:open-agent` message arrived — by which time the runner might already be running and reading an undefined global.

**Verification:** after the extraction, run `node -e "require('./open-robin-server/server.js'); console.log(typeof global.__agentWireSessions);"` from the repo root. It should print `object` (the Map is set). If it prints `undefined`, the require chain is broken.

### 3. Inline `require` moves to top-of-file

Line 453 does `const { parseSessionConfig, ... } = require('./lib/session/session-loader');` inline inside the handler. In the new file, this moves to the top-of-file requires. Path rewrites from `./lib/session/session-loader` to `../session/session-loader`.

The inline-require pattern was unusual. Most of the server.js imports are top-of-file. The executing session should assume the inline location was incidental rather than deliberate — standard top-level import is correct for the new file.

### 4. `ThreadWebSocketHandler` → `threadWebSocketHandler` (lowercase via injection)

The current code uses the capitalized module name `ThreadWebSocketHandler` directly because it's imported at the top of server.js. After extraction, the module is injected via the factory as a lowercase name `threadWebSocketHandler`. All four references in the handler body (`ThreadWebSocketHandler.setPanel`, `ThreadWebSocketHandler.getState`, and any others) become `threadWebSocketHandler.setPanel`, `threadWebSocketHandler.getState`, etc.

Do not rename back, do not alias, do not import the module directly in the new file. The injection lets us preserve the pattern where the module is a server.js-level concern.

### 5. `getDefaultProjectRoot` is called INSIDE the handler — inject it as a function, not a value

Line 468 calls `getDefaultProjectRoot()` fresh, not the pre-computed `projectRoot` that's in scope. This is deliberate — `getDefaultProjectRoot` reads from a config file that might change between connection and handler call. Inject it as a function reference, not a captured value:

```js
// Inject as function:
threadWebSocketHandler.setPanel(ws, agentChatPath, {
  panelPath: agentFolderPath,
  projectRoot: getDefaultProjectRoot(),  // call the injected function
  viewName: `agent:${agentPath}`,
});
```

Do not replace `getDefaultProjectRoot()` with the per-connection `projectRoot` variable. They're the same value on startup but diverge if config reloads.

### 6. `registerWire` is 4-arg post-01d

Verify that the `registerWire(threadId, session.wire, projectRoot, ws)` call inside the handler keeps the 4-arg shape (from 01d). Don't revert it to the 3-arg shape.

### 7. The `if (config.sessionInvalidation === 'memory-mtime' && !isNew)` block is broken as written

The block has a subtle bug — it resolves a `fresh` thread and then does `Object.assign(fresh, { threadId: fresh.threadId })` which is a no-op, never actually switches to the fresh thread. This is a pre-existing bug, **not in scope** for SPEC-01e. Preserve the buggy code verbatim. File a follow-up in the refactor log.

**Do not fix this bug inside SPEC-01e.** The extraction must be behaviorally identical to the current code.

### 8. The `console.log` strings stay identical

- `[WS] MEMORY.md changed — archiving thread ${threadId}`
- `[WS] Spawning wire for agent persona: ${agentPath}, thread: ${threadId}`
- `[WS] Agent persona session opened: ${agentPath}`

Keep the `[WS]` prefix even though the new file isn't server.js. The prefix is a log-grep convention; changing it to `[AgentSession]` or similar would break any tool that greps for `[WS]`. Preserve verbatim.

### 9. Do not export `agentWireSessions` from `agent-sessions.js`

The Map is module-private. Exports are only the three helper functions. If you export the Map itself, any consumer could mutate it directly and bypass the `.on('exit', ...)` auto-cleanup in `registerAgentSession`.

### 10. Maps stay separate

`wireRegistry` (in `process-manager.js`) and `agentWireSessions` (in `agent-sessions.js`) are **two different Maps serving two different purposes**:

- `wireRegistry`: keyed by threadId, tracks chat wires. One wire per thread.
- `agentWireSessions`: keyed by bot name (from `registry.json`), tracks agent persona wires. One wire per bot.

Do not merge them. Do not move `agent-sessions.js` logic into `process-manager.js`. Single concern per file — that's the point.

### 11. The handler does NOT return a value

The current handler body in the `ws.on('message')` block ends with `return;` (an early return out of the handler to prevent fall-through to the next `if`). In the new factory, the handler body ends implicitly. The caller in server.js becomes:

```js
if (clientMsg.type === 'thread:open-agent') {
  await handleThreadOpenAgent(clientMsg);
  return;
}
```

The `return` moves from inside the handler to the caller. This preserves the control-flow semantics (don't fall through to the next message-type check).

---

## Verification checklist

After the extraction:

### Sanity checks (static)

1. `wc -l open-robin-server/server.js` — approximately 810 lines (down from 919).
2. `wc -l open-robin-server/lib/wire/agent-sessions.js` — approximately 30 lines.
3. `wc -l open-robin-server/lib/thread/agent-session-handler.js` — approximately 140 lines.
4. `node -e "require('./open-robin-server/lib/wire/agent-sessions')"` — loads clean. Should print nothing.
5. `node -e "require('./open-robin-server/lib/wire/agent-sessions'); console.log(typeof global.__agentWireSessions);"` — prints `object` (the global is set by side effect).
6. `node -e "require('./open-robin-server/lib/thread/agent-session-handler')"` — loads clean. Also prints nothing. This transitively loads `agent-sessions.js` via the top-of-file require.
7. `node -e "require('./open-robin-server/server.js'); console.log(typeof global.__agentWireSessions);"` — prints `object`. This proves the transitive load chain works: requiring server.js triggers requiring agent-session-handler which triggers requiring agent-sessions which assigns the global. (EADDRINUSE during this is fine — `server.listen` may fire. We're just verifying the require chain.)
8. Grep checks from the "Verify nothing else in server.js references" section above — all must pass.

### Runtime checks

Run `./restart-kimi.sh`. If it fails, stop and report.

9. `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/` → `200`.
10. `tail -40 open-robin-server/server-live.log` — clean startup, no errors.
11. **Chat round-trip — existing chat must still work.** Open the browser, create a normal (non-agent) thread, send a message. This is the regression check — agent-session extraction should not affect normal chat flows.
12. **Agent session round-trip — the canary for this spec.** If you have an agent persona configured in `ai/views/agents-viewer/*/SESSION.md`, open it via the agent UI. Expected sequence in the log:
    - `[ThreadWS] ...` (panel set)
    - `[WS] Spawning wire for agent persona: ...`
    - `[WireRegistry] Registered wire for thread ...`
    - `[WS] Agent persona session opened: ...`
    - Wire messages start flowing
    If the agent panel fails to open or the wire never spawns, the extraction broke the handler. Stop and report.
13. **Global sanity check runtime.** After the server is running, `curl -s http://localhost:3001/api/some-debug-endpoint-if-you-have-one` — or just confirm via `ps -o command | head -1` that `node server.js` is running and has not crashed. No crash = module loaded successfully = global assignment worked.
14. **Clean shutdown.** `lsof -ti:3001 | xargs kill -TERM`. Port freed cleanly.

---

## What NOT to do

- **Do not** fix the pre-existing bug in the session-invalidation "fresh thread" block (Gotcha #7). Preserve verbatim.
- **Do not** export the `agentWireSessions` Map directly. Only helpers.
- **Do not** merge `agent-sessions.js` with `process-manager.js`. See Gotcha #10.
- **Do not** rename the `[WS]` log prefix. See Gotcha #8.
- **Do not** hoist the factory call outside `wss.on('connection')`. See Gotcha #1.
- **Do not** use the pre-computed `projectRoot` in place of `getDefaultProjectRoot()` inside the handler. See Gotcha #5.
- **Do not** skip the top-of-file import of `agent-session-handler.js` in server.js. It's what triggers the transitive load chain that assigns `global.__agentWireSessions`. See Gotcha #2.
- **Do not** use a conditional or lazy require of `agent-session-handler.js` in server.js. The require must happen at module-load time.
- **Do not** touch the other `thread:*` handlers (rename, delete, copyLink, list).
- **Do not** touch the client-side code.
- **Do not** push the commit. Commit locally only.
- **Do not** update this spec doc. The user does that.
- **Do not** start SPEC-01f. Stop after SPEC-01e.

---

## Commit

One commit. Message:

```
Extract agent session handler and agentWireSessions registry

Part 5 of 6 under SPEC-01 (server.js decomposition). Two new files,
one modified.

- NEW: lib/wire/agent-sessions.js (~30 lines)
  Module-private agentWireSessions Map with registerAgentSession /
  unregisterAgentSession / getAgentSession helpers. Assigns
  global.__agentWireSessions at module-load time as a side effect
  so the runner (lib/runner/index.js) can continue reading it
  directly. Separate from lib/wire/process-manager.js's wireRegistry
  — agent persona wires are a different concern from chat thread
  wires.

- NEW: lib/thread/agent-session-handler.js (~140 lines)
  The thread:open-agent handler extracted as a per-connection
  factory createAgentSessionHandler({ ws, session, projectRoot,
  AI_PANELS_PATH, getDefaultProjectRoot, threadWebSocketHandler,
  wireLifecycle }) returning { handleThreadOpenAgent }. Lives in
  lib/thread/ rather than lib/agent/ because it is morally a
  thread operation. Calls registerAgentSession from the new
  agent-sessions module for the bot-name → wire registration
  (replaces the inline set + .on('exit', ...) pattern with a
  single helper call).

- MODIFIED: server.js
  - Deletes agentWireSessions Map + global assignment (now in
    lib/wire/agent-sessions.js, loaded transitively via the
    top-of-file import of agent-session-handler.js).
  - Deletes the 106-line inline thread:open-agent handler.
  - Adds createAgentSessionHandler import at top-of-file.
  - Calls createAgentSessionHandler inside wss.on('connection')
    after createWireLifecycle, destructures handleThreadOpenAgent.
  - Replaces the handler block with a 3-line call to handleThreadOpenAgent.

The inline require of lib/session/session-loader inside the old
handler moves to a top-of-file require in agent-session-handler.js.

Preserves:
  - global.__agentWireSessions assignment, via transitive load chain
  - ThreadWebSocketHandler.setPanel + getState usage (injected as
    threadWebSocketHandler)
  - getDefaultProjectRoot called fresh inside the handler (not the
    pre-computed projectRoot), for live config reload
  - The session-invalidation "fresh thread" block verbatim
    (includes a pre-existing bug that is NOT fixed in this spec;
    filed as a follow-up in the refactor log)
  - All [WS] log prefixes
  - checkSettingsBounce atomicity (01d gotcha — not touched)

server.js: 919 -> ~810 lines.
```

**Commit only. Do not push.**

---

## Reporting back

1. **Line counts** — wc -l for server.js, agent-sessions.js, agent-session-handler.js.
2. **Verification results** — each of the 14 checks.
3. **Transitive load verification** — explicitly run the `node -e "require('./open-robin-server/server.js'); console.log(typeof global.__agentWireSessions);"` check and report the output. This is the critical proof that the global assignment still fires at the right time.
4. **Agent session round-trip result** — if you have an agent persona available, did it open successfully?
5. **Normal chat round-trip result** — did the regression check pass (existing chat still works)?
6. **Deviations from spec** — judgment calls.
7. **Commit hash.**
8. **Anything unexpected** — particularly around the transitive load chain, inline require migration, or session closure.

If the `global.__agentWireSessions` check prints `undefined`, the extraction is broken — stop and report. The fix is almost certainly a missed or conditional require of `agent-session-handler.js` in server.js.

---

## Files you will touch

- `open-robin-server/lib/wire/agent-sessions.js` — NEW, ~30 lines
- `open-robin-server/lib/thread/agent-session-handler.js` — NEW, ~140 lines
- `open-robin-server/server.js` — MODIFIED, delete ~108 lines, add ~12 lines of wiring

Three files total. Two new, one modified. One commit.

---

## After this SPEC lands

SPEC-01f (Client Message Router) is the last. It depends on everything else being done and extracts the entire remaining `ws.on('message', async (message) => { ... })` body — by then, most of the heavy work is already decomposed (thread handlers, file explorer handlers, wire handlers, agent session handler), so 01f mostly just extracts the dispatch-and-delegate skeleton. Stop after 01e and let the user drive the next cycle.
