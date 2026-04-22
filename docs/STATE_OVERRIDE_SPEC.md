# View State Override — Spec

**Status:** Draft — ready for handoff.
**Owner:** Open Robin core.
**Code standards:** `ai/views/wiki-viewer/content/enforcement/code-standards/PAGE.md`.
**Supersedes:** Per-view state paths from SPEC-26c-2 (`ai/views/<view>/state/<username>.json`).
**Related memories:**
- `project_settings_enforcement.md` — `settings/` is AI-write-locked and the canonical RAM-load surface.
- `project_threat_model.md` — enforcement constrains AI, not the running app.
- `project_chat_scoping_architecture.md` — chats workspace-scoped by default; view-bound for wiki/agents.

---

## 1. Purpose

Flip the default: UI state (widths, collapse flags, popup geometry, the currently-open thread) is **workspace-global**, with **per-view overrides** opt-in via file duplication. This mirrors the CSS cascade paradigm already planned for `settings/styles/` and removes the need for a user-facing "inherit" toggle in the chat menu.

**What changes from the user's POV:**
- Drag the chat wider in one view → every view gets that width, unless a view has its own override file.
- Collapse the thread list in wiki-viewer → every view follows, unless overridden.
- Switch to a different thread in agents-viewer → popup state and current thread carry over when switching views, unless a view declares its own `currentThreadId` override.

**What changes for a power user:**
- Drop an `ai/views/<view>/settings/state.json` file containing only the keys you want pinned for that view. Those keys win; everything else falls through to the workspace default.
- The mechanic is identical to how a per-view stylesheet in `ai/views/<view>/settings/styles/<same-name>.css` will override a workspace stylesheet of the same name (future work).

---

## 2. Non-goals

- **No UI toggle.** The prior proposal (ellipsis-menu "Inherit Settings" switch with `ad_group`/`ad_group_off` icons) is dropped. Override is filesystem-driven.
- **No multi-user support.** The current `<username>.json` scheme is retired. One user per machine is the operating assumption; the file is simply `state.json`.
- **No changes to `layout.json`.** `ai/views/<view>/settings/layout.json` remains per-view declared structural intent (chat position, declared defaults) and continues to seed the resolver when no persisted state exists.
- **No hot reload** of user-edited override files in this spec. Hot reload of the `settings/` surface is SPEC-30 and applies uniformly once it lands.
- **No migration UI.** Migration is a one-shot script the implementer runs during rollout.

---

## 3. The paradigm

**Override by duplication, merged per key.**

```
ai/views/settings/state.json                ← workspace default (source of truth)
ai/views/<view>/settings/state.json         ← optional per-view override (subset of keys)
```

**Resolution rule:** the effective state for a view is the workspace default, deep-merged with the per-view override if one exists. Per-view keys win on any path they touch; absent keys inherit.

**Write rule:** on every persist action (drag-release, collapse click, popup move, thread switch), the server inspects the per-view override file:

- **Per-view file exists AND already contains the key being written** → update per-view file (override stays pinned).
- **Otherwise** → update workspace file.

This means a per-view override is **sticky per key**. Once a user manually drops a `state.json` into a view's settings folder with `collapsed.leftSidebar: true`, that view's sidebar collapse state stays pinned in the per-view file. Width changes in that same view still flow to the workspace file, so they propagate to all other views that inherit widths.

**Mental model:**
- Workspace `state.json` is shared RAM.
- Per-view `state.json` is a pin board — write it by hand, and those keys stop inheriting.
- The running app never creates per-view override files. Creation is a deliberate user act. The app only updates keys that already exist in one.

---

## 4. File layout

### 4a. Workspace default

**Path:** `ai/views/settings/state.json`

Created by the server on first launch if missing (seeded from hardcoded defaults). Always exists in a running workspace. AI-write-locked by the existing `settings/` enforcement; the running server writes it through a dedicated code path (`lib/view-state/`), which is not "AI" per the threat model.

### 4b. Per-view override

**Path:** `ai/views/<view>/settings/state.json`

