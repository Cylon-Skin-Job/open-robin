# Code Standards Cleanup Roadmap

**Source rule:** `ai/views/wiki-viewer/content/enforcement/code-standards/PAGE.md`
**Baseline commit:** `cf1982e` (checkpoint of 8 days of multi-session work, 2026-05-18)
**Status when this roadmap was authored:** build green, server boots, Electron launches, calendar UI intentionally disconnected.

This roadmap converts the violations identified in the 2026-05-18 audit into ordered chunks. Order is chosen so mechanical, low-risk work lands before any architectural change — each chunk is small enough to revert if a smoke test fails.

---

## 0. Operating Procedure (applies to every chunk)

Every chunk follows the same loop. **Do not skip steps; do not collapse two chunks into one.**

### 0.1 Before starting a chunk

1. `git status` — working tree must be clean (commit or stash anything pending).
2. Record the baseline commit hash; the chunk's exit gate is "tree clean again, one new commit on top."
3. Read the file list in the chunk. For every file listed, run `git log -1 --pretty=fuller -- <file>` and `cat <file> | wc -l`. Numbers and line counts in this roadmap were captured at commit `cf1982e`; if they don't match, the codebase has drifted and this chunk needs re-scoping before action.
4. If the chunk has a **Research** section, do that research first and write the answers as a comment block at the top of the chunk's first commit. Do not start editing files before research is complete.

### 0.2 During the chunk

- Touch only the files named in the chunk's "Files in scope" list.
- For every file edited, before-state must come from `git show HEAD:<path>` (or a Read at the start), not from memory. **Do not invent prior content.**
- Commits are atomic per logical sub-step; small commits within a chunk are fine, but the chunk ends with all of them landed.

### 0.3 Smoke test (every chunk ends with this)

Mandatory minimum smoke for all chunks:

```bash
# 1. Type + bundle
cd fusion-studio-client && npm run build

# 2. Restart full stack
unset ELECTRON_RUN_AS_NODE
~/projects/Fusion-Home/restart-fusion.sh

# 3. Manual check (≤90s)
#   a. Electron window opens to Fusion Home
#   b. Switch to fs-dev workspace
#   c. Click through 3 panels (e.g. doc-viewer, file-viewer, wiki-viewer)
#   d. No console errors in DevTools (DOM warnings ok if pre-existing)
```

Chunks that touch CSS add one more step:

> e. Open the same flow against Fusion Home AND fs-dev, and visually confirm no surface lost its styling (header chrome, sidebar, panel backgrounds, modal overlays).

If anything in the smoke test breaks, the chunk is reverted: `git reset --hard <baseline>` and the chunk gets re-scoped. Do not push half-done chunks forward.

---

## 1. Two-Layered Source Reality (CSS in particular)

This codebase has two CSS sources, and many cleanup chunks touch both. Internalize this before Phase 1:

| Layer | Where | What it owns |
|---|---|---|
| **App layer** | `fusion-studio-client/src/**/*.css` | Component-local styles, the shared `styles/variables.css`, the global `App.css`, the global `index.css` |
| **Project layer** | `~/projects/Fusion-Home/ai/settings/*.css` and `~/projects/fs-dev/ai/settings/*.css` | Per-workspace theme overrides, view-specific stylesheets injected at runtime by `useSharedWorkspaceStyles` |

The runtime stack loads project-layer CSS *after* app-layer CSS, so project CSS wins on the cascade.

**Implication for cleanup:** when a hardcoded color or spacing value is replaced with `var(--token, fallback)`, the token must exist in the app layer **and** must not be overridden to a different value in a project layer. A token replacement done only in the app layer will silently be defeated by a hardcoded override in `ai/settings/themes.css` or `ai/settings/views.css`.

> **Scope note from project owner (2026-05-18):** only **Fusion Home** and **fs-dev** are real workspaces. Every other workspace (media-studio, project-repo, etc.) is a stub. Cleanup work needs to align tokens across **those two** project folders only; other workspace folders can stay as-is for now.

