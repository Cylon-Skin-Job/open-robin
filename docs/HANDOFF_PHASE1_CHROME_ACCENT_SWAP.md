# Handoff: Phase 1 — chrome/accent CSS variable swap

**Roadmap:** `docs/CODE_STANDARDS_CLEANUP_ROADMAP.md`
**Baseline commit:** `d369086` (working tree clean, pushed to origin/main)
**Goal:** Make `--chrome-accent` mean chrome (dim/structural) and `--accent-dim` mean accent (bright/highlighted) so code agents pick the correct variable. User experience is unchanged; only semantic naming is corrected.

---

## Context for the incoming agent

This project is `fs-dev` at `/Users/rccurtrightjr./projects/fs-dev`.
- Client: `fusion-studio-client/` (React 19 + TypeScript + Vite)
- Server: `fusion-studio-server/` (Node.js + Express + WebSocket on port 3001)
- Restart: `unset ELECTRON_RUN_AS_NODE && ~/projects/Fusion-Home/restart-fusion.sh`
- Build only: `cd fusion-studio-client && npm run build`
- Fusion-Home repo: `~/projects/Fusion-Home/` — separate git repo, separate commit required

The Calendar UI is intentionally disconnected (excluded from tsc via `tsconfig.app.json`). Do not touch that exclusion.

---

## The problem in one paragraph

The server generator (`accent-css.js`) computes two colors from the theme entry:
- `chromeAccent` — derived from `chromeLuminance`/`chromeTint` — a **tinted, highlighted** color
- `accentDim` — derived from `accentLuminance`/`accentTint` (defaults to 0 tint) — a **dim, structural gray**

It then emits them **backwards**:
- `--chrome-accent: ${chromeAccent}` → bright, tinted → used everywhere for active/highlighted states
- `--accent-dim: ${accentDim}` → dim, structural → used for nav icons, inactive labels

An agent reading `--chrome-accent` in CSS assumes "structural/nav/dim." It is actually "bright/active/highlighted." This causes every agent fix to use the wrong variable. The fix swaps the wiring so both names match their semantics.

---

## Operating rules (non-negotiable)

1. Before touching any file, read it from disk. Never work from memory.
2. Verify current line counts match this document before acting. If they differ, stop and report.
3. Do the fs-dev commit first. The Fusion-Home commit is a separate step in a separate repo.
4. Smoke test after each chunk (build must pass). Chunk 1.4 (Fusion-Home) is the only exception — no build there.
5. After all chunks, write a one-paragraph summary of what changed and what (if anything) didn't match expectations.

---

## Smoke test (run after Chunks 1.1, 1.2, 1.3 individually)

```bash
cd /Users/rccurtrightjr./projects/fs-dev/fusion-studio-client && npm run build
```

Must exit 0. No TypeScript errors.

Full visual verification (after Chunk 1.3, before 1.4):

```bash
unset ELECTRON_RUN_AS_NODE && ~/projects/Fusion-Home/restart-fusion.sh
```

Open the app. Switch to a workspace that uses the wiki-viewer. Verify:
- Active nav item has the chrome/accent color (same as before)
- Nav icons in inactive state are dim (same as before)
- Active doc-viewer tiles have the highlight color (same as before)

The visual output must be **identical** to before. If anything looks different, the generator swap is wrong.

---

## Chunk 1.1 — Swap the server generator (`accent-css.js` + `live-preview.ts`)

These two files are mirrors of each other. Both must change in the same commit.

### File 1: `fusion-studio-server/lib/theme/accent-css.js`
**Current line count:** 71 lines (verify before acting)

**Change 1 — line 21: update `pickContrastFg` to use the correct variable after the swap**

Current:
```js
  return lum > 0.55 ? 'var(--accent-dim)' : '#ffffff';
```

Replace with:
```js
  return lum > 0.55 ? 'var(--chrome-accent)' : '#ffffff';
```

Reason: `--chrome-accent-fg` is the foreground for surfaces filled with `--chrome-accent`. After the swap `--chrome-accent` holds the dim structural value, so the light-bg fallback fg should also be structural/chrome, not the bright accent.

**Change 2 — lines 60–64: swap which computed value is assigned to which CSS variable, and fix nav references**

Current:
```js
  --chrome-accent:     ${chromeAccent};
  --chrome-accent-fg:  ${chromeAccentFg};
  --cli-accent:        var(--chrome-accent);
  --tile-color:        var(--chrome-accent);
  --accent-dim:        ${accentDim};
```

Replace with:
```js
  --chrome-accent:     ${accentDim};
  --chrome-accent-fg:  ${chromeAccentFg};
  --cli-accent:        var(--accent-dim);
  --tile-color:        var(--accent-dim);
  --accent-dim:        ${chromeAccent};
```

