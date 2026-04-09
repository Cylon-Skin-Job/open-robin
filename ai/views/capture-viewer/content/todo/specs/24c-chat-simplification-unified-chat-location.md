# SPEC-24c — Chat Simplification: Unified Chat Storage Location

**Parent:** SPEC-24 (chat simplification)
**Position:** Phase 3 of 6. Depends on SPEC-24a, SPEC-25, SPEC-24b, SPEC-24d, SPEC-24e all merged. Unblocks SPEC-24f (deep code sweep).
**Depends on:**
- SPEC-24a (timestamp thread IDs)
- SPEC-25 (frontmatter extraction)
- SPEC-24b (ChatFile rewrite with `{ viewsDir, threadId }` constructor)
- SPEC-24d (legacy strategies + auto-rename deleted)
- SPEC-24e (display fallback — not strictly required but already landed)
**Model recommendation:** **Sonnet 4.6** is sufficient. This is a focused refactor — 6 files, clear signature changes, zero new code. The only risk is a cache-invalidation subtlety in `getThreadManager`.
**Estimated blast radius:** **Medium.** Changes a wire-protocol-adjacent setup path (`setPanel` signature shrinks by one field), changes the filesystem layout for chat storage, and simplifies `ThreadManager`'s per-panel cache key. Pre-prod wipe required, per parent spec.

---

## Your mission

Relocate thread markdown files from per-panel storage at
`ai/views/<panel>/chat/threads/<user>/<threadId>.md`
to a unified location at
`ai/views/chat/threads/<user>/<threadId>.md`.

**Why:** Collaboration. Partner/co-worker workflows push/pull chat histories via git. With unified storage, one directory per user contains all of that user's chats across every panel. Without it, a git pull has to reach into every `<panel>/chat/threads/<user>/` folder individually.

**What actually changes:**
1. `ThreadManager._getViewsDir()` returns the unified path — always the same for every panel.
2. `ThreadManager` constructor stops accepting `panelPath` (no longer needed; path is derived from `projectRoot` alone).
3. `ThreadWebSocketHandler.setPanel()` signature drops `panelPath`.
4. `ThreadWebSocketHandler.getThreadManager()` cache check simplifies to panelId-only (no more panelPath comparison for invalidation).
5. `views.resolveChatConfig()` stops returning `chatPath` in its result. It still checks `view.content.chat` AND filesystem existence of `<panel>/chat/` as the capability gate.
6. Two call sites update to drop `panelPath` from their `setPanel` invocations: `server.js` and `lib/ws/client-message-router.js`.

**What stays:**
- Per-panel `<view>/chat/` folders remain on disk as the "this panel has chat" filesystem marker. They stay empty (or just contain the `settings/` scaffold) but their existence still gates the feature.
- Per-panel `<view>/chat/settings/` scaffold folders stay untouched.
- `content.chat` in each view's content.json still holds `chatType` and `chatPosition`. Those are per-panel UI settings, not storage paths.
- SQLite `panel_id` column on `threads` is the sole scoping mechanism. The sidebar in each panel reads `ThreadIndex.list()` filtered by its panel's id, which has nothing to do with filesystem layout.
- Client code: **zero changes**. The client never sees server-side filesystem paths. It interacts with threads via the wire protocol (`thread:open-assistant`, `thread:list`, etc.) and the SQLite-backed responses.
- Agents-viewer / agent-prefixed panelIds — they get unified storage along with everything else. The old special-case path derivation in `_getViewsDir()` goes away with the rest of the panelPath logic.

**Pre-prod wipe required.** Existing thread files under every `ai/views/<panel>/chat/threads/` directory must be deleted during validation. Per parent SPEC-24, these are disposable test data. SQLite `threads` table also wiped. No migration of old files to the new location — we start fresh.