Optional. Never created by the server. Users create it by hand (or copy from the workspace file and delete keys they don't want overridden). Presence of a key in this file pins that key for the view.

### 4c. Retired paths

The following paths are removed as part of this spec:

- `ai/views/<view>/state/<username>.json` — entire `<view>/state/` directory.
- `rccurtrightjr..json` filename convention (any view).

Migration (§9) handles these.

---

## 5. Data shape

```jsonc
// ai/views/settings/state.json — full shape (all keys present)
{
  "widths": {
    "leftSidebar":     220,
    "leftChat":        320,
    "rightSecondary":  400,
    "rightCol":        220
  },
  "collapsed": {
    "leftSidebar": false,
    "leftChat":    false
  },
  "popup": {
    "open":     false,
    "x":        -1,
    "y":        -1,
    "width":    420,
    "height":   520,
    "threadId": null
  },
  "currentThreadId":    null,
  "secondaryThreadId":  null
}
```

```jsonc
// ai/views/wiki-viewer/settings/state.json — example override
// (pins thread list collapsed + a view-bound current thread, inherits widths + popup)
{
  "collapsed": {
    "leftSidebar": true
  },
  "currentThreadId": "2026-04-19T18-54-25-495"
}
```

**Type definitions** (authoritative — matches `open-robin-client/src/lib/panels.ts` `LayoutConfig` and `panelStore.ts` `ViewUIState`):

```ts
interface ViewState {
  widths: {
    leftSidebar:    number;
    leftChat:       number;
    rightSecondary: number;
    rightCol:       number;
  };
  collapsed: {
    leftSidebar: boolean;
    leftChat:    boolean;
  };
  popup: {
    open:     boolean;
    x:        number;
    y:        number;
    width:    number;
    height:   number;
    threadId: string | null;
  };
  currentThreadId:   string | null;
  secondaryThreadId: string | null;
}

// A per-view override is a DeepPartial<ViewState> — any subset of keys.
type ViewStateOverride = DeepPartial<ViewState>;
```

---

## 6. Resolver

**Signature:**

```js
// open-robin-server/lib/view-state/resolver.js — new file
async function resolveViewState(projectRoot, viewId) {
  // 1. Load workspace default (create if missing).
  // 2. Load per-view override if present.
  // 3. Deep-merge: workspace ← per-view (per-view wins on any present key).
  // 4. Clamp numeric fields (widths) to [120, 600].
  // 5. Return ViewState.
}
```

**Merge semantics:**
- Deep merge at every object level (`widths`, `collapsed`, `popup`).
- Leaf scalars (including `null`) in the override replace the workspace value.
- Keys **absent** from the override inherit. An explicit `null` in the override is **not** the same as absent — `null` means "override to null." This distinction matters for `currentThreadId` where `null` is a legitimate value ("no thread open").
- Arrays (none in the current shape) would be replaced whole, not concatenated. Documented so future additions don't surprise.

**Clamping:** applied at the resolver boundary, not at write time. Writes store whatever the client sends; reads normalize. Range: `widths.*` ∈ [120, 600]. Popup `width` ∈ [280, 1200], `height` ∈ [240, 1200]. (Values picked from current `panelStore` clamp.)

**Fallback:** if neither file exists, the resolver creates `ai/views/settings/state.json` with hardcoded defaults (see §5 shape) and returns those. First-run behavior.

---

## 7. Writer

**Signature:**

```js
// open-robin-server/lib/view-state/writer.js — new file
async function writeViewStatePatch(projectRoot, viewId, patch) {
  // For each leaf key in `patch`:
  //   - If per-view override file exists AND has that key path → write per-view.
  //   - Else → write workspace.
  // Writes are atomic (tmp file + rename).
  // Returns the resolved state post-write (for the WS response).
}
```

**Per-key routing in detail:**

- Walk the patch depth-first to every leaf.
- For each leaf key path (e.g. `widths.leftChat`, `collapsed.leftSidebar`, `currentThreadId`):
  - Read the per-view override file (may be absent).
  - If the file exists **and** the key path is present (including `null`), update that file.
  - Otherwise, update the workspace file.
- Writes are batched per file: a single patch may produce writes to zero, one, or both files.
- Both writes are atomic via `writeFile(tmp); rename(tmp, final)`.

**Examples:**

| Per-view override file contents                    | Patch sent                          | Result                                                     |
|----------------------------------------------------|-------------------------------------|------------------------------------------------------------|
| (no file)                                          | `{ widths: { leftChat: 380 } }`     | Workspace file updated. No per-view file created.          |
| `{ collapsed: { leftSidebar: true } }`             | `{ widths: { leftChat: 380 } }`     | Workspace file updated. Per-view file untouched.           |
| `{ collapsed: { leftSidebar: true } }`             | `{ collapsed: { leftSidebar: false } }` | Per-view file updated (key path already present).      |
| `{ collapsed: { leftSidebar: true } }`             | `{ collapsed: { leftChat: true } }` | Workspace file updated (only `leftSidebar` is pinned, not `leftChat`). |
| `{ currentThreadId: "abc" }`                       | `{ currentThreadId: "xyz" }`        | Per-view file updated.                                     |

**Invariant:** the writer never creates a per-view override file. Only users do.

---

## 8. Server API

The existing WebSocket message types stay unchanged at the wire boundary:

| Inbound           | Action                                    | Response                                                |
|-------------------|-------------------------------------------|---------------------------------------------------------|
| `state:get` `{ view }`       | Call `resolveViewState`        | `state:result` with `{ view, state: ViewState }`        |
| `state:set` `{ view, state }` | Call `writeViewStatePatch`    | `state:result` with merged state after write             |

`state` in the `state:set` message is a `ViewStateOverride` (partial). Clients should send only the keys that changed — they already do this for `collapsed` and `widths`; the pattern extends naturally to `popup`, `currentThreadId`, `secondaryThreadId`.

**Router file:** `open-robin-server/lib/ws/client-message-router.js` — handlers exist today at lines 353 and 377 (see current `resolveViewState`/`writeViewStatePatch` calls). The handler bodies don't change; only the modules they import change.

---

## 9. Client

**No client code changes are required for the core feature.** The `state:get` / `state:set` protocol is stable. `panelStore.ts` already calls `loadViewState(view)` on panel switch and pushes patches on resize/collapse.

**Required client changes are additive — new state keys:**

1. `panelStore.ts` — extend `ViewUIState` to include `currentThreadId`, `secondaryThreadId`, and `popup.threadId`. These already exist in-memory elsewhere in the store (`currentThreadIds`, `secondary.threadId`); this spec moves them into the persisted view-state slot so they round-trip through `state:get`/`state:set`.
2. Persist-on-change hooks for:
   - `currentThreadId` — when user opens a thread.
   - `secondaryThreadId` — when the popup opens a thread.
   - `popup.x/y/width/height/open` — on popup drag / resize / open-close.
3. On `state:result`, hydrate the new keys into their existing store slots (don't duplicate state — the persistence layer is just a mirror).

**What does NOT change:**
- The `layoutConfig` type (`panels.ts:40-46`) is unrelated; keep as-is for now. Unrelated follow-up: decide whether to delete it or wire it to seed `ai/views/settings/state.json` on first launch (§6 fallback). My recommendation: seed from `layoutConfig` at first launch if it's present, otherwise hardcoded defaults. This gives per-view `layout.json` a real job during bootstrap without resurrecting the "ignore the override" bug.

---

## 10. Migration

**One-shot script:** `open-robin-server/scripts/migrate-view-state.js` (new).

**Inputs:** current `ai/views/<view>/state/<username>.json` files. The candidates today:

```
ai/views/agents-viewer/state/rccurtrightjr..json
ai/views/capture-viewer/state/rccurtrightjr..json
ai/views/code-viewer/state/rccurtrightjr..json
ai/views/issues-viewer/state/rccurtrightjr..json
ai/views/wiki-viewer/state/rccurtrightjr..json
```

**Algorithm:**

1. Load all files.
2. Pick the **seed** — `code-viewer` (most dialed-in per user session).
3. Write the seed into `ai/views/settings/state.json` (create folder).
4. For each other view, diff its keys against the seed:
   - If a key's value matches the seed → drop it (no override needed).
   - If it differs → include it in a per-view override at `ai/views/<view>/settings/state.json`.
   - If the per-view override would be empty `{}` → do not create the file.
5. Delete old `ai/views/<view>/state/` directories.
6. Log everything to stdout so the diff is visible.

**Expected outcome (based on current state dumps I inspected):**

- `ai/views/settings/state.json` seeded from code-viewer.
- `ai/views/wiki-viewer/settings/state.json` → `{ "collapsed": { "leftSidebar": true } }`.
- `ai/views/issues-viewer/settings/state.json` → `{ "collapsed": { "leftSidebar": true } }`.
- No override file for agents-viewer, capture-viewer (empty persisted state).
- Old `<view>/state/` directories deleted.

**Manual verification after script run:** open each view; confirm sidebar collapse matches pre-migration; confirm resizing the chat in one view propagates to other views that don't have the widths key pinned.

---

## 11. Files changed

| File                                                           | Action |
|----------------------------------------------------------------|--------|
| `open-robin-server/lib/view-state/index.js`                    | Rewrite — path resolution changes. Split resolver + writer into their own files (§6, §7). Keep barrel exports stable. |
| `open-robin-server/lib/view-state/resolver.js`                 | New — implements §6. |
| `open-robin-server/lib/view-state/writer.js`                   | New — implements §7. |
| `open-robin-server/lib/view-state/defaults.js`                 | Keep. Still used by the resolver fallback when no files exist. Consider sourcing from `layout.json` as an additional seed step (see §9 note). |
| `open-robin-server/lib/ws/client-message-router.js`            | Unchanged protocol. Only the imported modules change paths if names move. |
| `open-robin-server/scripts/migrate-view-state.js`              | New — one-shot migration (§10). |
| `open-robin-client/src/state/panelStore.ts`                    | Extend `ViewUIState` with `currentThreadId`, `secondaryThreadId`, `popup.threadId`; add persist hooks for them (§9). |
| `open-robin-client/src/types/index.ts`                         | Extend types to match. |
| `ai/views/settings/state.json`                                 | Created by migration script. |
| `ai/views/<view>/settings/state.json`                          | Created by migration script for views with diverging keys (see §10). |
| `ai/views/<view>/state/rccurtrightjr..json` (all views)        | Deleted by migration script. |

No CSS changes. No UI changes.

---

## 12. Rollout

1. **Spec review** — confirm §5 shape (especially the new `currentThreadId`, `secondaryThreadId`, `popup.threadId` additions to persisted state).
2. **Server: resolver + writer** — land new `lib/view-state/resolver.js` + `lib/view-state/writer.js` behind the same barrel export. Protocol unchanged, so client works with no edits.
3. **Client: extend `ViewUIState`** — add the three new persisted keys, wire persist-on-change for each.
4. **Migration script** — run once manually, inspect output, commit the resulting `ai/views/settings/state.json` and any per-view overrides.
5. **Delete legacy paths** — `<view>/state/` directories go away in the migration commit.
6. **Smoke test** — open each view, verify carry-over behavior (widths propagate; sidebar collapse stays pinned for wiki/issues; thread switch persists across view switches).
7. **Document the pattern** — add a wiki page under `ai/views/wiki-viewer/content/enforcement/` (or similar) so future AI implementers know the override-by-duplication pattern applies to `state.json` today and will apply to `styles/<name>.css` later.

Each step is independently committable. Steps 2 and 3 land behind the current client behavior (it still only reads `collapsed` + `widths` + `popup`), so nothing breaks until step 3 also persists the new keys.

---

## 13. Open questions

1. **Hot reload of manually-edited per-view override files** — out of scope; blocked on SPEC-30. When SPEC-30 lands, `settings/state.json` inherits its hot-reload behavior for free because it lives under `settings/`. Flag in spec so it's not re-debated.
2. **First-run seeding from `layout.json`** — current resolver falls through to `layout.json` declared defaults. Should the new workspace `ai/views/settings/state.json` be seeded from the union of declared layouts (per-view layout.json → pick reasonable workspace defaults), or from hardcoded values? Proposal: hardcoded defaults for v1, with a follow-up that walks enabled views' `layout.json` files and picks medians/majorities.
3. **Styles parallel** — this spec establishes the paradigm. The styles version is not landed here. A separate spec (`STYLES_OVERRIDE_SPEC.md`) should follow the same structure: workspace default at `ai/views/settings/styles/<name>.css`, per-view override at `ai/views/<view>/settings/styles/<name>.css`, loader merges via CSS cascade (later per-view `<link>` wins naturally). No JSON-merge equivalent needed for CSS — the cascade is the merge.
4. **Popup `threadId` in persisted state** — today the popup's current thread lives only in the store's `secondary.threadId`. Persisting it means a hard reload restores the popup to the same thread it had. Desired? Proposal: yes, persist. It matches the user's stated intent ("whatever the state of the pop-up and the thread that it is displaying should be preserved from view to view").
5. **Override file with invalid JSON** — if a user hand-edits `ai/views/<view>/settings/state.json` and breaks the syntax, the resolver should log a warning and fall back to workspace-only for that view. Must not crash. Covered by resolver's existing try/catch on read; verify in test.

---

## 14. Acceptance

- Fresh workspace: first launch creates `ai/views/settings/state.json` with hardcoded defaults. No per-view override files exist. All views render identically.
- Drag the chat column wider in code-viewer → switch to wiki-viewer → same wider chat column. Workspace file reflects the new width.
- Create `ai/views/wiki-viewer/settings/state.json` containing `{ "widths": { "leftChat": 500 } }` by hand. Restart. Wiki-viewer chat renders at 500. Code-viewer still at the workspace value. Drag wiki-viewer's chat to 550 → wiki-viewer's override file updates to 550. Code-viewer unchanged.
- Delete `widths.leftChat` from the override file (edit by hand). Restart. Wiki-viewer falls back to workspace width.
- `currentThreadId` round-trip: open thread A in code-viewer → switch to wiki-viewer → thread A is selected (unless wiki-viewer has a `currentThreadId` override).
- Invalid JSON in a per-view override file logs a warning on server, does not crash, view renders with workspace state only.
- Migration script run against current repo produces the expected files per §10; `git status` shows exactly the expected adds/deletes.
- TypeScript compiles (`tsc -b --noEmit`), client builds (`npm run build`), no runtime errors in the browser console.

---

/Users/rccurtrightjr./projects/open-robin/docs/STATE_OVERRIDE_SPEC.md
