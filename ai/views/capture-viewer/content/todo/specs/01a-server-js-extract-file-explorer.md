# SPEC-01a — Extract File Explorer from server.js

**Parent:** SPEC-01 (server.js decomposition)
**Position:** Extraction 1 of 6 — the warm-up. Fewest dependencies, cleanest boundaries, proves the pattern.
**Model recommendation:** Opus 4.6 with 1M context window.
**Estimated blast radius:** Low. No shared closure state. No enforcement hooks. No lifecycle coupling.

---

## Your mission

Extract six file-explorer functions from `open-robin-server/server.js` (lines 266–630) into a new single-file module at `open-robin-server/lib/file-explorer.js`. Use the factory-with-injected-dependencies pattern that already exists in `lib/thread/thread-crud.js` and `lib/thread/thread-messages.js`. Wire the factory's output into the three call sites in server.js's client message router. Verify behavior is unchanged. Commit.

server.js should drop from 1752 → ~1387 lines after this extraction.

**You are extracting, not refactoring.** Preserve exact behavior. Do not improve, simplify, tighten security, rename, or reorganize. Mechanical moves only.

---

## Context before you touch code

Read these three files in full before starting. They contain the gotchas and the background you need.

1. `ai/views/capture-viewer/content/todo/specs/01-server-js-CONTEXT-FORWARD.md` — the resume-from-compact doc for the entire SPEC-01 decomposition. Covers the 14 jobs inside server.js, the 6-extraction plan, the critical gotchas (session closure scope, middleware ordering, `global.__agentWireSessions`, startup sequence, enforcement placement, deferred harness process pattern), and the completed work already extracted from server.js.
2. `ai/views/capture-viewer/content/todo/specs/01-server-js-decomposition.md` — the original decomposition spec. Read the gotchas section in particular.
3. `open-robin-server/lib/thread/thread-crud.js` — the canonical example of the factory pattern you will follow. `open-robin-server/lib/thread/thread-messages.js` is a smaller example of the same pattern.

Also helpful: verify line numbers haven't drifted. Run `wc -l open-robin-server/server.js` — it should report 1752. If it's different, someone modified server.js after this spec was written and you need to reconcile before continuing. Spot-check a few function line numbers from the table below with `grep -n`.

---

## Source — what you are moving

All six functions live in `open-robin-server/server.js`. Line numbers are current as of spec writing (file size: 1752 lines).

| # | Function | Line | Kind | Purpose |
|---|----------|------|------|---------|
| 1 | `mapFileErrorCode(err)` | 266 | sync helper | Translate `fs` error codes (ENOENT / EACCES / ENOTDIR / EISDIR / UNKNOWN) |
| 2 | `isPathAllowed(basePath, targetPath)` | 287 | sync helper | Two-pass path security check (logical + symlink) |
| 3 | `parseExtension(filename)` | 319 | sync helper | Extract lowercase file extension |
| 4 | `handleFileTreeRequest(ws, msg)` | 325 | async handler | Folder listing with symlink resolution, 1000-entry cap, hidden-file filtering |
| 5 | `handleFileContentRequest(ws, msg)` | 454 | async handler | File read with optional agents.json enrichment |
| 6 | `handleRecentFilesRequest(ws, msg)` | 540 | async handler | Recursive scan with 5-level depth cap, mtime-sorted, limit-bounded |

Total span: lines 266–630 (inclusive). ~365 lines to move.

---

## Dependencies — what these functions need from the outside

After inspecting the function bodies, these are the only external things the six functions touch:

### Injected via factory (become constructor parameters)

| Dependency | Currently at | Used in | Why inject |
|------------|-------------|---------|------------|
| `getPanelPath(panel, ws)` | server.js:243 | All three `handle*Request` functions | Resolves panel ID to filesystem path. Stays in server.js because `set_panel` (line 1305) and other handlers still need it. |
| `getDefaultProjectRoot()` | server.js:206 | `isPathAllowed` only (inside the symlink fallback branch) | Small helper, used broadly in server.js. Keep it in server.js for now; inject the reference. |