**You are not touching:**
- Client code (not a single line)
- SQLite schema (no column changes; `panel_id` stays as the scoping key)
- `lib/frontmatter/` (unchanged)
- `ChatFile.js` (SPEC-24b is the authority there — its constructor signature `{ viewsDir, threadId }` is what we feed, and we just change what `viewsDir` resolves to)
- `content.chat` parsing in content.json loading
- The per-panel `<view>/chat/` folders themselves (they stay as capability markers)
- The drag-to-deploy modal / no-code-panel-creation flow
- Any filesystem watcher subscriptions
- `lib/runner/index.js` (still not touching it; the persona-wire notify block stays dormant for 24f)

---

## Context before you touch code

Read these in order:

1. **`ai/views/wiki-viewer/content/enforcement/code-standards/PAGE.md`** — house rules. Re-read "delete don't deprecate" and "no premature abstractions".
2. **`ai/views/capture-viewer/content/todo/specs/24-chat-simplification.md`** — parent spec for the 24x series.
3. **`open-robin-server/lib/thread/ThreadManager.js`** — read the constructor (L22-48) and `_getViewsDir()` (L53-63). These are the two functions you'll edit in this file.
4. **`open-robin-server/lib/thread/ThreadWebSocketHandler.js`** — read `getThreadManager()` (L29-49) and `setPanel()` (L51-74). Both get their signatures trimmed.
5. **`open-robin-server/lib/views/index.js`** — read `resolveChatConfig()` (L160-180). You'll drop `chatPath` from its return.
6. **`open-robin-server/server.js`** — read L283-296 (the initial `setPanel` call on connection).
7. **`open-robin-server/lib/ws/client-message-router.js`** — read L181-221 (the `set_panel` message handler).

### Line-number drift verification

```bash
cd open-robin-server

wc -l lib/thread/ThreadManager.js lib/thread/ThreadWebSocketHandler.js \
      lib/views/index.js lib/ws/client-message-router.js server.js
```

Expected (±3 lines):
- `ThreadManager.js` ≈ 370
- `ThreadWebSocketHandler.js` ≈ 190
- `lib/views/index.js` ≈ 200
- `client-message-router.js` ≈ 470
- `server.js` ≈ 395

Grep for every touchpoint:

```bash
grep -rn "panelPath\|chatPath\|resolveChatConfig" lib server.js
```

Expected hits (± doc comments):
- `ThreadManager.js:25,32,56,57,58` — constructor param, field, usage in `_getViewsDir`
- `ThreadWebSocketHandler.js:31,33,38,55` — doc comments + the cache invalidation check
- `lib/views/index.js:166,168,172,173,176` — signature, return type, variable, check, return value
- `server.js:287,288,290,292` — comment + call site
- `client-message-router.js:188,191,193` — call site + comment

Reconcile drift before editing. The line numbers in the instructions below are approximate; the context around each edit is precise enough to locate them even if they've drifted by ±3-5 lines.

### Pre-flight: what's on disk right now?

```bash
find /Users/rccurtrightjr./projects/open-robin/ai/views/*/chat/threads -type f -name '*.md' 2>/dev/null
sqlite3 /Users/rccurtrightjr./projects/open-robin/ai/system/robin.db "SELECT COUNT(*) FROM threads;"
```

If either returns non-zero, there are thread files / SQLite rows from previous phases. You'll wipe them during validation.

---

## Changes — file by file

### 1. `open-robin-server/lib/thread/ThreadManager.js`

Two edits: constructor, `_getViewsDir()`.

**1a. Drop `panelPath` from the constructor (L25, L32).**

Current JSDoc (L24-28):
```js
  /**
   * @param {string} panelId - Panel identifier (e.g., 'code-viewer', 'agent:bot-name')
   * @param {object} [config]
   * @param {string} [config.panelPath] - Filesystem path for legacy ChatFile fallback
   * @param {string} [config.projectRoot] - Project root for per-user views path
```

New:
```js
  /**
   * @param {string} panelId - Panel identifier (e.g., 'code-viewer', 'agent:bot-name')
   * @param {object} [config]
   * @param {string} [config.projectRoot] - Project root — required for the unified chat storage path (SPEC-24c)
```

Current constructor body (L31-36):
```js
  constructor(panelId, config = {}) {
    this.panelId = panelId;
    this.panelPath = config.panelPath || null;
    this.projectRoot = config.projectRoot || null;
    this.config = { ...DEFAULT_CONFIG, ...config };
```

