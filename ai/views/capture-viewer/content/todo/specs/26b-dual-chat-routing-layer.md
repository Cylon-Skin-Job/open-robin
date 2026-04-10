# SPEC-26b — Dual Chat Routing Layer (server-side)

**Parent:** SPEC-26 (dual-chat paradigm — left = project-scoped, right = view-scoped)
**Position:** Phase 2 of 4 in the 26 series. Builds on 26a's data model. Activates dual-scope routing on the server side. Does NOT touch the client (26c handles that).
**Depends on:**
- SPEC-26a merged (`72d390e`) — schema has `project_id`, `scope`, `view_id` columns
- All of 24x complete
**Model recommendation:** **Opus 4.6** or equivalent. ~25 access sites need scope-aware updates across 5 files. The wsState shape change is the structural backbone — every consumer must move to the new shape consistently.
**Estimated blast radius:** **Medium-high.** Changes the wsState shape (a coordination object touched by every thread handler), changes the ThreadManager constructor signature, restores per-view chat directory writes for view-scoped threads, and adds a `scope` field to every `thread:*` wire message. Backward-compat shim: missing `scope` defaults to `'view'` so the existing client keeps working unchanged.

---

## Your mission

Activate dual-scope routing on the server. After 26b lands:

- **Each WS connection holds TWO ThreadManagers** — one project-scoped, one view-scoped — with the project manager persisting across panel switches and the view manager swapping when the panel changes.
- **Wire protocol carries scope.** Every `thread:*` request message accepts an optional `scope` field (`'project'` or `'view'`); responses echo the scope so the client can route them. Missing `scope` defaults to `'view'` for backward compat.
- **Storage paths branch by scope.**
  - Project threads → `ai/views/chat/threads/<user>/<id>.md` (the 24c unified location)
  - View threads → `ai/views/<view>/chat/threads/<user>/<id>.md` (per-view path, restored)
- **Existing client behavior is preserved.** Current client never sends `scope`, so it transparently gets `view` scope, behaves identically to post-24f. The dual-chat experience requires 26c.
- **Data validation:** a Node test script (using the `ws` package) creates one project-scoped thread and one view-scoped thread, verifies they land in the correct storage locations and have the correct SQLite columns.

**Key implementation constraints:**

1. **Single-wire stays.** A WS connection still has only one wire process at a time. If the user opens a project thread, the existing wire (if any) is killed and replaced. Same for view threads. This is the "one chat is live, the other is paused" model. Real dual-wire support is deferred to 26d.

2. **Per-view chat directories get used again.** SPEC-24c stopped writing to `<view>/chat/threads/`. 26b restores those writes for view-scoped threads. The directory is auto-created via `ChatFile.ensureDir()` (`mkdir -p` semantics) on first write — no scaffolding step needed.

3. **The unified `ai/views/chat/threads/<user>/` location stays** — it becomes the home for project-scoped threads only. View-scoped threads stop writing there.

4. **`closeThread(ws, scope)` replaces `closeCurrentThread(ws)`.** The latter goes away. Every caller updates to specify which scope to close.

5. **Pre-prod wipe.** All existing threads (both DB and filesystem) get wiped during validation. Per parent spec, all threads are disposable test data.

**You are not touching:**
- Any client code — wire protocol additions are server-side only; the client doesn't need updating until 26c
- Client layout, components, state management
- Wire spawning concurrency — one wire per connection still, see 26d
- ChatFile.js — its constructor still takes `{ viewsDir, threadId }`; the path is computed by ThreadManager._getViewsDir() and passed in already-resolved
- ThreadIndex.js — fully done in 26a, no changes
- Migration files — no schema changes in 26b, just usage changes
- `lib/runner/`, `lib/frontmatter/`, `lib/views/`, `lib/wire/` — none of these touch the dual-scope concern
- The agents area (per saved feedback, in flux)
- CSS architecture — separate future spec

---

## Context before you touch code

Read these in order:

1. **`ai/views/wiki-viewer/content/enforcement/code-standards/PAGE.md`** — house rules.
2. **`ai/views/capture-viewer/content/todo/specs/26a-dual-chat-data-model.md`** — what 26a delivered. Understand that the SQLite schema is already dual-scope-ready; 26b is plumbing only.
3. **`ai/views/capture-viewer/content/todo/specs/26b-dual-chat-routing-layer.md`** — this spec.
4. **`open-robin-server/lib/thread/ThreadManager.js`** (all ~365 lines) — heavy edit. Constructor changes shape, `_getViewsDir` branches.
5. **`open-robin-server/lib/thread/ThreadWebSocketHandler.js`** (all ~195 lines) — wsState shape change is the structural pivot here.
6. **`open-robin-server/lib/thread/thread-crud.js`** (all ~365 lines) — every handler updates to scope-aware access.
7. **`open-robin-server/lib/thread/thread-messages.js`** (all ~95 lines) — small but exists in the access list.
8. **`open-robin-server/lib/ws/client-message-router.js`** (focus on L97-220 — the thread:* dispatch block) — extract scope from incoming messages.
9. **`open-robin-server/lib/thread/ChatFile.js`** (just confirm it doesn't need changes — the path resolution stays in ThreadManager).

### Line-number drift verification

```bash
cd /Users/rccurtrightjr./projects/open-robin/open-robin-server

wc -l \
  lib/thread/ThreadManager.js \
  lib/thread/ThreadWebSocketHandler.js \
  lib/thread/thread-crud.js \
  lib/thread/thread-messages.js \
  lib/ws/client-message-router.js
```

Expected (±5):
- `ThreadManager.js` ≈ 370
- `ThreadWebSocketHandler.js` ≈ 195
- `thread-crud.js` ≈ 365
- `thread-messages.js` ≈ 95
- `client-message-router.js` ≈ 470

### Pre-flight grep — find every state.threadManager / state.threadId access

```bash
grep -rn "state\.threadManager\|state\.threadId\|wsState\.get\|currentThreadId" lib/thread lib/ws server.js
```

Expected: 25+ hits across 4-5 files. Every hit needs to be reviewed and updated to use the new dual-scope wsState shape. This grep is your audit list — when 26b is done, run it again and verify EVERY hit either uses scope-aware access (`state.threadIds[scope]` / `state.threadManagers[scope]`) or has been removed.

### State of SQLite + filesystem before starting

```bash
echo "=== threads ==="
sqlite3 /Users/rccurtrightjr./projects/open-robin/ai/system/robin.db \
  "SELECT thread_id, project_id, scope, view_id, name FROM threads;"
echo ""
echo "=== filesystem (unified location) ==="
find /Users/rccurtrightjr./projects/open-robin/ai/views/chat -type f -name '*.md' 2>/dev/null
echo ""
echo "=== filesystem (per-view locations — should be empty after 24c) ==="
find /Users/rccurtrightjr./projects/open-robin/ai/views/*/chat/threads -type f -name '*.md' 2>/dev/null
```

Record the starting state. The pre-prod wipe step removes everything.

---

## Changes — file by file

### 1. `open-robin-server/lib/thread/ThreadManager.js`

**1a. Constructor signature change.**

Current (post-26a):
```js
constructor(panelId, config = {}) {
  this.panelId = panelId;
  this.projectRoot = config.projectRoot || null;
  this.config = { ...DEFAULT_CONFIG, ...config };

  if (!this.projectRoot) {
    throw new Error(/* ... */);
  }
  this.projectId = path.basename(this.projectRoot);

  this.index = new ThreadIndex(this.projectId, 'view', panelId);
  // ... session manager etc.
}
```

New:
```js
/**
 * @param {object} config
 * @param {'project'|'view'} config.scope - Thread scope
 * @param {string|null} config.viewId - View name when scope='view'; null for scope='project'
 * @param {string} config.projectRoot - Absolute project root path (required)
 * @param {number} [config.maxActiveSessions]
 * @param {number} [config.idleTimeoutMinutes]
 */
constructor(config = {}) {
  if (!config.projectRoot) {
    throw new Error('ThreadManager: projectRoot is required');
  }
  if (config.scope !== 'project' && config.scope !== 'view') {
    throw new Error(
      `ThreadManager: scope must be 'project' or 'view', got "${config.scope}"`
    );
  }
  if (config.scope === 'view' && !config.viewId) {
    throw new Error("ThreadManager: viewId is required when scope='view'");
  }

  this.scope = config.scope;
  this.viewId = config.scope === 'view' ? config.viewId : null;
  this.projectRoot = config.projectRoot;
  this.projectId = path.basename(this.projectRoot);
  this.config = { ...DEFAULT_CONFIG, ...config };

  /** @type {ThreadIndex} */
  this.index = new ThreadIndex(this.projectId, this.scope, this.viewId);

  /** @type {SessionManager} */
  this.sessionManager = new SessionManager(
    {
      maxActiveSessions: this.config.maxActiveSessions,
      idleTimeoutMinutes: this.config.idleTimeoutMinutes,
    },
    (threadId) => this.index.suspend(threadId)
  );
}
```

Key changes:
- Single config-object parameter (no more `panelId` first arg)
- `this.panelId` field is **removed**. Replaced by `this.viewId` (which is the same value for view scope, null for project scope).
- Scope validation is duplicated from ThreadIndex (defense in depth — fail fast at the manager layer)
- Throws on missing projectRoot, missing scope, invalid scope, missing viewId for view scope

**1b. `_getViewsDir()` becomes scope-aware.**

Current (post-26a, post-24c):
```js
_getViewsDir() {
  if (!this.projectRoot) return null;
  return path.join(this.projectRoot, 'ai', 'views', 'chat', 'threads', getUsername());
}
```

New:
```js
/**
 * Build the scope-appropriate per-user chat directory.
 *
 * SPEC-26b: branches by scope.
 *   - project scope → ai/views/chat/threads/<user>/  (the 24c unified location)
 *   - view scope    → ai/views/<view>/chat/threads/<user>/  (per-view, restored from pre-24c)
 *
 * @returns {string}
 */
_getViewsDir() {
  const baseViews = path.join(this.projectRoot, 'ai', 'views');
  if (this.scope === 'project') {
    return path.join(baseViews, 'chat', 'threads', getUsername());
  }
  // scope === 'view'
  return path.join(baseViews, this.viewId, 'chat', 'threads', getUsername());
}
```

Notes:
- The `if (!this.projectRoot) return null` guard is gone — the constructor enforces projectRoot is present.
- For view scope, the path uses `this.viewId` (the panel name).
- `getUsername()` is unchanged — comes from `lib/thread/ChatFile.js`.

**1c. Verify no other ThreadManager method references `this.panelId`.**

```bash
grep -n "this\.panelId" lib/thread/ThreadManager.js
# Expected after edits: zero hits
```

If any method still reads `this.panelId`, replace with `this.viewId` (or with a scope-aware branch if the method needs to handle both project and view).

**1d. Update the file header docstring.**

The current header (post-24c, post-24d) describes ThreadManager as managing one panel's threads. Update to reflect the new dual-scope reality:

Current:
```js
/**
 * ThreadManager - Main thread management orchestrator
 *
 * Combines ThreadIndex and ChatFile to provide full thread lifecycle management.
 * Delegates session management to SessionManager.
 * Handles session lifecycle: active → grace-period → suspended
 */
```

New:
```js
/**
 * ThreadManager - Single-scope thread orchestrator
 *
 * One ThreadManager instance is bound to one (projectId, scope, viewId)
 * tuple. Project-scoped managers handle threads shared across all views
 * in the project; view-scoped managers handle threads tied to a single
 * view. SPEC-26b. The WS coordinator (ThreadWebSocketHandler) holds two
 * managers per connection — one for each scope.
 *
 * Combines ThreadIndex (SQLite metadata) and ChatFile (markdown
 * persistence) to provide full thread lifecycle management. Delegates
 * session management to SessionManager. Handles session lifecycle:
 * active → grace-period → suspended.
 */
```

---

### 2. `open-robin-server/lib/thread/ThreadWebSocketHandler.js`

This is the structural pivot for 26b. The wsState shape changes; every consumer of `state.threadId` and `state.threadManager` must update.

**2a. Replace the global manager registry with two separate ones.**

Current:
```js
// Global registry: panelId -> ThreadManager
const threadManagers = new Map();
```

New:
```js
// Global registries — one per scope.
// SPEC-26b: project managers are keyed by projectId (typically a singleton
// per server process, since the server runs against one project root).
// View managers are keyed by `${projectId}:${viewId}` to handle the eventual
// workspace switcher (multi-project) without collisions.
const projectThreadManagers = new Map(); // key: projectId
const viewThreadManagers = new Map();    // key: `${projectId}:${viewId}`
```

**2b. Replace `getThreadManager` with two factories + a unified accessor.**

Current:
```js
function getThreadManager(panelId, config = {}) {
  const existing = threadManagers.get(panelId);
  if (existing) return existing;

  const manager = new ThreadManager(panelId, config);
  threadManagers.set(panelId, manager);
  manager.init().catch(err => {
    console.error(`[ThreadManager] Failed to init ${panelId}:`, err);
  });
  return manager;
}
```

New:
```js
const path = require('path');

/**
 * Get or create the project-scoped ThreadManager for a project root.
 * Project managers are stable across panel switches (one per project per
 * server process). SPEC-26b.
 *
 * @param {string} projectRoot
 * @returns {ThreadManager}
 */
function getProjectThreadManager(projectRoot) {
  const projectId = path.basename(projectRoot);
  let mgr = projectThreadManagers.get(projectId);
  if (!mgr) {
    mgr = new ThreadManager({ scope: 'project', projectRoot });
    projectThreadManagers.set(projectId, mgr);
    mgr.init().catch(err => {
      console.error(`[ProjectThreadManager] Failed to init ${projectId}:`, err);
    });
  }
  return mgr;
}

/**
 * Get or create the view-scoped ThreadManager for a (projectRoot, viewId)
 * pair. View managers swap as the user switches panels. SPEC-26b.
 *
 * @param {string} viewId
 * @param {string} projectRoot
 * @returns {ThreadManager}
 */
function getViewThreadManager(viewId, projectRoot) {
  const projectId = path.basename(projectRoot);
  const key = `${projectId}:${viewId}`;
  let mgr = viewThreadManagers.get(key);
  if (!mgr) {
    mgr = new ThreadManager({ scope: 'view', viewId, projectRoot });
    viewThreadManagers.set(key, mgr);
    mgr.init().catch(err => {
      console.error(`[ViewThreadManager] Failed to init ${key}:`, err);
    });
  }
  return mgr;
}
```

(`require('path')` may already be imported — verify before adding a duplicate.)

**2c. Rewrite `setPanel` to populate dual managers.**

Current:
```js
function setPanel(ws, panelId, config = {}) {
  const existing = wsState.get(ws);

  if (existing && existing.threadId) {
    closeCurrentThread(ws);
  }

  const manager = getThreadManager(panelId, config);

  wsState.set(ws, {
    panelId,
    viewName: config.viewName || panelId,
    threadId: null,
    threadManager: manager,
  });
}
```

New:
```js
function setPanel(ws, panelId, config = {}) {
  if (!config.projectRoot) {
    throw new Error('setPanel: config.projectRoot is required (SPEC-26b)');
  }

  const existing = wsState.get(ws);

  // Close currently open VIEW thread when switching panels — view threads
  // are tied to a specific view. Project threads PERSIST across panel
  // switches (that's the whole point of project scope).
  if (existing && existing.threadIds.view) {
    closeThread(ws, 'view');
  }

  // Project manager: stable across panel switches. Reuse if the connection
  // already has one (it always will, since setPanel runs on first connect).
  const projectMgr = existing?.threadManagers?.project
    || getProjectThreadManager(config.projectRoot);

  // View manager: always replace with the manager for the new panel.
  const viewMgr = getViewThreadManager(panelId, config.projectRoot);

  wsState.set(ws, {
    panelId,
    viewName: config.viewName || panelId,
    threadIds: {
      project: existing?.threadIds?.project || null,
      view: null,
    },
    threadManagers: {
      project: projectMgr,
      view: viewMgr,
    },
  });
}
```

Notes:
- Project managers persist across panel switches. View managers get replaced.
- Project thread IDs persist; view thread IDs reset on panel switch (each view has its own active thread).
- The check at the top fails fast if `projectRoot` is missing — used to be silent.

**2d. Replace `closeCurrentThread(ws)` with `closeThread(ws, scope)`.**

Current:
```js
async function closeCurrentThread(ws) {
  const state = wsState.get(ws);
  if (!state || !state.threadId) return;

  const { threadManager, threadId } = state;
  await threadManager.closeSession(threadId);

  state.threadId = null;
  console.log(`[ThreadWS] Closed thread ${threadId}`);
}
```

New:
```js
async function closeThread(ws, scope) {
  const state = wsState.get(ws);
  if (!state) return;

  const threadId = state.threadIds[scope];
  if (!threadId) return;

  const manager = state.threadManagers[scope];
  await manager.closeSession(threadId);

  state.threadIds[scope] = null;
  console.log(`[ThreadWS] Closed ${scope} thread ${threadId}`);
}
```

The function name changes (`closeCurrentThread` → `closeThread`). Every caller updates to specify scope. The crud handlers in `thread-crud.js` are the main callers — they get the scope from the message.

**2e. Update `cleanup(ws)` to close both scopes' threads.**

Current:
```js
function cleanup(ws) {
  const state = wsState.get(ws);
  if (state && state.threadId) {
    closeCurrentThread(ws);
  }
  wsState.delete(ws);

  const timer = pendingReorderTimers.get(ws);
  if (timer) {
    clearTimeout(timer);
    pendingReorderTimers.delete(ws);
  }
}
```

New:
```js
function cleanup(ws) {
  const state = wsState.get(ws);
  if (state) {
    if (state.threadIds.view) closeThread(ws, 'view');
    if (state.threadIds.project) closeThread(ws, 'project');
  }
  wsState.delete(ws);

  const timer = pendingReorderTimers.get(ws);
  if (timer) {
    clearTimeout(timer);
    pendingReorderTimers.delete(ws);
  }
}
```

**2f. `sendThreadList` becomes scope-aware.**

Current:
```js
async function sendThreadList(ws) {
  const state = wsState.get(ws);
  if (!state) return;

  const threads = await state.threadManager.listThreads();
  ws.send(JSON.stringify({
    type: 'thread:list',
    threads: threads.map(t => ({ threadId: t.threadId, entry: t.entry })),
  }));
}
```

New:
```js
async function sendThreadList(ws, scope) {
  if (!scope) {
    // Backward-compat default for older callers that don't pass scope.
    // SPEC-26b: callers should pass scope explicitly. Default 'view'
    // matches the pre-26b behavior.
    scope = 'view';
  }

  const state = wsState.get(ws);
  if (!state) return;

  const manager = state.threadManagers[scope];
  if (!manager) return;

  const threads = await manager.listThreads();
  ws.send(JSON.stringify({
    type: 'thread:list',
    scope,  // echo so the client knows which list to update
    threads: threads.map(t => ({ threadId: t.threadId, entry: t.entry })),
  }));
}
```

The response now includes `scope` so the client can route the list to the right sidebar (in 26c). Existing client (which doesn't read `scope`) ignores it harmlessly.

**2g. `getCurrentThreadId(ws, scope)` and `getCurrentThreadManager(ws, scope)` become scope-aware.**

Current:
```js
function getCurrentThreadId(ws) {
  return wsState.get(ws)?.threadId || null;
}

function getCurrentThreadManager(ws) {
  return wsState.get(ws)?.threadManager || null;
}
```

New:
```js
function getCurrentThreadId(ws, scope = 'view') {
  return wsState.get(ws)?.threadIds?.[scope] || null;
}

function getCurrentThreadManager(ws, scope = 'view') {
  return wsState.get(ws)?.threadManagers?.[scope] || null;
}
```

Default to `'view'` for backward compat with any caller that doesn't pass scope.

**2h. Update the wsState comment at the top of the file.**

Current:
```js
// Per-WS state: ws -> { panelId, threadId, threadManager }
const wsState = new Map();
```

New:
```js
// Per-WS state. SPEC-26b: dual-scope shape.
//   ws -> {
//     panelId,
//     viewName,
//     threadIds: { project: string|null, view: string|null },
//     threadManagers: { project: ThreadManager, view: ThreadManager }
//   }
// The project manager persists across panel switches; the view manager
// is swapped on every setPanel() call. Project threadId persists across
// panel switches; view threadId resets on switch.
const wsState = new Map();
```

**2i. Verify the module exports include the new helpers.**

```js
module.exports = {
  setPanel,
  getState,
  cleanup,
  sendThreadList,
  ...crud,
  ...messages,
  getCurrentThreadId,
  getCurrentThreadManager,
  // For testing
  _getProjectThreadManagers: () => projectThreadManagers,
  _getViewThreadManagers: () => viewThreadManagers,
  _getWsState: () => wsState,
};
```

Note: the old `_getThreadManagers` accessor (used by the smoke test) needs renaming or splitting. Update the smoke test if needed (see step 6 below).

---

### 3. `open-robin-server/lib/thread/thread-crud.js`

Every handler in this file accesses `state.threadManager` or `state.threadId`. Each one needs scope-aware access. The handlers extract scope from the incoming message.

**3a. Update `handleThreadCreate` (around L50-95).**

Current:
```js
async function handleThreadCreate(ws, msg) {
  const state = wsState.get(ws);
  if (!state) {
    ws.send(JSON.stringify({ type: 'error', message: 'No panel set' }));
    return;
  }

  const threadId = generateThreadId();
  const name = msg.name || null;
  const harnessId = msg.harnessId || 'kimi';

  try {
    const { threadId: createdId, entry } = await state.threadManager.createThread(threadId, name, {
      harnessId,
      harnessConfig: msg.harnessConfig,
    });
    // ...
  }
}
```

New:
```js
async function handleThreadCreate(ws, msg, scope = 'view') {
  const state = wsState.get(ws);
  if (!state) {
    ws.send(JSON.stringify({ type: 'error', message: 'No panel set' }));
    return;
  }

  const manager = state.threadManagers[scope];
  if (!manager) {
    ws.send(JSON.stringify({ type: 'error', message: `No ${scope} ThreadManager` }));
    return;
  }

  const threadId = generateThreadId();
  const name = msg.name || null;
  const harnessId = msg.harnessId || 'kimi';

  try {
    const { threadId: createdId, entry } = await manager.createThread(threadId, name, {
      harnessId,
      harnessConfig: msg.harnessConfig,
    });

    ws.send(JSON.stringify({
      type: 'thread:created',
      threadId: createdId,
      panel: state.viewName,
      scope,  // echo it so the client routes the response correctly
      thread: entry,
    }));

    await sendThreadList(ws, scope);
    await handleThreadOpen(ws, { threadId: createdId }, scope);
  } catch (err) {
    console.error('[ThreadWS] Create failed:', err);
    ws.send(JSON.stringify({ type: 'error', message: err.message }));
  }
}
```

Key changes:
- New third parameter `scope = 'view'`
- Replaces `state.threadManager` with `state.threadManagers[scope]`
- Echoes `scope` in the `thread:created` response
- Passes `scope` through to `sendThreadList` and `handleThreadOpen`

**3b. Update `handleThreadOpen` (around L95-180).**

Current (key part):
```js
async function handleThreadOpen(ws, msg) {
  const state = wsState.get(ws);
  if (!state) { /* error */ return; }

  const { threadId } = msg;
  const { threadManager } = state;

  const thread = await threadManager.getThread(threadId);
  if (!thread) { /* error */ return; }

  if (state.threadId && state.threadId !== threadId) {
    await closeCurrentThread(ws);
  }

  state.threadId = threadId;
  // ... mark resumed, fetch history, send thread:opened, ...
}
```

New:
```js
async function handleThreadOpen(ws, msg, scope = 'view') {
  const state = wsState.get(ws);
  if (!state) { /* error */ return; }

  const { threadId } = msg;
  const manager = state.threadManagers[scope];
  if (!manager) { /* error */ return; }

  const thread = await manager.getThread(threadId);
  if (!thread) { /* error */ return; }

  // Close currently active thread of THE SAME SCOPE if switching threads.
  // The other scope's thread stays alive.
  if (state.threadIds[scope] && state.threadIds[scope] !== threadId) {
    await closeThread(ws, scope);
  }

  state.threadIds[scope] = threadId;

  // Set harness mode based on thread's stored preference
  const { setThreadMode } = require('../harness/feature-flags');
  const harnessId = thread.entry?.harnessId || 'kimi';
  const mode = harnessId === 'kimi' ? 'legacy' : 'new';
  setThreadMode(threadId, mode);

  await manager.index.markResumed(threadId);

  const history = await manager.getHistory(threadId);
  const richHistory = await manager.getRichHistory(threadId);

  const exchanges = richHistory?.exchanges || [];
  const lastExchange = exchanges.length > 0 ? exchanges[exchanges.length - 1] : null;
  const contextUsage = lastExchange?.metadata?.contextUsage ?? null;

  ws.send(JSON.stringify({
    type: 'thread:opened',
    threadId,
    panel: state.viewName,
    scope,
    thread: thread.entry,
    history: history?.messages || [],
    exchanges,
    contextUsage,
  }));

  await manager.index.touch(threadId);

  // Delayed sendThreadList for the same scope (existing reorder behavior)
  const existingTimer = pendingReorderTimers.get(ws);
  if (existingTimer) clearTimeout(existingTimer);

  const timer = setTimeout(() => {
    pendingReorderTimers.delete(ws);
    sendThreadList(ws, scope).catch(err => {
      console.error('[ThreadWS] Delayed sendThreadList failed:', err);
    });
  }, REORDER_DELAY_MS);

  pendingReorderTimers.set(ws, timer);

  console.log(`[ThreadWS] Opened ${scope} thread ${threadId} (panel: ${state.panelId})`);
}
```

Note the careful close-only-same-scope logic — opening a project thread does NOT close the view thread, and vice versa. This is key to the "two parallel chats" model.

**3c. Update `handleThreadOpenAssistant` (the dispatcher, around L195-240).**

Current:
```js
async function handleThreadOpenAssistant(ws, msg) {
  const state = wsState.get(ws);
  if (!state) { /* error */ return; }

  if (msg.threadId) {
    const existing = await state.threadManager.getThread(msg.threadId);
    if (existing) {
      return handleThreadOpen(ws, msg);
    }
  }
  return handleThreadCreate(ws, msg);
}
```

New:
```js
async function handleThreadOpenAssistant(ws, msg) {
  const state = wsState.get(ws);
  if (!state) {
    ws.send(JSON.stringify({ type: 'error', message: 'No panel set' }));
    return;
  }

  // SPEC-26b: extract scope from msg, default to 'view' for backward compat
  // with pre-26b clients that don't know about dual scopes.
  const scope = msg.scope === 'project' ? 'project' : 'view';
  const manager = state.threadManagers[scope];
  if (!manager) {
    ws.send(JSON.stringify({ type: 'error', message: `No ${scope} ThreadManager` }));
    return;
  }

  // Upsert: if msg.threadId is provided and exists in this scope's index,
  // resume it; otherwise create a new thread in this scope.
  if (msg.threadId) {
    const existing = await manager.getThread(msg.threadId);
    if (existing) {
      return handleThreadOpen(ws, msg, scope);
    }
    console.warn(
      `[ThreadWS] thread:open-assistant with unknown threadId ${msg.threadId} (scope=${scope}) — creating new`
    );
  }

  return handleThreadCreate(ws, msg, scope);
}
```

The defensive `scope === 'project' ? 'project' : 'view'` rejects invalid scope values and falls back to view. Doesn't accept arbitrary strings.

**3d. Update `handleThreadRename` (around L249-280).**

Current:
```js
async function handleThreadRename(ws, msg) {
  const state = wsState.get(ws);
  if (!state) { /* error */ return; }

  const { threadId, name } = msg;

  try {
    const result = await state.threadManager.renameThread(threadId, name);
    // ... etc
  }
}
```

New:
```js
async function handleThreadRename(ws, msg) {
  const state = wsState.get(ws);
  if (!state) { /* error */ return; }

  const scope = msg.scope === 'project' ? 'project' : 'view';
  const manager = state.threadManagers[scope];
  if (!manager) {
    ws.send(JSON.stringify({ type: 'error', message: `No ${scope} ThreadManager` }));
    return;
  }

  const { threadId, name } = msg;

  try {
    const result = await manager.renameThread(threadId, name);
    if (!result) {
      ws.send(JSON.stringify({ type: 'error', message: `Thread not found: ${threadId}` }));
      return;
    }

    ws.send(JSON.stringify({
      type: 'thread:renamed',
      threadId,
      scope,
      name,
    }));

    await sendThreadList(ws, scope);
  } catch (err) {
    console.error('[ThreadWS] Rename failed:', err);
    ws.send(JSON.stringify({ type: 'error', message: err.message }));
  }
}
```

**3e. Update `handleThreadDelete` (around L286-320).**

Current pattern is the same — extract scope, route to the right manager, echo scope in the response.

Apply the same pattern:
```js
async function handleThreadDelete(ws, msg) {
  const state = wsState.get(ws);
  if (!state) { /* error */ return; }

  const scope = msg.scope === 'project' ? 'project' : 'view';
  const manager = state.threadManagers[scope];
  if (!manager) { /* error */ return; }

  const { threadId } = msg;

  // If deleting the currently-active thread for THIS scope, close it first.
  if (state.threadIds[scope] === threadId) {
    await closeThread(ws, scope);
    state.threadIds[scope] = null;
  }

  try {
    const deleted = await manager.deleteThread(threadId);
    if (!deleted) {
      ws.send(JSON.stringify({ type: 'error', message: `Thread not found: ${threadId}` }));
      return;
    }

    ws.send(JSON.stringify({
      type: 'thread:deleted',
      threadId,
      scope,
    }));

    await sendThreadList(ws, scope);
  } catch (err) {
    console.error('[ThreadWS] Delete failed:', err);
    ws.send(JSON.stringify({ type: 'error', message: err.message }));
  }
}
```

**3f. Update `handleThreadCopyLink` (around L327-355).**

Same pattern:
```js
async function handleThreadCopyLink(ws, msg) {
  const state = wsState.get(ws);
  if (!state) { /* error */ return; }

  const scope = msg.scope === 'project' ? 'project' : 'view';
  const manager = state.threadManagers[scope];
  if (!manager) { /* error */ return; }

  const { threadId } = msg;

  try {
    const thread = await manager.getThread(threadId);
    if (!thread) {
      ws.send(JSON.stringify({ type: 'error', message: `Thread not found: ${threadId}` }));
      return;
    }

    ws.send(JSON.stringify({
      type: 'thread:link',
      threadId,
      scope,
      filePath: thread.filePath,
    }));
  } catch (err) {
    console.error('[ThreadWS] Copy link failed:', err);
    ws.send(JSON.stringify({ type: 'error', message: err.message }));
  }
}
```

**3g. Verify no remaining references to `state.threadManager` or `state.threadId` (singular).**

```bash
grep -n "state\.threadManager\b\|state\.threadId\b" lib/thread/thread-crud.js
# Expected: zero hits (the new code uses state.threadManagers[scope] and state.threadIds[scope])
```

---

### 4. `open-robin-server/lib/thread/thread-messages.js`

Smaller file with two access sites (L24, L64). Both currently check `state.threadId` and use `state.threadManager`. Update to scope-aware.

For message handlers, scope comes from the active thread context. The simplest convention: if the user is sending a `prompt` or `message:send`, the message is going to the wire that's currently active. The wire is associated with one thread, which is in one scope. So:

**4a. Update `handleMessageSend`:**

```js
async function handleMessageSend(ws, msg) {
  const state = wsState.get(ws);
  if (!state) {
    ws.send(JSON.stringify({ type: 'error', message: 'No panel set' }));
    return;
  }

  // SPEC-26b: scope comes from the message; default 'view' for backward compat.
  // The currently active thread for that scope is the target.
  const scope = msg.scope === 'project' ? 'project' : 'view';
  const threadId = state.threadIds[scope];
  if (!threadId) {
    ws.send(JSON.stringify({ type: 'error', message: `No active ${scope} thread` }));
    return;
  }

  const manager = state.threadManagers[scope];
  const { content } = msg;

  try {
    await manager.addMessage(threadId, {
      role: 'user',
      content,
      hasToolCalls: false,
    });

    await manager.index.touch(threadId);

    ws.send(JSON.stringify({
      type: 'message:sent',
      threadId,
      scope,
      content,
    }));
  } catch (err) {
    console.error('[ThreadWS] Send message failed:', err);
    ws.send(JSON.stringify({ type: 'error', message: err.message }));
  }
}
```

**4b. Update `addAssistantMessage`:**

```js
async function addAssistantMessage(ws, content, hasToolCalls = false, metadata = null, scope = 'view') {
  const state = wsState.get(ws);
  if (!state) return;

  const threadId = state.threadIds[scope];
  if (!threadId) return;

  const manager = state.threadManagers[scope];
  const message = {
    role: 'assistant',
    content,
    hasToolCalls,
  };

  if (metadata && Object.keys(metadata).length > 0) {
    await manager.addMessageWithMetadata(threadId, message, metadata);
  } else {
    await manager.addMessage(threadId, message);
  }
}
```

This adds an optional `scope` parameter (default 'view'). Callers (the wire-broadcaster, mostly) need to pass scope. For 26b's backward-compat mode, leaving it as 'view' is correct because the single-wire still binds to one thread which is most often a view thread.

**Caveat:** if you find that `addAssistantMessage` is called from a place that doesn't know the scope, that's a real issue — the wire-broadcaster needs to track which scope the wire belongs to. Investigate when you reach that point. The simplest fix: stash `scope` on the wire object or in a wire-id-to-scope map.

---

### 5. `open-robin-server/lib/ws/client-message-router.js`

The router only needs minor updates because the handlers in thread-crud.js do most of the routing internally.

**5a. The thread:open-assistant handler block (around L97-130 post-24f).**

The handler reads scope from clientMsg and uses it to update session state correctly. Today's block:
```js
if (clientMsg.type === 'thread:open-assistant') {
  // ... close current wire if any ...
  await ThreadWebSocketHandler.handleThreadOpenAssistant(ws, clientMsg);
  const state = ThreadWebSocketHandler.getState(ws);
  const threadId = state?.threadId;
  // ... spawn wire ...
  session.currentThreadId = threadId;
  session.wire = wire;
  // ...
}
```

Update to read the scope and use the new state shape:
```js
if (clientMsg.type === 'thread:open-assistant') {
  const scope = clientMsg.scope === 'project' ? 'project' : 'view';

  // Close any currently-active wire (single-wire model in 26b — see SPEC).
  if (session.wire) {
    session.wire.kill('SIGTERM');
    session.wire = null;
  }

  await ThreadWebSocketHandler.handleThreadOpenAssistant(ws, clientMsg);

  const state = ThreadWebSocketHandler.getState(ws);
  const threadId = state?.threadIds?.[scope];
  if (!threadId) {
    console.error(`[WS] No threadId for scope=${scope} after handleThreadOpenAssistant`);
    return;
  }

  console.log(`[WS] Spawning wire for ${scope} thread:`, threadId);
  session.currentThreadId = threadId;
  session.currentScope = scope;  // SPEC-26b: track which scope owns the active wire
  const wire = spawnThreadWire(threadId, projectRoot);
  session.wire = wire;
  registerWire(threadId, wire, projectRoot, ws);

  await awaitHarnessReady(wire);
  setupWireHandlers(wire, threadId);
  session.wire = wire;
  initializeWire(wire);

  ws.send(JSON.stringify({ type: 'wire_ready', threadId, scope }));

  const manager = state?.threadManagers?.[scope];
  if (manager) {
    await manager.openSession(threadId, wire, ws);
  }
  return;
}
```

Key additions:
- Extract `scope` early and use it consistently
- Read `state.threadIds[scope]` instead of `state.threadId`
- Read `state.threadManagers[scope]` instead of `state.threadManager`
- Stash `scope` on `session.currentScope` so other code paths (like `prompt`) can route to the right wire/manager
- Echo `scope` in the `wire_ready` response

**5b. The thread:rename / thread:delete / thread:copyLink / thread:list handlers don't need router-level changes** because they delegate to the crud handlers, which now extract scope from `clientMsg`. Just verify the cases don't read `state.threadId` directly.

**5c. The `prompt` handler (around L301-355) needs scope awareness if it reads thread state.**

Look at the current `prompt` case:
```js
if (clientMsg.type === 'prompt') {
  const threadId = clientMsg.threadId;
  const wire = threadId ? getWireForThread(threadId) : session.wire;
  // ...
  const threadState = ThreadWebSocketHandler.getState(ws);
  if (!threadState?.threadId && threadId) {
    // ...
    if (state) state.threadId = threadId;
  }
  // ...
}
```

Update:
```js
if (clientMsg.type === 'prompt') {
  const scope = clientMsg.scope === 'project' ? 'project' : (session.currentScope || 'view');
  const threadId = clientMsg.threadId;
  const wire = threadId ? getWireForThread(threadId) : session.wire;
  // ...
  const threadState = ThreadWebSocketHandler.getState(ws);
  if (threadState && threadId && !threadState.threadIds?.[scope]) {
    // Set the current thread for this scope
    threadState.threadIds[scope] = threadId;
  }
  // ...
}
```

**5d. Verify no other references to `state.threadId` (singular) in client-message-router.js.**

```bash
grep -n "threadState\.threadId\b\|state\.threadId\b" lib/ws/client-message-router.js
# Expected: zero hits after edits
```

---

### 6. `open-robin-server/test/smoke-spec03-spec15.js`

The smoke test asserts `ThreadWebSocketHandler` exports including `_getThreadManagers`. After 26b that helper is split into two (`_getProjectThreadManagers` and `_getViewThreadManagers`).

**6a. Update the EXPECTED_EXPORTS list (around L54-62).**

Find:
```js
const EXPECTED_EXPORTS = [
  'setPanel', 'getState', 'cleanup',
  'sendThreadList',
  'handleThreadOpenAssistant',
  'handleThreadRename', 'handleThreadDelete', 'handleThreadCopyLink',
  'handleMessageSend', 'addAssistantMessage',
  'getCurrentThreadId', 'getCurrentThreadManager',
  '_getThreadManagers', '_getWsState'
];
```

Replace `_getThreadManagers` with the two new accessors:
```js
const EXPECTED_EXPORTS = [
  'setPanel', 'getState', 'cleanup',
  'sendThreadList',
  'handleThreadOpenAssistant',
  'handleThreadRename', 'handleThreadDelete', 'handleThreadCopyLink',
  'handleMessageSend', 'addAssistantMessage',
  'getCurrentThreadId', 'getCurrentThreadManager',
  '_getProjectThreadManagers', '_getViewThreadManagers', '_getWsState'
];
```

---

### 7. Pre-prod wipe before running

```bash
# Kill the server
pkill -9 -f "node.*server.js" 2>/dev/null; sleep 1

# Wipe SQLite threads
sqlite3 /Users/rccurtrightjr./projects/open-robin/ai/system/robin.db "PRAGMA foreign_keys=ON; DELETE FROM threads;"

# Wipe both filesystem locations
find /Users/rccurtrightjr./projects/open-robin/ai/views/chat/threads -type f -name '*.md' -delete 2>/dev/null
find /Users/rccurtrightjr./projects/open-robin/ai/views/*/chat/threads -type f -name '*.md' -delete 2>/dev/null

# Verify clean
sqlite3 /Users/rccurtrightjr./projects/open-robin/ai/system/robin.db "SELECT COUNT(*) FROM threads; SELECT COUNT(*) FROM exchanges WHERE thread_id NOT IN (SELECT thread_id FROM threads);"
# Expected: 0 / 0
```

Note the `PRAGMA foreign_keys=ON;` prefix on the SQLite CLI command — this is the lesson learned from the orphan accumulation. CLI sessions need foreign_keys enabled explicitly or cascade deletes won't fire.

---

## Test plan

### Static checks

```bash
cd /Users/rccurtrightjr./projects/open-robin/open-robin-server

# Modules load
node -e "require('./lib/thread/ThreadManager')"
node -e "require('./lib/thread/ThreadWebSocketHandler')"
node -e "require('./lib/thread/thread-crud')"
node -e "require('./lib/thread/thread-messages')"
node -e "require('./lib/ws/client-message-router')"
node -e "require('./lib/thread')"
# Expected: no errors

# ThreadManager constructor enforces config object
node -e "
const { ThreadManager } = require('./lib/thread/ThreadManager');
try { new ThreadManager({ scope: 'view', viewId: 'code-viewer', projectRoot: '/tmp/fake' }); console.log('PASS: view scope'); } catch (e) { console.log('FAIL view scope:', e.message); }
try { new ThreadManager({ scope: 'project', projectRoot: '/tmp/fake' }); console.log('PASS: project scope'); } catch (e) { console.log('FAIL project scope:', e.message); }
try { new ThreadManager({ scope: 'project' }); console.log('FAIL: missing projectRoot accepted'); } catch (e) { console.log('PASS: missing projectRoot rejected'); }
try { new ThreadManager({ scope: 'bogus', projectRoot: '/tmp/fake' }); console.log('FAIL: bogus scope accepted'); } catch (e) { console.log('PASS: bogus scope rejected'); }
try { new ThreadManager({ scope: 'view', projectRoot: '/tmp/fake' }); console.log('FAIL: missing viewId accepted'); } catch (e) { console.log('PASS: missing viewId rejected for view scope'); }
try { new ThreadManager('panel-id', { projectRoot: '/tmp/fake' }); console.log('FAIL: old positional signature accepted'); } catch (e) { console.log('PASS: old positional signature rejected'); }
"
# Expected: all PASS

# _getViewsDir branches by scope
node -e "
const { ThreadManager } = require('./lib/thread/ThreadManager');
const projectMgr = new ThreadManager({ scope: 'project', projectRoot: '/tmp/fakeproject' });
const viewMgr = new ThreadManager({ scope: 'view', viewId: 'code-viewer', projectRoot: '/tmp/fakeproject' });
const projectPath = projectMgr._getViewsDir();
const viewPath = viewMgr._getViewsDir();
console.log('project path:', projectPath);
console.log('view path:', viewPath);
const projectOK = projectPath.includes('/ai/views/chat/threads/');
const viewOK = viewPath.includes('/ai/views/code-viewer/chat/threads/');
console.log('project unified path:', projectOK ? 'PASS' : 'FAIL');
console.log('view per-panel path:', viewOK ? 'PASS' : 'FAIL');
console.log('paths differ:', projectPath !== viewPath ? 'PASS' : 'FAIL');
"
# Expected: all PASS

# Stale single-thread access patterns are gone
grep -rn "state\.threadManager\b\|state\.threadId\b" lib/thread lib/ws server.js
# Expected: zero hits (all converted to state.threadManagers[scope] / state.threadIds[scope])

# Smoke test
node test/smoke-spec03-spec15.js
# Expected: 47 passed, 0 failed (after the EXPECTED_EXPORTS update in step 6)
```

### Server boot

```bash
node server.js > /tmp/26b-boot.log 2>&1 &
sleep 4
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3001/
echo "---"
grep -iE "error|exception|cannot find|ThreadManager" /tmp/26b-boot.log | head -20
```

Expected: `HTTP 200`, no errors, trigger/filter loading unchanged from prior phases.

### Live validation via test script

Since the client doesn't speak `scope` yet, we use a Node script to exercise both scopes via raw WebSocket. Save this as `/tmp/26b-validate.mjs`:

```js
#!/usr/bin/env node
// SPEC-26b validation — exercise project and view scopes via raw WS.
// Run with: node /tmp/26b-validate.mjs

import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:3001');

let receivedMessages = [];

ws.on('open', async () => {
  console.log('[validate] Connected');

  // Helper: send a message and wait for a specific response type
  const send = (msg) => {
    console.log('[validate] →', JSON.stringify(msg));
    ws.send(JSON.stringify(msg));
  };

  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  // 1. set_panel to code-viewer (sets up both ThreadManagers per the new setPanel)
  send({ type: 'set_panel', panel: 'code-viewer' });
  await wait(500);

  // 2. Create a VIEW thread (default scope)
  send({ type: 'thread:open-assistant', harnessId: 'kimi' });
  await wait(2000);

  // 3. Create a PROJECT thread (explicit scope)
  send({ type: 'thread:open-assistant', scope: 'project', harnessId: 'kimi' });
  await wait(2000);

  // 4. Request both thread lists
  send({ type: 'thread:list', scope: 'view' });
  await wait(500);
  send({ type: 'thread:list', scope: 'project' });
  await wait(500);

  console.log('[validate] Done — closing connection');
  ws.close();
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  receivedMessages.push(msg);
  if (msg.type === 'thread:list') {
    console.log(`[validate] ← thread:list scope=${msg.scope || '(none)'} count=${msg.threads?.length || 0}`);
  } else if (msg.type === 'thread:created' || msg.type === 'thread:opened') {
    console.log(`[validate] ← ${msg.type} threadId=${msg.threadId} scope=${msg.scope || '(none)'}`);
  } else if (msg.type === 'wire_ready') {
    console.log(`[validate] ← wire_ready threadId=${msg.threadId} scope=${msg.scope || '(none)'}`);
  } else if (msg.type === 'error') {
    console.log(`[validate] ← ERROR: ${msg.message}`);
  }
});

ws.on('close', () => {
  console.log('[validate] Disconnected');
  console.log(`[validate] Total messages received: ${receivedMessages.length}`);
});
```

Run it:
```bash
cd /Users/rccurtrightjr./projects/open-robin/open-robin-server
node /tmp/26b-validate.mjs
```

Expected output: connect → set_panel → create view thread (`thread:created` / `thread:opened` / `wire_ready` with `scope=view`) → create project thread (same response types with `scope=project`) → two thread:list responses, one per scope.

### Post-validation audit

```bash
# Two thread rows, one per scope
sqlite3 /Users/rccurtrightjr./projects/open-robin/ai/system/robin.db \
  "SELECT thread_id, project_id, scope, view_id, message_count FROM threads ORDER BY scope;"
```

Expected:
- Row 1: `scope='project'`, `view_id=NULL`, `project_id='open-robin'`
- Row 2: `scope='view'`, `view_id='code-viewer'`, `project_id='open-robin'`

```bash
# Project thread file in the unified location
find /Users/rccurtrightjr./projects/open-robin/ai/views/chat -type f -name '*.md'

# View thread file in the per-view location
find /Users/rccurtrightjr./projects/open-robin/ai/views/code-viewer/chat -type f -name '*.md' 2>/dev/null
```

Expected:
- One file under `ai/views/chat/threads/<user>/` (the project thread)
- One file under `ai/views/code-viewer/chat/threads/<user>/` (the view thread)

```bash
# No orphans
sqlite3 /Users/rccurtrightjr./projects/open-robin/ai/system/robin.db \
  "PRAGMA foreign_keys=ON; SELECT COUNT(*) FROM exchanges WHERE thread_id NOT IN (SELECT thread_id FROM threads);"
```

Expected: 0

### What breaks if you get it wrong

| Failure | Root cause | Fix |
|---|---|---|
| Server boot crash: `Cannot read properties of undefined (reading 'view')` | A handler still reads `state.threadManager` (singular) | Re-grep, find the offender, update to scope-aware access |
| Test script gets `error: No view ThreadManager` after set_panel | `setPanel` didn't populate `threadManagers.view` | Check the new setPanel implementation |
| Project thread file lands in `<view>/chat/threads/` instead of unified | `_getViewsDir()` not branching correctly, OR ThreadManager constructed with wrong scope | Verify the project ThreadManager has `scope='project'` and `_getViewsDir()` returns the unified path |
| View thread file lands in unified path | Same issue, wrong scope | Verify the view ThreadManager has `scope='view'` and `viewId` set correctly |
| Test script's project thread:list returns view threads | The list query is using stale scope filter | Check `ThreadIndex.list()` is filtering by `this.scope` correctly (was already correct in 26a, double-check) |
| Existing client (no scope field) can't create threads | Backward-compat default broke | Verify `handleThreadOpenAssistant` defaults to `'view'` when `scope` is missing |
| `wire_ready` echoes wrong scope | `client-message-router.js` thread:open-assistant case extracted scope incorrectly | Check the scope extraction at the top of that case |
| Cleanup leaves wsState behind | `cleanup` doesn't iterate both scopes | Update cleanup to close both project and view threads |
| Smoke test fails on `_getThreadManagers not in exports` | EXPECTED_EXPORTS still references the old single export | Update step 6 |

---

## Do not do

- **Do not** spawn two wires per connection. The single-wire model stays in 26b. The wire follows the most recently activated thread (which might be a project thread or a view thread). 26d adds dual-wire.
- **Do not** touch the client at all. Wire protocol additions are transparent to existing clients via the backward-compat defaults.
- **Do not** change `ChatFile.js` — its constructor signature `{ viewsDir, threadId }` is unchanged. ThreadManager._getViewsDir() resolves the path; ChatFile takes it already-resolved.
- **Do not** change `ThreadIndex.js` — fully done in 26a.
- **Do not** add a `scope` column to any other table. The change is `threads`-only (already done in 26a).
- **Do not** create scaffolding for the per-view chat dirs. ChatFile's `ensureDir()` does `mkdir -p` on first write. The per-view `<view>/chat/` capability marker is enough as a parent dir.
- **Do not** delete the unified `ai/views/chat/threads/<user>/` directory after switching project threads to write there. It's the home for project-scoped threads.
- **Do not** break the smoke test. The EXPECTED_EXPORTS update in step 6 keeps it green.
- **Do not** add any new wire protocol message types beyond the optional `scope` field. The set of messages is the same as today.
- **Do not** rename `panelId` references in code that serves identification purposes (like the per-view chat folder marker check in `views.resolveChatConfig`). Only the ThreadManager's internal field gets renamed to `viewId`.
- **Do not** touch `views.resolveChatConfig` — it still returns the per-view UI settings (chatType, chatPosition); the storage path resolution moved entirely into ThreadManager._getViewsDir.
- **Do not** modify the migration files. No schema changes in 26b.
- **Do not** delete the test script after validating. Keep it as `/tmp/26b-validate.mjs` so the user can re-run it if anything regresses. (Or move it to a known test location and reference it from the spec.)
- **Do not** touch `lib/runner/`, `lib/frontmatter/`, `lib/views/`, or anything outside the listed files.

---

## Commit message template

```
SPEC-26b: dual-chat routing layer (server-side)

Activates the dual-scope routing on the server, building on 26a's
data model. Each WS connection now holds TWO ThreadManagers:
  - projectThreadManager (scope='project') — persistent across panel
    switches, writes to ai/views/chat/threads/<user>/
  - viewThreadManager (scope='view') — swaps on panel change, writes
    to ai/views/<view>/chat/threads/<user>/ (per-view path restored)

Wire protocol:
  - thread:open-assistant, thread:list, thread:rename, thread:delete,
    thread:copyLink all accept an optional `scope` field ('project'|
    'view'). Missing scope defaults to 'view' for backward compat.
  - All thread:* response messages echo the scope so the client can
    route them to the right sidebar (when 26c lands).

ThreadManager:
  - Constructor signature changed from (panelId, config) to
    ({scope, viewId, projectRoot, ...config}). Throws on missing
    projectRoot, invalid scope, or missing viewId for view scope.
  - _getViewsDir() branches by scope: project → unified location,
    view → per-view location.
  - this.panelId field replaced by this.viewId.

ThreadWebSocketHandler:
  - wsState shape changed: { panelId, viewName, threadIds: {project,
    view}, threadManagers: {project, view} }. Project thread state
    persists across panel switches; view thread state resets.
  - Two manager registries: projectThreadManagers (keyed by projectId)
    and viewThreadManagers (keyed by `${projectId}:${viewId}`).
  - getProjectThreadManager(projectRoot) and getViewThreadManager(
    viewId, projectRoot) factories. Both lazily instantiate and init.
  - setPanel populates both managers (project: get-or-create, view:
    always replace).
  - closeCurrentThread(ws) renamed to closeThread(ws, scope).
  - sendThreadList(ws, scope), getCurrentThreadId(ws, scope),
    getCurrentThreadManager(ws, scope) all gain a scope arg with
    'view' as default for backward compat.
  - cleanup(ws) closes both project and view threads.

thread-crud.js handlers:
  - handleThreadOpenAssistant routes to the right manager via
    state.threadManagers[scope].
  - handleThreadCreate, handleThreadOpen take a scope parameter.
  - handleThreadRename, handleThreadDelete, handleThreadCopyLink
    extract scope from the message and route accordingly.
  - All thread:* response messages echo scope.

thread-messages.js handlers:
  - handleMessageSend extracts scope from msg, routes to the right
    manager and threadId.
  - addAssistantMessage takes optional scope parameter.

client-message-router.js:
  - thread:open-assistant case extracts scope, uses scope-aware
    state access, stashes scope on session.currentScope so the
    prompt handler can route correctly.
  - prompt handler reads session.currentScope as fallback for the
    scope to use when reading thread state.
  - wire_ready response echoes scope.

Single-wire model preserved: a WS connection still has one wire at
a time. Opening a thread of either scope kills the old wire. Real
dual-wire support is deferred to 26d.

smoke test:
  - EXPECTED_EXPORTS updated: _getThreadManagers split into
    _getProjectThreadManagers and _getViewThreadManagers.

Pre-prod wipe: existing thread rows deleted, both filesystem
locations wiped before validation.

Live-validated via /tmp/26b-validate.mjs (raw WS test script):
  - Creates one view thread → lands in
    ai/views/code-viewer/chat/threads/<user>/<id>.md
    with scope='view', view_id='code-viewer' in SQLite
  - Creates one project thread → lands in
    ai/views/chat/threads/<user>/<id>.md
    with scope='project', view_id=NULL in SQLite
  - Both thread lists requestable via thread:list with scope field
  - Cascade health: 0 orphans after activity

Existing client behavior preserved: pre-26b clients send no scope
field, server defaults to view scope, behavior identical to post-24f.

Part of SPEC-26 (dual-chat paradigm). Unblocks 26c (client state +
5-column layout) and 26d (dual wire support + chat header per side).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

## Report back

1. **Diff stats.** `git diff --stat main`. Expected: ThreadManager (~50 lines net), ThreadWebSocketHandler (~80 lines net), thread-crud.js (~80 lines net), thread-messages.js (~10 lines net), client-message-router.js (~20 lines net), smoke test (~3 lines net). No new files except possibly the test script.

2. **Static check output.** Every node-e and grep result. All must PASS / zero hits where expected.

3. **Server boot output.** First 60 lines of the boot log. Expected: clean boot, no errors, trigger/filter loading unchanged.

4. **Test script output.** Paste the full output of `/tmp/26b-validate.mjs`. Expected:
   - `[validate] Connected`
   - `set_panel` sent
   - `thread:open-assistant` sent (no scope)
   - `← thread:created` and `← thread:opened` and `← wire_ready`, all with `scope=view`
   - `thread:open-assistant` sent (`scope=project`)
   - Same response types with `scope=project`
   - Two `thread:list` responses, one per scope

5. **Post-validation SQLite + filesystem audit.** The two `find` outputs and the `SELECT thread_id, project_id, scope, view_id, message_count FROM threads` result.

6. **Surprises.**
   - Were there `state.threadManager` / `state.threadId` access sites in files outside the listed ones?
   - Did the message_count field update correctly for both scopes?
   - Did the wire spawn flow handle the project scope cleanly, or did anything assume view scope?
   - Did the rename / delete / copyLink path work the same for project threads as view threads?

7. **Files touched outside the change list.** Should be zero except possibly the smoke test (listed) and the test script (also listed).

8. **26c signals.** While editing, note things that will need to change in 26c when the client gets dual-chat awareness:
   - panelStore shape (where do project threads vs view threads live?)
   - thread-handlers.ts in the client — needs to dispatch by scope
   - Sidebar.tsx — becomes two components or gets a scope prop?
   - ChatArea.tsx — same question
   - The wire_ready / thread:opened response handling — does the client need to know which scope's overlay to clear?

Hand the report back to the orchestrator.