### Node builtins (import directly in the new module)

- `fs` — for `fs.lstatSync`, `fs.realpathSync`, `fs.existsSync` in `isPathAllowed`
- `fs.promises` — for all async file operations in the handler functions. Current server.js uses `fsPromises` as the alias; you can match or use `fs/promises` destructuring — either is fine.
- `path` — for `path.resolve`, `path.join`

### Conditional require inside `handleFileContentRequest`

Line 506 has a `require('./lib/cron-label')` inside a try/catch specifically for agents.json enrichment. In the new file (`lib/file-explorer.js`), this path becomes `./cron-label`. **Update this require path when you move the function.** Do not hoist it to the top — the existing code keeps it inside the try/catch deliberately, and the try/catch swallows module-load errors as well as JSON parse errors.

### Nothing else

- No WebSocket server reference (just the per-connection `ws` parameter that's already passed in)
- No session state (`sessions` Map), no wire registry, no thread manager
- No event bus emissions
- No `checkSettingsBounce` enforcement
- No database access
- No `global.*` reads or writes

This is why File Explorer is Extraction 1 — the dependency graph is as simple as it gets.

---

## Target — the new file

Create `open-robin-server/lib/file-explorer.js`. It should be a single file (no subdirectory yet), matching the size of `lib/thread/thread-crud.js` (~365 lines) after extraction.

Module shape (match this exactly):

```js
/**
 * File Explorer Handlers
 *
 * Extracted from server.js — handles the three file_*_request client
 * message types: file_tree_request, file_content_request,
 * recent_files_request. Includes path security, error code mapping,
 * and filename parsing helpers used by those handlers.
 *
 * Uses a factory pattern so server.js can inject getPanelPath (which
 * depends on per-WS session roots and the views resolver) and
 * getDefaultProjectRoot (used by the symlink fallback branch of
 * isPathAllowed).
 */

const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

/**
 * @param {object} deps
 * @param {(panel: string, ws: import('ws').WebSocket) => string|null} deps.getPanelPath
 * @param {() => string} deps.getDefaultProjectRoot
 */
function createFileExplorerHandlers({ getPanelPath, getDefaultProjectRoot }) {

  function mapFileErrorCode(err) { /* verbatim from server.js:266 */ }

  function isPathAllowed(basePath, targetPath) { /* verbatim from server.js:287
     — replace getDefaultProjectRoot() call with the injected dep */ }

  function parseExtension(filename) { /* verbatim from server.js:319 */ }

  async function handleFileTreeRequest(ws, msg) { /* verbatim from server.js:325 */ }

  async function handleFileContentRequest(ws, msg) { /* verbatim from server.js:454
     — update './lib/cron-label' to './cron-label' in the inner require */ }

  async function handleRecentFilesRequest(ws, msg) { /* verbatim from server.js:540 */ }

  return {
    handleFileTreeRequest,
    handleFileContentRequest,
    handleRecentFilesRequest,
  };
}

module.exports = { createFileExplorerHandlers };
```

Only the three async handlers are returned. The three helpers (`mapFileErrorCode`, `isPathAllowed`, `parseExtension`) are internal to the module — the outside doesn't need them and nothing else in the codebase currently imports them from server.js. **Do not export the helpers.**

---

## Wiring — what changes in server.js

### 1. Add the import near the other `lib/` imports

There's a cluster of requires around lines 19–27 of server.js (thread, robin, clipboard, wiki hooks). Add this line alongside them:

```js
const { createFileExplorerHandlers } = require('./lib/file-explorer');
```

### 2. Construct the factory somewhere after `getPanelPath` and `getDefaultProjectRoot` are both defined

`getPanelPath` is at line 243. `getDefaultProjectRoot` is at line 206. After both have been declared (practically, just after the current location of `parseExtension` before it gets removed — or anywhere after line 264 and before the first call site at line 1287), add:

```js
const fileExplorer = createFileExplorerHandlers({
  getPanelPath,
  getDefaultProjectRoot,
});
```

Pick a location that keeps the factory construction close to the other module-level setup. Directly after `getPanelPath` is defined (after line 264) is a good place — the "top of what used to be File Explorer" slot.

### 3. Delete the six functions from server.js

Delete lines 266–630 inclusive. That is the entire span from `function mapFileErrorCode` through the closing brace of `handleRecentFilesRequest`. The `// ========` comment block at 632–637 should stay (it's a section header for Wire Process Functions that follows).

### 4. Update the three call sites

Lines 1287–1300 currently call the functions directly:

```js
if (clientMsg.type === 'file_tree_request') {
  await handleFileTreeRequest(ws, clientMsg);
  return;
}

if (clientMsg.type === 'file_content_request') {
  await handleFileContentRequest(ws, clientMsg);
  return;
}

if (clientMsg.type === 'recent_files_request') {
  await handleRecentFilesRequest(ws, clientMsg);
  return;
}
```

Change to:

```js
if (clientMsg.type === 'file_tree_request') {
  await fileExplorer.handleFileTreeRequest(ws, clientMsg);
  return;
}

if (clientMsg.type === 'file_content_request') {
  await fileExplorer.handleFileContentRequest(ws, clientMsg);
  return;
}

if (clientMsg.type === 'recent_files_request') {
  await fileExplorer.handleRecentFilesRequest(ws, clientMsg);
  return;
}
```

### 5. Verify nothing else in server.js references the deleted functions

After the deletion, `grep -n 'handleFileTreeRequest\|handleFileContentRequest\|handleRecentFilesRequest\|mapFileErrorCode\|isPathAllowed\|parseExtension' open-robin-server/server.js` should return zero matches — if any matches remain, you missed a call site or the helpers are referenced somewhere unexpected and you need to investigate before proceeding.

`grep -rn 'mapFileErrorCode\|isPathAllowed\|parseExtension' open-robin-server/ --include='*.js'` should only return matches in `lib/file-explorer.js` after the extraction. (These helpers are private to server.js today; nothing else in the codebase uses them.)

`grep -rn 'handleFileTreeRequest\|handleFileContentRequest\|handleRecentFilesRequest' open-robin-server/ --include='*.js'` should return matches only in `lib/file-explorer.js` and `server.js` (the three call sites in the router).

---

## Gotchas — preserve these exactly

### 1. `isPathAllowed` has a permissive fallback branch. Do not "fix" it.

Look at lines 297–317. The symlink handling has three sequential `return true` statements — one for symlinks whose real target is within `basePath`, one for targets within `projectRoot`, and one final unconditional `return true` labeled "Symlink is inside the workspace folder — it's there on purpose."

This is permissive on purpose. Symlinks get allowed liberally. Non-symlinks fall through to the final `return true` at line 316 as long as they passed the Pass-1 logical check at line 290. That is current behavior. **Do not tighten it during extraction.** If there's a real security concern, it gets filed as a separate debug spec — this is a mechanical move.

### 2. The `'./lib/cron-label'` require path must become `'./cron-label'`

At line 506 inside `handleFileContentRequest`, there's an inner try/catch that `require('./lib/cron-label')`. Once the function lives at `lib/file-explorer.js`, the relative path changes. Update it to `'./cron-label'`. Leave the `require` inside the try/catch — don't hoist it to the top. The try/catch deliberately swallows require failures and JSON parse failures together.

### 3. Preserve the `panel || 'code-viewer'` defaults

All three handlers default `panel` to `'code-viewer'` when `msg.panel` is falsy. Don't change this default. Don't "improve" it to the current actual panel or to null. It's a historical default.

### 4. Preserve the 1000-entry folder cap in `handleFileTreeRequest`

Lines 360–370 return an `ETOOLARGE` error response before doing the filter-and-sort work if `entries.length > 1000`. Keep the cap at 1000. Keep the error code as `ETOOLARGE`. Keep the error message text ("Folder has N items (max 1000). Use terminal to explore.").

### 5. Preserve the 5-level depth cap and exclusion list in `handleRecentFilesRequest`

Line 588 checks `entryRelativePath.split('/').length < 5` before recursing. Line 580–584 excludes `node_modules`, `.git`, `dist`, `.kimi`, and any dot-prefixed entry. These limits protect against runaway scans. Don't relax them.

### 6. Preserve the sort/slice/reverse sequence in `handleRecentFilesRequest`

Lines 610–613:

```js
const sortedFiles = files
  .sort((a, b) => b.mtime - a.mtime)
  .slice(0, limit)
  .reverse();
```

The trailing `.reverse()` is intentional — the client expects "newest at bottom." Keep it.

### 7. Preserve the `agents-viewer` / `agents.json` enrichment block

Lines 503–517 inside `handleFileContentRequest` do special-case enrichment of `agents.json` with human-readable schedule labels from the cron-label module. Keep this block exactly as-is, only updating the require path as noted in Gotcha #2.

### 8. Preserve error response shapes

Every error path sends a JSON response object with `type`, `panel`, `path` (or not, for recent files), `success: false`, `error`, and `code`. Don't consolidate these into a helper during extraction — that's a follow-up refactor, not this one. Copy the shape verbatim.

### 9. Do not pass `ws` through any intermediate wrapper

The handlers accept `(ws, msg)` and call `ws.send(...)` directly. Don't introduce a send helper, don't introduce a response object, don't wrap the websocket. Verbatim transplant.

---

## Verification checklist

After the extraction, run these checks in order. **Stop and report if any step fails** — do not attempt to fix issues you weren't explicitly instructed to fix.

### Sanity checks (don't need a running server)

1. `wc -l open-robin-server/server.js` — should report approximately 1387 lines (down from 1752). If it's much larger or smaller, the diff is wrong.
2. `wc -l open-robin-server/lib/file-explorer.js` — should report approximately 365 lines (plus the factory boilerplate, so call it 380–400).
3. `node -e "require('./open-robin-server/lib/file-explorer')"` from the repo root — should complete without throwing. Confirms syntax is valid.
4. `node -e "require('./open-robin-server/server.js')"` from the repo root — may throw because server.js calls `server.listen()` at module load; if it throws a port-already-in-use error or similar network error, that's fine and proves the requires resolved. If it throws a `SyntaxError`, `ReferenceError`, or `TypeError` about missing functions, something is wrong with the extraction.
5. Grep checks from the previous section:
   - `grep -n 'handleFileTreeRequest\|handleFileContentRequest\|handleRecentFilesRequest\|mapFileErrorCode\|isPathAllowed\|parseExtension' open-robin-server/server.js` should return only the three call sites in the router (around line 1287) — nothing else.
   - `grep -rn 'mapFileErrorCode\|isPathAllowed\|parseExtension' open-robin-server/ --include='*.js'` should only show `lib/file-explorer.js`.

### Runtime checks (server must be running)

Run `./restart-kimi.sh` from the repo root. It does the full nuke: pkills all `node server.js` processes, clears port 3001, rebuilds the client, starts the server, and verifies it's serving. If the script exits with an error, the extraction broke something — stop and report.

6. `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/` should return `200`.
7. Open `http://localhost:3001` in a browser. The page should load without errors. Open the browser console — no red errors related to file tree, file content, or recent files.
8. Open a file explorer panel in the UI (capture-viewer has one). It should populate with folders. Click into a folder — the tree should expand. Click on a file — content should load in the viewer.
9. Trigger the recent files view (the RecentFilesTrigger component). It should return a list of recently modified files, sorted newest-at-bottom.
10. Tail `open-robin-server/server-live.log` for the last 100 lines. No `[CLIENT ERROR]`, no stack traces, no unhandled promise rejections.

---

## What NOT to do

This is a mechanical extraction. The following are explicitly out of scope:

- **Do not** modify `isPathAllowed`'s permissive fallback behavior (see Gotcha #1).
- **Do not** rename any function, parameter, or local variable.
- **Do not** add TypeScript-style JSDoc beyond what's necessary for the factory's `deps` parameter.
- **Do not** add logging, telemetry, or debug statements. The functions currently have none.
- **Do not** consolidate the three error-response code paths into a helper.
- **Do not** consolidate the three "panelPath === null" early-return branches into a helper.
- **Do not** tighten the 1000-entry folder cap, the 5-level recursion depth, or the exclusion list.
- **Do not** hoist the `require('./cron-label')` out of its try/catch.
- **Do not** split `lib/file-explorer.js` into multiple files (e.g. `path-security.js`, `file-tree.js`). Single file for this extraction; further splitting can be a follow-up spec.
- **Do not** touch any other file explorer logic elsewhere in the codebase (there should be none, but if you find some, report it rather than touching it).
- **Do not** push the commit. Commit locally only; the user pushes.
- **Do not** update this spec doc to mark it complete. The user does that.
- **Do not** attempt to fix unrelated issues you notice in server.js. File them, don't fix them.
- **Do not** move `getPanelPath`, `getDefaultProjectRoot`, `setSessionRoot`, `getSessionRoot`, `clearSessionRoot`, `AI_PANELS_PATH`, or `sessionRoots` out of server.js. They stay. They are not part of this extraction.

---

## Commit

One commit. Message:

```
Extract file explorer from server.js into lib/file-explorer.js

Part 1 of 6 under SPEC-01 (server.js decomposition). Moves the six
file-explorer functions out of server.js:

- mapFileErrorCode    (helper)
- isPathAllowed       (helper — two-pass security check)
- parseExtension      (helper)
- handleFileTreeRequest    (folder listing)
- handleFileContentRequest (file read + agents.json enrichment)
- handleRecentFilesRequest (recursive scan, mtime-sorted)

Uses the factory-with-injected-dependencies pattern from
lib/thread/thread-crud.js. server.js injects getPanelPath and
getDefaultProjectRoot; the three handlers are wired into the
client message router at the existing call sites.

Behavior is preserved exactly. No refactoring, no security tightening,
no consolidation. Mechanical transplant.

server.js: 1752 → ~1387 lines.
```

**Commit only. Do not push.**

---

## Reporting back

When you're done, report:

1. **Actual line counts** — `wc -l` results for both server.js (new) and lib/file-explorer.js (new). If they diverge from the estimates above by more than ~30 lines, explain why.
2. **Verification results** — each of the 10 checks, with a one-line result. ✓ or ✗.
3. **Any deviations from the spec** — if you had to make a judgment call not covered by this doc, list it.
4. **Commit hash** — the SHA of your extraction commit.
5. **Anything unexpected** — unusual grep hits, surprising call sites, code you wanted to touch but didn't.

If you encounter a blocker (tests failing, import resolution issues, path problems), stop and describe the blocker. Do not attempt a fix unless it's an obvious typo in your own edit.

---

## Files you will touch

- `open-robin-server/lib/file-explorer.js` — new file, create it
- `open-robin-server/server.js` — delete 6 functions, add 1 require, add 1 factory call, update 3 call sites

That's it. Two files. One delete-and-create pair plus edits to server.js.

---

## After this SPEC lands

The user and the IDE Claude session will verify the work, then move on to SPEC-01b (Startup Orchestrator extraction). Each of the six extractions gets its own spec. Do not start the next one — stop after this one and let the user drive the next cycle.