New:
```js
  constructor(panelId, config = {}) {
    this.panelId = panelId;
    this.projectRoot = config.projectRoot || null;
    this.config = { ...DEFAULT_CONFIG, ...config };
```

The `this.panelPath` field is deleted. Verify nothing else in the class reads it:
```bash
grep -n "this\.panelPath" lib/thread/ThreadManager.js
# Expected after your edit: zero hits
```

**1b. Rewrite `_getViewsDir()` (L53-63).**

Current:
```js
  _getViewsDir() {
    if (!this.projectRoot) return null;
    // Use panelPath directly if available (it's already the chat folder path)
    if (this.panelPath) {
      return path.join(this.panelPath, 'threads', getUsername());
    }
    // Fallback: derive from panelId
    const workspace = this.panelId.startsWith('agent:') ? 'agents-viewer' : this.panelId;
    return path.join(this.projectRoot, 'ai', 'views', workspace, 'chat', 'threads', getUsername());
  }
```

New:
```js
  /**
   * Build the unified per-user chat directory (SPEC-24c).
   *
   * All chats live at ai/views/chat/threads/<username>/ regardless of
   * which panel initiated them. The sidebar in each panel still scopes
   * its thread list via SQLite's panel_id column — the filesystem
   * layout is flat for collaboration-friendly git push/pull.
   *
   * Returns null if projectRoot is not set (ChatFile construction
   * will throw in that case — see _createChatFile).
   *
   * @returns {string|null}
   */
  _getViewsDir() {
    if (!this.projectRoot) return null;
    return path.join(this.projectRoot, 'ai', 'views', 'chat', 'threads', getUsername());
  }
```

Notes:
- The panelPath branch is gone.
- The `agents-viewer` special case is gone.
- The function is now trivially one line.
- The JSDoc is new — it explains the new layout and the SQLite-is-the-scoping-key relationship.

---

### 2. `open-robin-server/lib/thread/ThreadWebSocketHandler.js`

Two edits: `getThreadManager()` cache check, `setPanel()` signature.

**2a. Simplify `getThreadManager()` (L29-49).**

Current:
```js
/**
 * Get or create ThreadManager for a panel.
 * If the manager already exists but panelPath changed, replace it.
 * @param {string} panelId
 * @param {object} [config] - Config including panelPath for ChatFile
 * @returns {ThreadManager}
 */
function getThreadManager(panelId, config = {}) {
  const existing = threadManagers.get(panelId);
  if (existing && existing.panelPath === (config.panelPath || null)) {
    return existing;
  }

  const manager = new ThreadManager(panelId, config);
  threadManagers.set(panelId, manager);
  // Initialize async (don't block)
  manager.init().catch(err => {
    console.error(`[ThreadManager] Failed to init ${panelId}:`, err);
  });
  return manager;
}
```

New:
```js
/**
 * Get or create ThreadManager for a panel.
 *
 * SPEC-24c: cache is keyed purely by panelId. Chat storage is unified
 * under ai/views/chat/threads/<user>/, so there's no per-panel path to
 * vary on — the same panelId always maps to the same ThreadManager.
 *
 * @param {string} panelId
 * @param {object} [config] - Config (projectRoot required)
 * @returns {ThreadManager}
 */
function getThreadManager(panelId, config = {}) {
  const existing = threadManagers.get(panelId);
  if (existing) return existing;

  const manager = new ThreadManager(panelId, config);
  threadManagers.set(panelId, manager);
  // Initialize async (don't block)
  manager.init().catch(err => {
    console.error(`[ThreadManager] Failed to init ${panelId}:`, err);
  });
  return manager;
}
```

Key change: the `existing.panelPath === (config.panelPath || null)` comparison is gone. Any existing manager for a given panelId is reused as-is.

**Important caveat:** if a ThreadManager was created with an incomplete config (e.g. `projectRoot: null`) and a later call provides a complete config, the existing manager is still returned — it won't pick up the new `projectRoot`. This is a behavior change, but in practice every call site passes `projectRoot` from the same source (`getDefaultProjectRoot()`), so the config never legitimately changes. If your grep reveals a call site that doesn't pass `projectRoot`, flag it.