Every CSS chunk's research step includes:
- List the tokens involved.
- For each token, grep both project folders (`~/projects/Fusion-Home/ai/settings/` and `~/projects/fs-dev/ai/settings/`) and confirm consistent definitions.
- If a token is missing from a project folder, decide: add it, or use the app-layer fallback.

---

## 2. The Phases

| Phase | Name | Risk | Touches project CSS? | Approximate chunks |
|---|---|---|---|---|
| 0 | Session debris cleanup | Trivial | No | 5 small commits ✅ done |
| 1 | `--chrome-accent` / `--accent-dim` semantic swap | Low–Medium | **Yes (both repos)** | 6 chunks |
| 2 | Hardcoded value extraction (CSS variables) | Low | **Yes** | 5 chunks |
| 3 | `.rv-` class prefix migration | Low–Medium | Yes (class names rendered in CSS) | 5 chunks |
| 4 | Inline-style extraction | Low | No | 3 chunks |
| 5 | `App.css` decomposition | **Medium-High** | Yes | 5 chunks |
| 6 | Dead-code purge | Trivial | No | 1 chunk |
| 7 | File-size splits (>400 lines) | Medium per file | No | 10 chunks |
| 8 | Component → state-layer architecture decision | **High; needs decision first** | No | TBD, blocked on decision |

Phases run in numerical order. Phase 1 (variable swap) must land before Phase 2 (hex extraction) because Phase 2 uses these variable names as replacement targets — wrong names during Phase 2 would re-embed the confusion in every new `var(...)` call. Phase 5 must come after Phases 2–4 because moving rules out of `App.css` is much safer once those rules already use tokens, are `.rv-`-prefixed, and have no inline-style competitors.

---

## Phase 0 — Session Debris Cleanup

**Goal:** delete the artifacts the 2026-05-18 session left behind, so subsequent chunks start from a tidy tree.

### Chunk 0.1 — Restore deleted-not-commented hygiene in calendar files

The previous session intentionally commented out two `fetchEventsForMonth` references plus the `useEffect` that called them. Per "Delete, don't deprecate," these should be deleted outright.

**Files in scope:**
- `fusion-studio-client/src/components/calendar/CalendarMonthView.tsx`
- `fusion-studio-client/src/components/calendar/CalendarViewer.tsx`

**Actions:**
- Delete the commented-out `fetchEventsForMonth` destructure line.
- Delete the commented-out `useEffect` block that calls it.
- Delete the `FIXME(calendar-store-refactor)` comments (the calendar folder is excluded from tsc; nobody is going to follow these breadcrumbs except future-you, and git history is the breadcrumb).

**Research:** none.

**Smoke test:** standard. Calendar is still disconnected at the router level, so no visual regression expected.

### Chunk 0.2 — Clean `ContentArea.tsx` comment block

`ContentArea.tsx` currently has a 4-line comment plus a commented-out import line for `CalendarViewer`. Replace with a single-line note and remove the commented import per the "Delete, don't deprecate" rule.

**Files in scope:**
- `fusion-studio-client/src/components/ContentArea.tsx`

**Actions:** keep one short comment near the `CONTENT_COMPONENTS` map (`// calendar-viewer falls through until the new data layer lands`). Delete the commented import statement.

**Research:** none.

**Smoke test:** standard.

### Chunk 0.3 — Delete stray scratch file