Notes:
- `--chrome-accent` now holds the dim structural value (`accentDim`)
- `--accent-dim` now holds the bright tinted value (`chromeAccent`)
- `--cli-accent` and `--tile-color` follow the bright accent (moved to `var(--accent-dim)`)
- `--chrome-accent-fg` still emits `${chromeAccentFg}` — the value was computed from `chromeAccent` before the swap, which is now the `--accent-dim` surface. The fg remains valid (it was computed to contrast against the bright surface, which is now `--accent-dim`). No change to the computation needed.

**Change 3 — lines 51–52: fix nav to use the dim structural variable**

Current:
```js
  const navIconColor = 'var(--accent-dim)';
  const navTextColor = 'var(--accent-dim)';
```

Replace with:
```js
  const navIconColor = 'var(--chrome-accent)';
  const navTextColor = 'var(--chrome-accent)';
```

Reason: nav icons/text are structural/dim chrome elements. After the swap, `--chrome-accent` is the dim structural value, so nav should use it.

**Change 4 — line 14: update stale comment**

Current:
```js
 *    sliders carry a darker companion to a light accent, so we lean on that
 *    rather than flat black, which clashes with vibrant accents).
 */
function pickContrastFg(hex) {
```

Update the surrounding block comment (lines 12–16) to reflect that `--chrome-accent` is now the dim/structural variable:
```js
/** Pick a foreground for surfaces filled with the given hex bg.
 *  - Dark bg → white (clean on saturated darks)
 *  - Light bg → --chrome-accent (the Chrome family — dim structural companion
 *    to a bright accent; avoids flat black which clashes with vibrant accents).
 */
```

---

### File 2: `fusion-studio-client/src/lib/theme/live-preview.ts`
**Current line count:** verify before acting

This is the client-side mirror of `accent-css.js`. Apply the same logic:

**Change 1 — line 226: update fg to use `--chrome-accent`**

Current:
```ts
    root.setProperty('--chrome-accent-fg', lum > 0.55 ? 'var(--accent-dim)' : '#ffffff');
```

Replace with:
```ts
    root.setProperty('--chrome-accent-fg', lum > 0.55 ? 'var(--chrome-accent)' : '#ffffff');
```

**Change 2 — lines 217 and 231: swap the emitted variable values**

Current:
```ts
  root.setProperty('--chrome-accent', chromeAccent);
  // ... other properties ...
  root.setProperty('--accent-dim', accentDim);
```

Replace with:
```ts
  root.setProperty('--chrome-accent', accentDim);
  // ... other properties ...
  root.setProperty('--accent-dim', chromeAccent);
```

**Change 3 — lines 234–235: cli-accent and tile-color follow the bright accent**

Current:
```ts
  root.setProperty('--cli-accent', 'var(--chrome-accent)');
  root.setProperty('--tile-color', 'var(--chrome-accent)');
```

Replace with:
```ts
  root.setProperty('--cli-accent', 'var(--accent-dim)');
  root.setProperty('--tile-color', 'var(--accent-dim)');
```

**Change 4 — lines 238–239: nav uses the dim structural variable**

Current:
```ts
  root.setProperty('--nav-icon-color', 'var(--accent-dim)');
  root.setProperty('--nav-text-color', 'var(--accent-dim)');
```

Replace with:
```ts
  root.setProperty('--nav-icon-color', 'var(--chrome-accent)');
  root.setProperty('--nav-text-color', 'var(--chrome-accent)');
```

**Commit message for Chunk 1.1:**
```
refactor(theme): swap --chrome-accent/--accent-dim generator wiring — Phase 1 Chunk 1.1
```

---

## Chunk 1.2 — Swap CSS variable usage in `fs-dev` CSS files

**18 CSS files** need `--chrome-accent` ↔ `--accent-dim` swapped in their usage.
The variable `--chrome-accent-fg` is a separate derived variable — do NOT swap it.

### Exact file list and match counts (verify counts before acting)

| File | `--chrome-accent` hits | `--accent-dim` hits |
|---|---|---|
| `ai/settings/doc-viewer.css` | 4 | 4 |
| `ai/settings/file-viewer.css` | 3 | 3 |
| `fusion-studio-client/src/styles/animations.css` | 1 | 0 |
| `ai/views/doc-viewer/settings/layout.css` | 4 | 3 |
| `fusion-studio-client/src/components/capture/FilePageView.css` | 2 | 2 |
| `fusion-studio-client/src/components/Fusion/fusion.css` | verify | verify |
| `ai/settings/office-viewer.css` | 4 | 4 |
| `fusion-studio-client/src/components/office/OfficeDocumentPage.css` | verify | verify |
| `fusion-studio-client/src/components/WorkspaceRibbon.css` | verify | verify |
| `fusion-studio-client/src/components/App.css` | verify | verify |
| `fusion-studio-client/src/components/office/OfficeDocumentTile.css` | verify | verify |
| `fusion-studio-client/src/components/calendar/CalendarViewer.css` | verify | verify |
| `fusion-studio-client/src/components/office/OfficeGrid.css` | verify | verify |
| `ai/settings/themes.css` | verify | verify |
| `fusion-studio-client/src/components/WorkspaceSwitcher.css` | verify | verify |
| `ai/views/wiki-viewer/settings/layout.css` | verify | verify |
| `fusion-studio-client/src/components/hover-icon-modal/HoverIconModal.css` | verify | verify |
| `ai/settings/views.css` | verify | verify |