Verify:
```bash
grep -rn "ThreadWebSocketHandler\.setPanel\|setPanel(ws" lib server.js
# Check that every call passes projectRoot. Expected: server.js L291-295 area,
# client-message-router.js L192-196 area.
```

**2b. Drop `panelPath` from `setPanel()` docstring (L55).**

Current JSDoc for setPanel:
```js
/**
 * Set panel for a WebSocket connection
 * @param {import('ws').WebSocket} ws
 * @param {string} panelId - Panel identifier (e.g., 'code-viewer', 'agent:bot-name')
 * @param {object} [config] - Config including panelPath for ChatFile
 * @param {string} [config.viewName] - View name for client messages (e.g., 'code-viewer')
 */
```

New:
```js
/**
 * Set panel for a WebSocket connection.
 *
 * SPEC-24c: `config` no longer takes panelPath — chat storage is
 * unified and derived from projectRoot alone.
 *
 * @param {import('ws').WebSocket} ws
 * @param {string} panelId - Panel identifier (e.g., 'code-viewer', 'agent:bot-name')
 * @param {object} [config]
 * @param {string} [config.projectRoot] - Project root (required for thread storage)
 * @param {string} [config.viewName] - View name for client messages (e.g., 'code-viewer')
 */
```

The function body of `setPanel()` itself does not change — `config` is passed through to `getThreadManager` which passes it to `new ThreadManager()`. The fact that `panelPath` is no longer set by callers means it'll just be absent from the config object; nothing inside `setPanel` references it directly.

---

### 3. `open-robin-server/lib/views/index.js`

One function: `resolveChatConfig()`.

**3a. Drop `chatPath` from the return shape (L160-180).**

Current:
```js
/**
 * Resolve the chat folder path for a view.
 * Returns null if the view has no chat.
 *
 * @param {string} projectRoot
 * @param {string} viewId
 * @returns {{ chatPath: string, chatType: string, chatPosition: string }|null}
 */
function resolveChatConfig(projectRoot, viewId) {
  const view = loadView(projectRoot, viewId);
  if (!view || !view.content.chat) return null;

  const chatPath = path.join(view.viewRoot, 'chat');
  if (!fs.existsSync(chatPath)) return null;

  return {
    chatPath,
    chatType: view.content.chat.type,
    chatPosition: view.layout.chatPosition || view.content.chat.position,
  };
}
```

New:
```js
/**
 * Resolve chat config for a view. Returns null if the view has no chat.
 *
 * SPEC-24c: the `chatPath` return field is gone. Chat storage is unified
 * at ai/views/chat/ — callers no longer need a per-panel path. The
 * per-panel `<view>/chat/` folder still exists as the "chat enabled"
 * filesystem marker (no-code panel creation pattern), which this
 * function verifies before returning success.
 *
 * @param {string} projectRoot
 * @param {string} viewId
 * @returns {{ chatType: string, chatPosition: string }|null}
 */
function resolveChatConfig(projectRoot, viewId) {
  const view = loadView(projectRoot, viewId);
  if (!view || !view.content.chat) return null;

  // Per-panel chat/ folder is the capability marker. Storage happens
  // elsewhere (SPEC-24c), but the folder's existence still gates whether
  // this view has chat.
  const chatMarker = path.join(view.viewRoot, 'chat');
  if (!fs.existsSync(chatMarker)) return null;

  return {
    chatType: view.content.chat.type,
    chatPosition: view.layout.chatPosition || view.content.chat.position,
  };
}
```

Changes:
- The JSDoc return type drops `chatPath`.
- The local variable `chatPath` is renamed to `chatMarker` to clarify its new semantic (it's no longer a storage path; it's just a feature flag).
- The return object no longer has a `chatPath` key.
- The filesystem-existence check is preserved — don't remove it. It's the capability gate for the no-code panel creation pattern.

---

### 4. `open-robin-server/server.js`

One call site: the initial `setPanel` invocation on connection (around L283-296).