**Files in scope:**
- `fusion-studio-client/electron/main.cjs.new` (54-line stub from a prior agent's failed write)

**Actions:** `git rm fusion-studio-client/electron/main.cjs.new`. Verify `main.cjs` is intact (633 lines, all 10 expected `ipcMain.handle(...)` entries present).

**Research:** none.

**Smoke test:** standard.

### Chunk 0.4 — Move or remove agent session artifacts

**Files in scope:**
- `SESSION_INCIDENT_REPORT.md`
- `CALENDAR_DEBUG_REPORT.md`

**Actions:** the project owner picks one of:
- (a) `git rm` both (preserves nothing; git history still has them via `cf1982e`).
- (b) `git mv` both to `docs/agent-sessions/` for posterity.

Default if no decision: (b).

**Research:** none.

**Smoke test:** standard.

### Chunk 0.5 — Untrack `wire-debug.log.old` and tighten gitignore

`*.log` is already in `.gitignore`, but `.log.old` does not match that glob, so `wire-debug.log.old` slipped into history. It's a log file; it should not be tracked.

**Files in scope:**
- `.gitignore`
- `fusion-studio-server/wire-debug.log.old`

**Actions:**
- Add `*.log.old` and `wire-debug.log*` to `.gitignore`.
- `git rm --cached fusion-studio-server/wire-debug.log.old`.

**Research:** check if any tooling (CI? grep scripts?) references the `.old` log file. Likely no.

**Smoke test:** standard.

---

## Phase 1 — Hardcoded CSS Value Extraction

**Goal:** every value in component CSS traces back to a CSS variable.

**Inventory at baseline:**
- ~402 hardcoded hex colors across 20 CSS files
- 12 hardcoded `z-index` values across 4 CSS files
- An unknown count of hardcoded spacing values (px on margin/padding/gap)

### Research — required before any Phase 1 chunk

Before Phase 1 starts, produce a short doc (3-5 pages, can live at `docs/CSS_TOKEN_MAP.md`) that answers:

1. **What tokens exist?** Grep `styles/variables.css` and any `:root { ... }` block in `App.css`, `index.css`. List every `--*` definition.
2. **What tokens are referenced?** Grep `var(--` across `fusion-studio-client/src/**/*.css`. Categorize: palette, bg, text, space, z-index, shadow, transition, other.
3. **Where do tokens get overridden?** Grep `ai/settings/themes.css` and `ai/settings/views.css` in **both** Fusion Home and fs-dev project folders. Flag any token whose value differs across the two projects — those are tokens the cleanup must touch carefully.
4. **What's missing?** Compare the hardcoded values found in the audit (e.g. lots of distinct hexes in `Fusion/fusion.css`, `--space-*` apparently absent per the existing migration spec 17) to the existing token set. List the gaps and propose names.

Output of research is a token map: hardcoded value → proposed token name → which project layer(s) need to define it.

### Chunk 1.1 — z-index → `--z-*`

**Files in scope:**
- `fusion-studio-client/src/components/App.css` (lines 288, 896, 935, 966, 1220)
- `fusion-studio-client/src/components/calendar/CalendarViewer.css` (lines 221, 280, 477, 510) — note: file is in excluded folder, but stylesheets are still loaded by anything that imports them; verify nothing imports this CSS post Phase 0.4, otherwise defer
- `fusion-studio-client/src/components/office/OfficeDocumentPage.css` (lines 472, 488)
- `fusion-studio-client/src/components/office/OfficeDocumentTile.css` (line 66)

**Research:** existing migration spec `15-css-zindex-standardization.md` already enumerates collisions. Read that spec first; this chunk may already have a complete plan.

**Actions:** replace each numeric `z-index: N` with `z-index: var(--z-<layer-name>, N)`. The fallback preserves current behavior in case the token isn't defined in a given project.

**Smoke test:** standard, plus: modal overlays must still render above the panel they occlude; sidebar drawers still over the content area.

### Chunk 1.2 — `fusion.css` hex extraction (110 instances)

**Files in scope:**
- `fusion-studio-client/src/components/Fusion/fusion.css`
- Possibly `ai/settings/themes.css` in Fusion Home and fs-dev (to add tokens if missing)

**Research:** which hexes are unique theme colors vs. duplicates of existing palette tokens. Group the 110 by hex value first; you may discover only 15-20 distinct colors.

**Actions:** for each distinct hex, either replace with an existing palette token or add a new token in the appropriate project's `themes.css`. Always use `var(--token, #hex-fallback)` so the project-layer override still works.

**Smoke test:** standard + open the FusionOverlay UI (theme picker, CLI picker, secrets) on **both** Fusion Home and fs-dev. Confirm no color shift.

### Chunk 1.3 — `App.css` hex extraction (57 instances)

**Files in scope:**
- `fusion-studio-client/src/components/App.css`

**Research:** same grouping as 1.2.

**Smoke test:** standard + every workspace tab; App.css feeds the global chrome.

### Chunk 1.4 — Remaining component CSS hex extraction (long tail)

**Files in scope (in order of magnitude):**
- `fusion-studio-client/src/styles/document.css` (37)
- `fusion-studio-client/src/components/office/OfficeDocumentPage.css` (23)
- `fusion-studio-client/src/components/Modal/modal.css` (22)
- `fusion-studio-client/src/components/agents/prompt-cards.css` (20)
- `fusion-studio-client/src/components/office/OfficeDocumentTile.css` (19)
- everything below 15 instances grouped into one mop-up commit

**Research:** confirm `styles/variables.css` doesn't itself hardcode anything that should be a derived value.

**Smoke test:** standard + the specific surfaces touched (modals, agent prompt cards, office tiles).

### Chunk 1.5 — Spacing tokens

The page says `--space-xs|sm|md|lg`. Existing migration spec 17 notes 38 hardcoded values and no scale defined yet.

**Research:** does `--space-*` exist anywhere today? If not, this chunk's first commit defines the scale in `styles/variables.css`. Then sweep:
- `padding: 8px` → `padding: var(--space-sm, 8px)`
- `gap: 12px` → `gap: var(--space-md, 12px)`
- etc.

**Files in scope:** all `.css` under `fusion-studio-client/src/**` and the two project `themes.css` files if scale needs to be project-overridable.

**Smoke test:** standard + spot-check density of every panel.

---

## Phase 2 — `.rv-` Class Prefix Migration

**Goal:** every class definition and consumer is prefixed.

**Inventory at baseline:**
- ~286 of ~1059 CSS class rules unprefixed (~27% unprefixed)
- Heaviest offenders: `App.css` (164 unprefixed), `Fusion/fusion.css` (61), `styles/document.css` (48)

**Research — required before Phase 2 starts:**

1. Confirm the canonical prefix is **exactly `.rv-`** (the audit and migration spec 18 both use it). No `.rb-`, no `.fs-`, no `.fusion-` floating around.
2. Confirm there is no `querySelector('.unprefixed-name')` consumer (existing audit gotcha note in spec 18: "querySelector gotcha"). Grep `querySelector` and `getElementsByClassName` across the entire codebase.
3. Confirm runtime project CSS does not target unprefixed classes either (grep the two project folders).

If research turns up runtime querySelector consumers, **each consumer must be updated in lockstep with the CSS rename**. That's the whole reason this is a 5-chunk phase, not a single sweep.

### Chunk 2.1 — `App.css` prefix (164 rules)

**Files in scope:**
- `fusion-studio-client/src/components/App.css`
- Every `.tsx` that uses an unprefixed class found in App.css (large fan-out; expect ~20 components)

**Actions:** rename CSS rule, find every `className=` that references the old name, rename those too. Atomic per rule.

**Smoke test:** standard + every workspace + every modal + sidebar collapse/expand.

### Chunk 2.2 — `Fusion/fusion.css` prefix (61 rules)

**Files in scope:** `fusion.css` and Fusion components.

### Chunk 2.3 — `styles/document.css` prefix (48 rules)

**Files in scope:** `document.css` and consumers (markdown rendering, doc-viewer tiles, FilePageView).

### Chunk 2.4 — Remaining stylesheets (long tail)

**Files in scope:** any CSS file with ≥1 unprefixed rule not covered above.

### Chunk 2.5 — Lint guard

Add an ESLint or stylelint rule that fails the build if a new unprefixed class is introduced. Stylelint with `selector-class-pattern: ^rv-` is the standard option.

**Research:** is stylelint already a dep? If not, the chunk includes adding it.

**Smoke test:** intentionally introduce an unprefixed class in a scratch branch and confirm the lint fails. Revert.

---

## Phase 3 — Inline-Style Extraction

**Goal:** zero `style={{}}` in JSX (except for legitimate dynamic values that can't be class-driven — those become CSS custom properties on the element).

**Inventory at baseline:** ~65 occurrences across 30 components. Heaviest: `ToolCallBlock.tsx` (7), `EmojiTrigger.tsx` (5), `Fusion/ThemeDetail.tsx` (5).

**Research — required before Phase 3:**

1. Categorize the 65 instances. Most fall into:
   - **Static**: pure constants like `style={{ marginBottom: 16 }}` — easy class move.
   - **Dynamic value**: derived from state, e.g. `style={{ width: `${pct}%` }}` — keep on element but as a CSS custom property (`style={{ ['--bar-width' as any]: `${pct}%` }}`) and consume via `width: var(--bar-width)` in CSS.
   - **Dynamic toggle**: visibility/transform on hover — should become a class toggle.

2. Confirm Phase 1.5 (spacing tokens) is complete; otherwise static spacing values can't be extracted properly.

### Chunk 3.1 — Top offenders

**Files in scope:**
- `ToolCallBlock.tsx` (7)
- `EmojiTrigger.tsx` (5) — note: this file is also >400 lines and a Phase 6 candidate; do inline-style extraction now, split later
- `Fusion/ThemeDetail.tsx` (5)
- `FolderNode.tsx` (3)
- `KittVisualizer.tsx` (3)

**Smoke test:** standard + the specific UIs (tool-call rendering, emoji picker, theme detail panel, file tree).

### Chunk 3.2 — Mid offenders

Files with 2 occurrences each (10 files). Single commit.

### Chunk 3.3 — Long tail

Files with 1 occurrence each (~15 files). Single commit.

---

## Phase 4 — `App.css` Decomposition

**Goal:** the global `App.css` shrinks to just genuinely-global rules (reset, root vars, html/body). Component-specific rules move to component CSS files.

**Why this comes after Phases 1-3:** moving a rule is far safer once it already uses tokens (Phase 1), is prefixed (Phase 2), and has no inline-style overrides (Phase 3). Moving rules first creates a long tail of "do I move the inline style too" decisions that double the work.

**Inventory:** `App.css` is 1900 lines, ~264 class rules. Many target specific components.

**Research — required before Phase 4:**

1. Generate a mapping: `App.css` class → component(s) that consume it. Methodology:
   - Extract each class name from `App.css`.
   - Grep each across `src/**/*.tsx`. Note every consumer.
   - For each class, decide: (a) genuinely global (e.g. `.rv-app-container`, `.rv-header`), stays; (b) belongs to a single component, move to that component's CSS; (c) shared by 2-3 unrelated components, extract to a small shared stylesheet (e.g. `styles/chrome.css`).
2. List the components without a CSS file today. Phase 4 may need to create new CSS files for them.

**Project CSS interaction:** `App.css` rules can be overridden by `ai/settings/views.css`. Moving rules to component CSS without updating the project-layer overrides means project overrides stop working. The research step has to flag any class currently overridden in either project folder.

### Chunk 4.1 — WorkspaceRibbon, Sidebar, header chrome

Move rules clearly belonging to `WorkspaceRibbon`, `Sidebar`, and the top header into their own CSS files (or `Sidebar.css` if it doesn't exist — create).

### Chunk 4.2 — Modal / overlay rules

Move modal-positioning, overlay-z-index, and backdrop rules into `Modal/modal.css`.

### Chunk 4.3 — Panel-shell rules

Rules that style the panel container (resize handles, panel headers, content padding) into their owning components.

### Chunk 4.4 — Remaining single-owner rules

Mop-up pass for rules with one obvious owner.

### Chunk 4.5 — Reconciliation with project overrides

For every class moved, confirm `ai/settings/views.css` (Fusion Home and fs-dev) doesn't re-target it under the old global selector path. Adjust overrides to target the new component selector.

**Smoke test for every Phase 4 chunk:** every workspace, every panel, every modal. This is the highest-risk phase visually.

---

## Phase 5 — Dead-Code Purge

**Goal:** zero `_unused`, `// removed`, `@deprecated`, and triage of `TODO`/`FIXME`/`HACK`.

**Inventory at baseline:** 15 files with markers; concentrated in `lib/catalog-visual.ts` (7), `lib/tool-renderers/index.ts` (4), `lib/catalog.ts` (4).

### Chunk 5.1

Triage each marker:
- If it's a one-line "future intent" note that has aged out → delete it.
- If it's a real TODO with no owner → file a ticket, then delete the comment.
- If it's a `HACK` documenting a real workaround → keep, but rename to `NOTE:` since "Delete, don't deprecate" is about dead code, not about commentary.

**Files in scope:** the 15 files identified in the audit.

**Smoke test:** standard.

---

## Phase 6 — File-Size Splits

**Goal:** every source file under 400 lines or carrying an explicit "no-split" justification at the top.

The existing migration list already enumerates some of these. The roadmap below shows current state vs. existing spec coverage, and flags new offenders.

| Lines | File | Existing spec? | Chunk |
|---|---|---|---|
| 1040 | `state/panelStore.ts` | Spec 20 says "Zustand pattern is standard" | 6.1 — re-evaluate exemption |
| 963 | `components/office/OfficeDocumentPage.tsx` | No | 6.2 |
| 712 | `lib/ws/client-message-router.js` | Spec 01f exists | 6.3 — follow spec 01f |
| 633 | `electron/main.cjs` | No | 6.4 |
| 591 | `components/ChatArea.tsx` | No | 6.5 |
| 579 | `fusion-studio-server/server.js` | Spec 01 (do LAST) | 6.10 — deferred to end |
| 524 | `components/Sidebar.tsx` | No | 6.6 |
| 494 | `lib/thread/thread-crud.js` | Spec 03/04 | 6.7 — follow specs |
| 494 | `lib/file-explorer.js` | No | 6.8 |
| 436 | `lib/harness/clis/qwen/index.js` | Spec 10 | 6.9 — follow spec 10 |
| 434 | `lib/harness/compat.js` | Spec 11 | 6.9 — follow spec 11 (paired) |
| 420 | `types/index.ts` | No | 6.11 — split by domain |
| 418 | `emojis/EmojiTrigger.tsx` | No | 6.12 |
| 408 | `lib/harness/clis/gemini/index.js` | Spec 14 | 6.9 — follow spec 14 (paired with qwen/compat) |

### Chunk 6.1 — `panelStore.ts` re-evaluation

**Research:** read spec 20 fully. The exemption may apply to small stores; 1040 lines is well past that. Confirm.

**Actions:** if the file genuinely does more than panel state (e.g. message queue, harness routing, view-state), split by sub-concern. Likely outcome: `panelStore.ts` becomes 400-line shell + 2-3 sub-stores.

**Smoke test:** every panel selection flow, harness switching, view-state restore.

### Chunk 6.2 — `OfficeDocumentPage.tsx`

**Research:** read the file end-to-end. Identify the natural seams (toolbar / editor body / save pipeline / export integration / version history).

**Actions:** extract per seam into sibling files (`OfficeDocumentToolbar.tsx`, `OfficeDocumentSavePipeline.ts`, etc.).

**Smoke test:** open a document, edit, save, export, reload.

### Chunk 6.3 — `client-message-router.js`

Follow spec `01f-server-js-extract-client-message-router.md`. Treat that spec as the source; this chunk just executes it.

### Chunk 6.4 — `electron/main.cjs`

**Research:** group the 10 `ipcMain.handle` calls by domain (capture, export, calendar, document IO). Identify whether any helpers (`runJxa`, `runSwift`) are shared.

**Actions:** extract each domain into its own `.cjs` file under `electron/` (matching the existing `electron/export/` pattern). `main.cjs` becomes the window/menu bootstrap + thin includes of each domain.

**Smoke test:** every Electron-only flow — screenshot capture, document export, calendar IPC (even though UI is disconnected, the IPC handlers should still be reachable from DevTools).

### Chunk 6.5 — `ChatArea.tsx`

**Research:** identify what jobs this 591-line component does. Common split: message list, composer, attachments, action toolbar.

**Smoke test:** chat in `fs-dev` and Fusion Home; send a message, send a tool, attach a file.

### Chunk 6.6 — `Sidebar.tsx`

**Research:** identify jobs (tab buttons, panel children, drag-reorder, secondary actions).

**Smoke test:** sidebar interactions on both workspaces.

### Chunk 6.7 — `thread-crud.js`

Follow spec 03/04. Pair with `thread-ws-handler-split` if scope overlaps.

### Chunk 6.8 — `file-explorer.js` (server)

**Research:** distinguish read operations (tree walk, content read) from mutation operations (rename, create, delete). Split accordingly.

### Chunk 6.9 — Harness extraction (qwen + gemini + compat)

Single chunk that follows specs 10, 14, and 11 in lockstep, because the audit found qwen and gemini are 95% identical with subtle 5% differences. Doing them together prevents the "extract base, regret it" pattern.

### Chunk 6.10 — `server.js`

Follow spec 01 (do LAST per the migration list).

### Chunk 6.11 — `types/index.ts`

**Research:** group the type exports by domain. 420 lines of types is fine in a single file *if* it's one job. If it's a hub for unrelated domains, split.

### Chunk 6.12 — `EmojiTrigger.tsx`

**Research:** is this trigger + picker UI + selection logic + categorization all in one? If yes, split by concern.

---

## Phase 7 — Component → State Layer (Architecture Decision Required)

**Status:** blocked on a decision; do not start without it.

**The conflict:** the code-standards page says under "Dependency Rules":
> COMPONENT must NOT: controllers, services, **state**, network

But the page's own "No Action Required" list says:
> State store decoupling — Zustand pattern is standard

44 components today import directly from `state/*`. Either the dependency rule needs amending to "components may read Zustand state via selectors but must not orchestrate," or the 44 components need a container/presentational split.

### Required decision before any Phase 7 chunk

The project owner picks one of:

1. **Amend the rule.** Document that components may use Zustand selectors for reads and `engine.enqueue(...)` for writes. This codifies what the codebase already does. Adds a single sentence to the dependency table.
2. **Enforce the rule strictly.** Every component grows a parent "container" that owns the Zustand subscription and passes data via props. 44 files plus their parents. Major refactor.
3. **Hybrid.** Pure leaf components (display-only) must use props. Container/orchestrator components (like `App`, `WorkspaceRibbon`, `OfficeDocumentPage`) may use Zustand. Define which is which.

This decision determines whether Phase 7 is one comment in PAGE.md or 50+ extracted container files. Do not pick by default.

### If decision is (1): one chunk

Update `ai/views/wiki-viewer/content/enforcement/code-standards/PAGE.md` and `LOG.md`. Nothing else changes.

### If decision is (2) or (3): future scoping pass

Re-audit. New chunk list to be authored after the decision lands.

---

## 3. Risk Register

| Risk | Where | Mitigation |
|---|---|---|
| CSS token swap defeated by project-layer override | Phase 1, all chunks | Mandatory grep of both project `ai/settings/` folders before token introduction |
| Class rename misses a `querySelector` consumer | Phase 2 | Mandatory `querySelector` / `getElementsByClassName` grep in research step |
| App.css rule move loses an override that lived only in project CSS | Phase 4.5 | Dedicated reconciliation chunk; not optional |
| File split breaks an importer's path | Phase 6 | After every split, `grep -r "from '...'" fusion-studio-client fusion-studio-server` for the old path |
| Architecture rule re-interpretation causes premature refactor | Phase 7 | Decision-gate; do not skip |
| Agent invents prior file content instead of reading from disk/git | Every phase | Op procedure §0.2: before-state must come from `git show HEAD:<path>` or a Read tool call, never from memory |

---

## 4. Out of Scope

- The 54 spec markdown files over 400 lines. Specs are documentation; the size guidance is about code.
- Other workspaces (media-studio, project-repo, etc.) — stubs per project owner; align cleanup to Fusion Home + fs-dev only.
- The 3.3 MB main JS bundle warning. Code-splitting is a separate performance concern.
- The `[state:get] failed: SyntaxError` runtime error visible in server logs. Pre-existing JSON corruption in a view-state seed file; not a standards violation, file a ticket.
- Reconnecting the Calendar UI. Separate effort with its own data-layer design discussion.

---

## 5. Suggested Execution Cadence

One phase per session. Within a phase, one chunk per sub-session, smoke-tested and committed before moving on. If a phase takes more than 3 chunks of context, hand off via a `docs/HANDOFF_PHASE_*.md`-style document (same convention as the office editor work).

The phases ordered low-to-high risk so that abandoning the roadmap halfway still leaves the codebase in a strictly improved state.