**Method:** For each file, read it, then do a two-pass replace:
1. First pass: `--chrome-accent` (excluding `--chrome-accent-fg`) → `--CHROME_ACCENT_TEMP` (temporary sentinel)
2. Second pass: `--accent-dim` → `--chrome-accent`
3. Third pass: `--CHROME_ACCENT_TEMP` → `--accent-dim`

This three-pass approach avoids collisions when both strings appear in the same file.

**Exception — `ai/settings/themes.css`:** This file is generated by the server from `themes.json`. After Chunk 1.1 changes the generator, re-run the theme generation to refresh this file. Do not hand-edit it. If you cannot trigger generation, note it and skip — it will be regenerated on the next server startup.

**Commit message for Chunk 1.2:**
```
refactor(theme): swap --chrome-accent/--accent-dim usage in fs-dev CSS — Phase 1 Chunk 1.2
```

---

## Chunk 1.3 — Swap in TypeScript/TSX files + fix catalog-visual semantic

**5 TypeScript files** need updates. Slider key names (`chromeLuminance`, `accentTint`, etc.) are **not** part of this swap — they stay. Only CSS variable name strings change.

### `fusion-studio-client/src/lib/milkdown-span-style.ts`

Lines 265 and 270 use `--accent-dim` for stat display numbers. After the swap `--accent-dim` is the bright accent — which is fine for "stands out" numeric values. No change needed. Verify visually.

### `fusion-studio-client/src/lib/catalog-visual.ts`

Lines 100–107 use `--chrome-accent` for tool icons/labels described as "actionable." After the swap `--chrome-accent` is dim structural — tool icons would become invisible/dim. These lines must be updated to use `--accent-dim` (the new bright accent).

Current (approximately lines 100–107):
```ts
  iconColor: 'var(--chrome-accent, var(--text-dim))',
  labelColor: 'var(--chrome-accent, var(--text-dim))',
  contentColor: 'var(--chrome-accent, var(--text-dim))',
```

Replace with:
```ts
  iconColor: 'var(--accent-dim, var(--text-dim))',
  labelColor: 'var(--accent-dim, var(--text-dim))',
  contentColor: 'var(--accent-dim, var(--text-dim))',
```

### `fusion-studio-client/src/lib/theme/live-preview.ts`

Already handled in Chunk 1.1.

### `fusion-studio-client/src/types/index.ts`

Line 168 has a comment: `// When true, user chat bubble bg uses --chrome-accent`. After the swap `--chrome-accent` is dim structural — chat bubble chrome mode uses the dim color. Update the comment:
```ts
  chatBubbleChrome?: boolean; // When true, user chat bubble bg uses --chrome-accent (dim structural chrome color)
```

### `fusion-studio-client/src/lib/theme/live-preview.ts` (line 27)

The `PREVIEW_VARS` array on line 27 lists `'--chrome-accent', '--chrome-accent-fg', '--icon-dim', '--accent-dim'`. These are the CSS variable names being previewed — they stay the same (the variables still exist, just with swapped values). No change needed here.

**After Chunk 1.3, run the full visual smoke test** (Electron launch) before proceeding to Fusion-Home.

**Commit message for Chunk 1.3:**
```
refactor(theme): swap --chrome-accent/--accent-dim in TS files + fix catalog-visual — Phase 1 Chunk 1.3
```

---

## Chunk 1.4 — Fusion-Home CSS swap (separate repo, separate commit)

**24 CSS files** in `/Users/rccurtrightjr./projects/Fusion-Home/`.