**4a. Drop `panelPath` from the initial setPanel call.**

Current:
```js
  // Set up a default panel so ThreadManager exists for wire spawning.
  // Don't send the thread list yet — wait for the client's set_panel message
  // to avoid cross-contamination (e.g., issues-viewer seeing code-viewer threads).
  // Only set up threads if the default view has chat.
  // panelId = view name ('code-viewer'), panelPath = absolute chat folder path
  const defaultChatConfig = views.resolveChatConfig(projectRoot, 'code-viewer');
  if (defaultChatConfig) {
    // panelId = view name ('code-viewer'), panelPath = full chat folder path
    ThreadWebSocketHandler.setPanel(ws, 'code-viewer', {
      panelPath: defaultChatConfig.chatPath,
      projectRoot,
      viewName: 'code-viewer',
    });
  }
```

New:
```js
  // Set up a default panel so ThreadManager exists for wire spawning.
  // Don't send the thread list yet — wait for the client's set_panel message
  // to avoid cross-contamination (e.g., issues-viewer seeing code-viewer threads).
  // Only set up threads if the default view has chat (SPEC-24c: storage is
  // unified at ai/views/chat/threads/<user>/, no panelPath needed).
  const defaultChatConfig = views.resolveChatConfig(projectRoot, 'code-viewer');
  if (defaultChatConfig) {
    ThreadWebSocketHandler.setPanel(ws, 'code-viewer', {
      projectRoot,
      viewName: 'code-viewer',
    });
  }
```

Changes:
- `panelPath: defaultChatConfig.chatPath` line deleted.
- Stale comments referencing `panelPath = absolute chat folder path` deleted.
- New comment explains the SPEC-24c rationale.

---

### 5. `open-robin-server/lib/ws/client-message-router.js`

One call site: the `set_panel` handler (around L181-221).

**5a. Drop `panelPath` from the set_panel → setPanel call.**

Current:
```js
          if (chatConfig) {
            // panelId = view name (panel), panelPath = full chat folder path
            ThreadWebSocketHandler.setPanel(ws, panel, {
              panelPath: chatConfig.chatPath,
              projectRoot,
              viewName: panel,
            });
            await ThreadWebSocketHandler.sendThreadList(ws);
          }
```

New:
```js
          if (chatConfig) {
            ThreadWebSocketHandler.setPanel(ws, panel, {
              projectRoot,
              viewName: panel,
            });
            await ThreadWebSocketHandler.sendThreadList(ws);
          }
```

Changes:
- `panelPath: chatConfig.chatPath` line deleted.
- Stale comment about `panelPath = full chat folder path` deleted.

The rest of the `set_panel` handler (the response construction with `hasChat`, `chatType`, `chatPosition`) is unaffected — those fields come from `chatConfig.chatType` / `chatConfig.chatPosition`, which still exist in the new return shape.

---

### 6. Verification: no stale references remain

After steps 1-5:

```bash
cd open-robin-server

# panelPath should be gone from all thread + ws code
grep -rn "panelPath" lib/thread lib/ws server.js
# Expected: zero hits

# chatPath should be gone from the views module and its callers
grep -rn "chatPath" lib server.js
# Expected: zero hits (the local chatMarker variable is fine — that's a
# different name)

# agents-viewer special case in thread code should be gone
grep -rn "agents-viewer" lib/thread
# Expected: zero hits (the workspace derivation line is deleted)

# Every setPanel call should NOT pass panelPath
grep -rn "setPanel(ws" lib server.js -A 5 | grep -B 1 "panelPath"
# Expected: zero hits
```

All four checks must be empty before proceeding to tests.

---

## Test plan

### Unit / static checks

```bash
cd open-robin-server

# Module loads
node -e "require('./lib/thread/ThreadManager')"
node -e "require('./lib/thread/ThreadWebSocketHandler')"
node -e "require('./lib/thread')"
node -e "require('./lib/views')"
node -e "require('./lib/ws/client-message-router')"
# All expected: no errors

# _getViewsDir returns the unified path
node -e "
const { ThreadManager } = require('./lib/thread/ThreadManager');
const mgr = new ThreadManager('test-panel', { projectRoot: '/tmp/fakeproject' });
const dir = mgr._getViewsDir();
console.log('viewsDir:', dir);
const expected = '/tmp/fakeproject/ai/views/chat/threads/';
if (dir && dir.startsWith(expected)) {
  console.log('PASS: unified path');
} else {
  console.log('FAIL: expected to start with', expected);
}
"
# Expected: PASS: unified path

# _getViewsDir ignores panelId (returns same path for different panels)
node -e "
const { ThreadManager } = require('./lib/thread/ThreadManager');
const m1 = new ThreadManager('code-viewer', { projectRoot: '/tmp/x' });
const m2 = new ThreadManager('issues-viewer', { projectRoot: '/tmp/x' });
const m3 = new ThreadManager('agent:mario', { projectRoot: '/tmp/x' });
if (m1._getViewsDir() === m2._getViewsDir() && m2._getViewsDir() === m3._getViewsDir()) {
  console.log('PASS: unified across panels');
} else {
  console.log('FAIL: paths diverged');
  console.log('code-viewer:', m1._getViewsDir());
  console.log('issues-viewer:', m2._getViewsDir());
  console.log('agent:mario:', m3._getViewsDir());
}
"
# Expected: PASS: unified across panels

# resolveChatConfig no longer returns chatPath
node -e "
const views = require('./lib/views');
const config = views.resolveChatConfig('/Users/rccurtrightjr./projects/open-robin', 'code-viewer');
if (!config) { console.log('SKIP: no chat for code-viewer (unexpected)'); process.exit(0); }
if ('chatPath' in config) {
  console.log('FAIL: chatPath still in return');
} else {
  console.log('PASS: chatPath dropped, keys:', Object.keys(config).join(', '));
}
"
# Expected: PASS: chatPath dropped, keys: chatType, chatPosition

# Smoke test
node test/smoke-spec03-spec15.js
# Expected: 47 passed, 0 failed (unchanged from SPEC-24d)
```

### Pre-prod wipe

```bash
# Kill any running server
pkill -9 -f "node.*server.js" 2>/dev/null || true
sleep 1

# Wipe SQLite threads
sqlite3 /Users/rccurtrightjr./projects/open-robin/ai/system/robin.db "DELETE FROM threads;"

# Wipe old per-panel thread files
find /Users/rccurtrightjr./projects/open-robin/ai/views/*/chat/threads -type f -name '*.md' -delete 2>/dev/null

# Also nuke any empty user-subfolders left behind
find /Users/rccurtrightjr./projects/open-robin/ai/views/*/chat/threads -mindepth 1 -type d -empty -delete 2>/dev/null

# Remove the pre-existing unified location if it has stale data from your editing
rm -rf /Users/rccurtrightjr./projects/open-robin/ai/views/chat/threads 2>/dev/null

# Verify clean slate
find /Users/rccurtrightjr./projects/open-robin/ai/views -path '*/chat/threads/*' -name '*.md' 2>/dev/null
sqlite3 /Users/rccurtrightjr./projects/open-robin/ai/system/robin.db "SELECT COUNT(*) FROM threads;"
# Expected: no files, count = 0
```

### Live validation

1. **Start the server.**
   ```bash
   cd open-robin-server && node server.js > /tmp/24c-boot.log 2>&1 &
   sleep 4
   curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3001/
   ```
   Expected: `HTTP 200`, no errors, trigger/filter counts unchanged from prior phases.

2. **Create a new thread via the UI** on any chat-enabled panel (code-viewer, issues-viewer, etc.).

3. **Verify the file lands in the new unified location.**
   ```bash
   find /Users/rccurtrightjr./projects/open-robin/ai/views/chat/threads -type f -name '*.md' 2>/dev/null
   ```
   Expected: one file, with a path like
   `/Users/rccurtrightjr./projects/open-robin/ai/views/chat/threads/<username>/2026-04-09T14-30-22-123.md`