```
ai/settings/themes.css                                         (generated — skip, see note)
ai/settings/views.css
ai/settings/office-viewer.css
ai/settings/file-viewer.css
ai/views/office-viewer/settings/layout.css
ai/views/wiki-viewer/settings/layout.css
workspace-templates/project-repo/ai/settings/themes.css       (generated — skip)
workspace-templates/project-repo/ai/settings/views.css
workspace-templates/project-repo/ai/settings/office-viewer.css
workspace-templates/project-repo/ai/settings/file-viewer.css
workspace-templates/project-repo/ai/views/wiki-viewer/settings/layout.css
workspace-templates/project-repo/ai/views/office-viewer/settings/layout.css
workspace-templates/media-studio/ai/settings/themes.css       (generated — skip)
workspace-templates/media-studio/ai/settings/views.css
workspace-templates/media-studio/ai/settings/office-viewer.css
workspace-templates/media-studio/ai/settings/file-viewer.css
workspace-templates/media-studio/ai/views/wiki-viewer/settings/layout.css
workspace-templates/media-studio/ai/views/office-viewer/settings/layout.css
workspace-templates/fusion-home/ai/settings/themes.css        (generated — skip)
workspace-templates/fusion-home/ai/settings/views.css
workspace-templates/fusion-home/ai/settings/office-viewer.css
workspace-templates/fusion-home/ai/settings/file-viewer.css
workspace-templates/fusion-home/ai/views/wiki-viewer/settings/layout.css
workspace-templates/fusion-home/ai/views/office-viewer/settings/layout.css
```

**Note on `themes.css` files:** There are 4 `themes.css` files marked as generated. Each is generated by the server from `themes.json`. After Chunk 1.1 changes the generator, these regenerate on the next server start. Skip them in the hand-edit pass. If they happen to have been hand-edited or differ from the expected generated output, flag and stop.

**Method:** Same three-pass sentinel approach as Chunk 1.2.

**Commit message for Chunk 1.4 (in Fusion-Home repo):**
```
refactor(theme): swap --chrome-accent/--accent-dim usage — Phase 1 Chunk 1.4
```

---

## Chunk 1.5 — Update `themes-and-state/PAGE.md`

**File:** `ai/views/wiki-viewer/content/enforcement/themes-and-state/PAGE.md`

Update the **Semantic Variable Reference** table (currently around line 82–92) to reflect the corrected semantics:

| Element type | Variable | What the slider controls |
|---|---|---|
| Section titles, active labels, primary buttons, selected states | `--accent-dim` | `accentLuminance` / `accentTint` |
| Inactive icons, secondary badges, dimmed chrome | `--chrome-accent` | `chromeLuminance` / `chromeTint` |

And update the **Common Mistakes** row:
```
Using `--theme-primary` for UI chrome → use `--accent-dim` for active/primary chrome,
`--chrome-accent` for inactive/secondary chrome
```

Also update the LOG.md to add a dated entry.

**Commit message for Chunk 1.5:**
```
docs(wiki): update themes-and-state semantic reference — Phase 1 Chunk 1.5
```

---

## Chunk 1.6 — Fix `themes.css` stubs (both repos)

Both `fs-dev/ai/views/wiki-viewer/settings/themes.css` and `Fusion-Home/ai/views/wiki-viewer/settings/themes.css` contain:

```css
:root { --text-primary: red; }
```

This is a stale placeholder. It is harmless at runtime (scoped to `[data-panel="wiki-viewer"] :root` which never matches via `scopePanelCss`), but confusing and wrong. Replace both with:

```css
/*
 * wiki-viewer per-view theme override.
 * ai/views/wiki-viewer/settings/themes.css
 *
 * Loaded at runtime by useSharedWorkspaceStyles and scoped to
 * [data-panel="wiki-viewer"]. Only add rules here that must override
 * the global workspace theme specifically for this view.
 * Human-only: AI agents must not write to per-view themes.css files.
 */
```

**Commit message (fs-dev):**
```
chore(wiki): replace themes.css red stub with proper placeholder — Phase 1 Chunk 1.6
```

**Commit message (Fusion-Home):**
```
chore(wiki): replace themes.css red stub with proper placeholder — Phase 1 Chunk 1.6
```

---

## Exit gate for Phase 1

After all 6 chunks:

```bash
cd /Users/rccurtrightjr./projects/fs-dev && git log --oneline -8
```

Expected top 6: one commit per chunk (1.1–1.3, 1.5, 1.6 in fs-dev), plus baseline.

```bash
cd fusion-studio-client && npm run build
```

Must exit 0.

```bash
git status
```

Must be clean.

Then in `~/projects/Fusion-Home/`:

```bash
git log --oneline -3
git status
```

Expected: 2 commits (1.4 and 1.6 for Fusion-Home), clean tree.

---

## What Phase 2 needs from Phase 1

Phase 2 (bare hex → CSS token replacement) uses `--accent-dim` for active/highlighted elements and `--chrome-accent` for structural/dim elements. Phase 1 must be complete and approved before Phase 2 starts, or every new variable reference written in Phase 2 will carry the old wrong semantics.

**Approval process:**
1. Agent posts a 6-bullet summary (one per chunk) including visual smoke test result.
2. Project owner reviews in a new session.
3. Phase 2 handoff document is generated at the start of the Phase 2 session.