4. **Verify NO file was created in the old per-panel location.**
   ```bash
   find /Users/rccurtrightjr./projects/open-robin/ai/views/*/chat/threads -type f -name '*.md' 2>/dev/null
   ```
   Expected: zero files. The old locations remain empty.

5. **Create a second thread from a DIFFERENT panel.** Switch panels, create another thread. Verify:
   - Both files land in the same `ai/views/chat/threads/<user>/` directory.
   - The sidebars for each panel still show only their own threads (SQLite-backed scoping still works).
   - Switching panels doesn't cross-contaminate the thread lists.

6. **Rename and delete** one of the threads. Verify:
   - Rename updates SQLite + frontmatter, file stays in the unified location, filename unchanged.
   - Delete removes the file from the unified location and the row from SQLite.

7. **Resume an existing thread.** Click a thread in the sidebar after creating it. Verify:
   - `thread:open-assistant` fires with `threadId`
   - Server returns `thread:opened` + `wire_ready`
   - History loads correctly from the unified location
   - No parse errors in the console

8. **Check the full boot log for errors.**
   ```bash
   grep -iE "error|exception|cannot find|panelPath" /tmp/24c-boot.log
   # Expected: zero hits
   ```

### What breaks if you get it wrong

| Failure | Root cause | Fix |
|---|---|---|
| Server boot crash: `Cannot read properties of undefined (reading 'chatPath')` | Missed a caller that still references `chatConfig.chatPath` | grep for `chatPath` and fix |
| Thread creation throws: `ChatFile: both viewsDir and threadId are required` | `_getViewsDir()` returned null because `projectRoot` wasn't passed | Check the setPanel call chain — projectRoot must come through |
| Files land in `ai/views/<panel>/chat/threads/` instead of unified | `_getViewsDir()` fallback branch not deleted | Re-check step 1b |
| Switching panels shows wrong thread list | `getThreadManager` cache is returning a stale manager | Check that the cache key is still panelId-based and ThreadManager's `panelId` is set in the constructor |
| Agent threads write to a different path | The `startsWith('agent:')` special case wasn't deleted | Re-check step 1b |
| `setPanel` called with `panelPath` anyway (harmless but dead) | Missed a call site | grep `setPanel.*panelPath` — should be zero |
| Two panels with chat suddenly share thread lists | `ThreadIndex.list()` filtering broken, OR the per-panel panel_id column got corrupted | This shouldn't happen — the filtering is SQLite-side, unchanged. Investigate the DB. |
| Existing per-panel `<view>/chat/` folder accidentally deleted | Over-aggressive cleanup | Restore it — the folder is still the capability marker |

---

## Do not do

- **Do not** delete the per-panel `<view>/chat/` folders. They stay as filesystem capability markers.
- **Do not** delete the per-panel `<view>/chat/settings/` subfolders either. They're scaffold storage and out of 24c scope.
- **Do not** modify SQLite schema. The `panel_id` column stays as the sole scoping key. No migration in this spec.
- **Do not** touch `content.chat` parsing in content.json. `chatType` and `chatPosition` are per-panel UI settings, unrelated to storage.
- **Do not** migrate old thread files from their per-panel locations to the unified location. Pre-prod wipe is the parent-spec directive.
- **Do not** touch the client. Not a single line. The client never sees server paths.
- **Do not** add a reconciliation pass that syncs git-pulled chat files back into SQLite. That's a future feature explicitly deferred per the sync-direction discussion.
- **Do not** rename the `formatThreadDisplayName` helper or touch Sidebar.tsx. 24e is separate and landed.
- **Do not** collapse `resolveChatConfig` into its callers. It still has real work: it checks `content.chat` AND the filesystem marker, and returns the per-panel UI settings. Leave it as a function.
- **Do not** add hot-reload wiring to the unified `chat/threads/` directory. That's SPEC-30.
- **Do not** edit `lib/runner/index.js:115-135` (the dormant persona-wire notify block). 24f territory.
- **Do not** touch `thread:create:confirm` in `Sidebar.tsx`. 24f territory.
- **Do not** rename `ThreadManager.panelId` to something else. It's still the right name — panel identity is still how SQLite scopes threads. The PATH is unified; the identity isn't.

---

## Commit message template

```
SPEC-24c: unify chat storage at ai/views/chat/threads/<user>/<id>.md

Relocates thread markdown files from per-panel storage
  ai/views/<panel>/chat/threads/<user>/<id>.md
to a single unified location
  ai/views/chat/threads/<user>/<id>.md
regardless of which panel initiated the thread.

Motivation: collaboration. Partners and co-workers git push/pull chat
histories. With unified storage, one directory per user contains all
of that user's chats across every panel, instead of scattered across
per-panel subfolders.

Changes (6 files):

1. ThreadManager.js — _getViewsDir() simplified to return the unified
   path. Constructor drops panelPath (no longer needed; path is
   derived from projectRoot alone). The agents-viewer special case in
   the old fallback branch is gone.

2. ThreadWebSocketHandler.js — getThreadManager() cache check
   simplifies to panelId-only (no more panelPath-based invalidation).
   setPanel() docstring updated; function body unchanged.

3. lib/views/index.js — resolveChatConfig() drops chatPath from its
   return. The per-panel chat/ folder existence check is preserved as
   the "chat enabled" capability marker (no-code panel creation
   pattern). Return shape is now { chatType, chatPosition }.

4. server.js — initial setPanel call on connection drops panelPath.

5. lib/ws/client-message-router.js — set_panel handler drops
   panelPath from its setPanel invocation.

6. Pre-prod wipe — existing thread files under every
   ai/views/*/chat/threads/ directory deleted, SQLite threads table
   cleared. Per parent SPEC-24, existing threads are disposable.

Unchanged:
  - Per-panel <view>/chat/ folders stay as the capability marker
  - Per-panel <view>/chat/settings/ scaffolds untouched
  - SQLite panel_id column is still the sole scoping key; each
    panel's sidebar still shows only its own threads via SQLite
    filtering
  - content.chat in content.json still holds per-panel UI settings
  - Client: zero changes. Never sees server-side paths.

Live-validated: create, send message, rename, delete, resume, panel
switch — all working end-to-end. Files land in the unified location;
per-panel thread folders stay empty; sidebars still scope correctly.

Part of SPEC-24 (chat simplification). Unblocks SPEC-24f (deep code
sweep) — the last phase in the 24x series.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

## Report back

1. **Diff stats.** `git diff --stat main` — expected: 6 files changed, moderate line changes. ThreadManager gets ~10 lines smaller, ThreadWebSocketHandler gets ~5 smaller, views/index.js stays roughly the same, server.js loses ~4 lines, client-message-router.js loses ~3 lines, plus the pre-prod wipe deletions of whatever thread files existed.

2. **Static check output.** Paste every grep and node-e check from the "Unit / static checks" section. Every assertion must PASS.

3. **Pre-wipe and post-wipe state.** Paste the `find` + `sqlite3 COUNT` output before and after the wipe. Confirm zero files / zero rows after.

4. **Live validation evidence.**
   - The actual path of the file created by the first thread (from `find`).
   - Confirmation that `find ai/views/*/chat/threads -type f` returned zero after creating threads (old locations stay empty).
   - Confirmation that two threads from different panels both landed in the same `ai/views/chat/threads/<user>/` directory.
   - SQLite `SELECT thread_id, panel_id FROM threads;` output showing both threads with their respective panel_id values.
   - Confirmation that each panel's sidebar shows only its own threads (no cross-contamination).

5. **Any surprises.** Unexpected callers of `panelPath` or `chatPath`. Cache-invalidation issues. Anything that broke beyond what was anticipated.

6. **Files touched outside the change list.** Should be zero. If any, explain.

7. **24f candidates noticed.** Anything you spotted during the refactor that looks stale or suspicious but is out of 24c scope. Examples to watch for:
   - Comments still referencing "per-panel chat storage"
   - Dead conditionals around `panelPath` in other modules
   - Tests that hardcode the old per-panel path structure
   - Anything in `lib/views/` that reads `<view>/chat/threads/` directly (a filesystem walker we missed)

Hand the report back to the orchestrator before any other 24x phase.
