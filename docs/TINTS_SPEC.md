# Surface Tint Toggles — Spec

**Status:** Draft — ready for handoff.
**Owner:** Open Robin core.
**Extends:** `docs/STATE_OVERRIDE_SPEC.md` — adds a new top-level `tints` key to the state shape; uses the same workspace-default + per-view override paradigm.
**Related:** `project_theming_architecture.md` (memory) — source of `--ws-primary`, `--theme-primary`, `--theme-border`.
**Code standards:** `ai/views/wiki-viewer/content/enforcement/code-standards/PAGE.md`.

---

## 1. Purpose

Make theme-accent tinting on panel chrome, cards, and borders user-controllable. Default to the neutral-grey paradigm that the code-viewer file tree already uses (no accent tint). Let the user opt in per surface, workspace-wide or per view.

**Today:** wiki topic rows and issues ticket cards are accent-tinted out of the box. The rest of the chrome (threads sidebar, chat column, file tree) is neutral. The inconsistency is load-bearing — the user wants neutral as the floor and tints as opt-in everywhere.

**After this spec:** every tintable surface is neutral by default. Flipping a toggle in `state.json` restores (or adds) theme-accent tinting for that surface. Toggles are granular, follow the state override paradigm, and survive the existing state persistence plumbing without changing the protocol.

---

## 2. Non-goals

- **No new UI.** Toggles live in `state.json` only. A future settings pane (separate spec) can expose them, but not here.
- **No new theming vars.** Uses the existing `--ws-primary`, `--sidebar-surface-bg`, `--neutral-chrome-border`, `--theme-border` cascade. One new indirection layer per tintable surface (see §6).
- **No capture tiles.** `CaptureTiles` renders document thumbnails — those are content, not chrome. This spec does not touch them.
- **No change to the theming system itself.** `project_theming_architecture.md` describes the SQLite-backed theme cascade; tints gate **when** those colors apply, not where they come from.
- **No SSE/WS round-trip.** Tint toggles flow through the existing `state:get`/`state:set` protocol. Zero new message types.

---

## 3. The paradigm

Identical to `STATE_OVERRIDE_SPEC` §3. A new top-level `tints` key extends `ViewState`. Workspace default lives at `ai/views/settings/state.json`; per-view override at `ai/views/<view>/settings/state.json`. Deep merge per key.

Default shape for `tints` (on first launch — all off):

```jsonc
"tints": {
  "leftPanel":  false,
  "rightPanel": false,
  "cards":      false,
  "borders": {
    "threads": false,
    "chat":    false
  }
}
```

Every boolean defaults to `false`. `false` = neutral grey (the code-viewer file tree look). `true` = accent tint derived from the active theme.

---

## 4. Data shape

```ts
interface ViewStateTints {
  leftPanel:  boolean;   // threads column background tint
  rightPanel: boolean;   // view's right column (file tree / docked sticky chat) background tint
  cards:      boolean;   // wiki topic rows + issues ticket cards (NOT capture tiles)
  borders: {
    threads: boolean;    // threads column border-right
    chat:    boolean;    // chat column border-right
  };
}

// Extends ViewState from STATE_OVERRIDE_SPEC §5
interface ViewState {
  // ...existing keys (widths, collapsed, popup, currentThreadId, secondaryThreadId)...
  tints: ViewStateTints;
}
```

**Workspace default example:**

```jsonc
// ai/views/settings/state.json — full tints block (v1 baseline)
{
  "widths":   { ... },
  "collapsed":{ ... },
  "popup":    { ... },
  "currentThreadId":   null,
  "secondaryThreadId": null,
  "tints": {
    "leftPanel":  false,
    "rightPanel": false,
    "cards":      false,
    "borders": {
      "threads": false,
      "chat":    false
    }
  }
}
```

**Per-view override example:**

```jsonc
// ai/views/wiki-viewer/settings/state.json — wiki re-enables card tinting only
{
  "collapsed": { "leftSidebar": true },
  "widths":    { "leftChat": 380.89 },
  "tints":     { "cards": true }
}
```

Effect: globally everything neutral (workspace default); inside wiki-viewer, topic rows and their active/hover states regain the `--ws-primary` accent. Every other surface (threads bg, chat bg, borders) stays neutral because those keys are absent from the override.

---

## 5. Audit — what each toggle controls

Enumerates the exact CSS rules each toggle gates. A handoff implementer uses this as the checklist.

### 5a. `tints.leftPanel`
Currently **neutral**. When `true`, blend theme accent into the threads sidebar background.

| File | Selector | Current | When `true` |
|------|----------|---------|-------------|
| `ai/views/settings/styles/views.css:13` | `.sidebar` | `background: var(--sidebar-surface-bg, #161616)` | `background: color-mix(in srgb, var(--sidebar-surface-bg) 88%, var(--ws-primary) 12%)` |

### 5b. `tints.rightPanel`
Currently **neutral** for both known right-column surfaces. When `true`, apply the same `color-mix` blend.

| File | Selector | Current | When `true` |
|------|----------|---------|-------------|
| `ai/views/code-viewer/settings/styles/layout.css:53` | `.file-tree-sidebar` | `background: var(--sidebar-surface-bg, #161616)` | `color-mix(in srgb, var(--sidebar-surface-bg) 88%, var(--ws-primary) 12%)` |
| — | `.rv-secondary-sticky > .chat-area` (docked chat) | `var(--chat-surface-bg)` | `color-mix(in srgb, var(--chat-surface-bg) 88%, var(--ws-primary) 12%)` |

### 5c. `tints.cards`
Currently **tinted** for wiki and issues. When `false` (the new default), strip the accent from every card-scoped rule. When `true`, restore.

| File | Selector | Currently tinted via | Neutral replacement |
|------|----------|----------------------|---------------------|
| `open-robin-client/src/components/wiki/wiki.css:33` | `.rv-wiki-topic-list-header` | `color: var(--ws-primary)` | `color: var(--text-dim)` |
| `wiki.css:68-69` | `.rv-wiki-topic-item.active` | `background: rgba(236,72,153,0.1); color: var(--ws-primary)` | `background: rgba(255,255,255,0.08); color: var(--text-primary)` |
| `wiki.css:163-164`, `199-200`, `251` | wiki breadcrumb / link / section headers | `color: var(--ws-primary); border-bottom-color: var(--ws-primary)` | `color: var(--text-primary); border-bottom-color: var(--neutral-chrome-border)` |
| `open-robin-client/src/components/tickets/tickets.css:90-91` | `.rv-ticket-card:hover` | `border-color: var(--ws-primary); background: color-mix(...)` | `border-color: var(--neutral-chrome-border); background: rgba(255,255,255,0.04)` |
| `tickets.css:95` | `.rv-ticket-card.active` | `border-color: var(--ws-primary)` | `border-color: var(--text-dim)` |
| `tickets.css:101, 131, 155` | `.rv-ticket-card-id`, status badges | `color: var(--ws-primary)` | `color: var(--text-dim)` |

### 5d. `tints.borders.threads`
Currently **neutral**. When `true`, switch the threads column's right border to the theme border color.

| File | Selector | Current | When `true` |
|------|----------|---------|-------------|
| `ai/views/settings/styles/views.css:15` | `.sidebar` `border-right` | `1px solid var(--neutral-chrome-border)` | `1px solid var(--theme-border)` |

### 5e. `tints.borders.chat`
Currently **neutral**. When `true`, same swap on the chat column's right border.

| File | Selector | Current | When `true` |
|------|----------|---------|-------------|
| `ai/views/settings/styles/views.css:59` | `.chat-area` `border-right` | `1px solid var(--neutral-chrome-border)` | `1px solid var(--theme-border)` |

**Not in scope:**
- `.rv-panel` outer border (driven by `applyPanelTheme` inline style) — stays tinted regardless of `tints.borders.*`. That border is a workspace-identity cue, not a chrome decoration.
- `.file-viewer-chrome-border` and tab strip borders inside code-viewer — neutral by design; the file tree is the user's neutral reference. Not touched.

---

## 6. Mechanism

**One data attribute per tint on the panel root.** CSS selectors gate the tinted rules on the attribute; the un-tinted rules are the default.

```tsx
// open-robin-client/src/components/App.tsx — PanelWrapper (§62 onwards)
<div
  data-panel={panelId}
  data-tint-left={tints.leftPanel ? 'true' : undefined}
  data-tint-right={tints.rightPanel ? 'true' : undefined}
  data-tint-cards={tints.cards ? 'true' : undefined}
  data-tint-border-threads={tints.borders.threads ? 'true' : undefined}
  data-tint-border-chat={tints.borders.chat ? 'true' : undefined}
  className={...}
  style={gridStyle}
>
```

Using `undefined` instead of `'false'` keeps the attribute absent when off, so CSS uses `[data-tint-*="true"]` without negation everywhere. Selectors stay simple.

**CSS pattern:**

```css
/* Default: neutral. No attribute needed. */
.sidebar {
  background: var(--sidebar-surface-bg, #161616);
  border-right: 1px solid var(--neutral-chrome-border, rgba(255,255,255,0.12));
}

/* Tinted variant, gated on the panel root. */
.rv-panel[data-tint-left="true"] .sidebar {
  background: color-mix(in srgb, var(--sidebar-surface-bg, #161616) 88%, var(--ws-primary, #ec4899) 12%);
}
.rv-panel[data-tint-border-threads="true"] .sidebar {
  border-right-color: var(--theme-border, rgba(255,255,255,0.38));
}
```

**Why data attributes and not CSS custom properties flipped on the root:**
- The toggle set is small (five attributes) and static per render.
- Attributes keep per-selector CSS next to the rule it modifies — cleaner diff for reviewers and for the audit table in §5.
- Custom-prop indirection would work too, but layers an abstraction where the CSS cost is just "one selector per rule."

**Blend ratio** `88% / 12%` is the proposal for the neutral-to-accent blend on surfaces (`leftPanel`, `rightPanel`). It preserves luminance (the file tree grey stays dark-dominant) while being unmistakably tinted. The ratio is one line to tune if it reads wrong in testing.

---

## 7. Server

**Zero server changes.** `resolveViewState` and `writeViewStatePatch` already deep-merge arbitrary keys — `tints` piggybacks for free. The existing `state:get`/`state:set` protocol carries the new key without modification.

**One implementation detail for the writer:** `writeViewStatePatch` (STATE_OVERRIDE_SPEC §7) routes writes per leaf key based on whether the per-view override file already contains that leaf. Nested `tints.borders.threads` is a leaf at the same depth as `widths.leftChat`; existing routing works without change.

---

## 8. Client

### 8a. Store

**File:** `open-robin-client/src/state/panelStore.ts`.

Extend `ViewUIState` (the in-memory mirror of `ViewState`) with a `tints` slot:

```ts
interface ViewUIState {
  // ...existing...
  tints: {
    leftPanel:  boolean;
    rightPanel: boolean;
    cards:      boolean;
    borders: { threads: boolean; chat: boolean };
  };
}

const DEFAULT_VIEW_UI_STATE: ViewUIState = {
  // ...existing...
  tints: {
    leftPanel:  false,
    rightPanel: false,
    cards:      false,
    borders: { threads: false, chat: false },
  },
};
```

No new actions — tints are read via the existing `viewStates[panelId]` selector. Writes go through the existing `setPaneWidth` / `toggleCollapsed` style patch helpers (add one new `setTint(view, path, value)` helper, see §8b).

### 8b. Setter helper

```ts
// panelStore.ts — one new action
setTint: (view: string, path: 'leftPanel' | 'rightPanel' | 'cards' | 'borders.threads' | 'borders.chat', value: boolean) => void;
```

Writes to `viewStates[view].tints.<path>` locally and sends a `state:set` with the same partial patch. The server's writer routes per leaf as usual.

v1 has no UI caller; the helper exists so a future settings surface can flip tints without bypassing the store.

### 8c. PanelWrapper

**File:** `open-robin-client/src/components/App.tsx` — `PanelWrapper` at line 66.

Read tints from viewState; attach data attributes (§6). Pattern:

```tsx
const tints = viewState?.tints ?? DEFAULT_VIEW_UI_STATE.tints;
const attrs: Record<string, string> = {};
if (tints.leftPanel)        attrs['data-tint-left']           = 'true';
if (tints.rightPanel)       attrs['data-tint-right']          = 'true';
if (tints.cards)            attrs['data-tint-cards']          = 'true';
if (tints.borders.threads)  attrs['data-tint-border-threads'] = 'true';
if (tints.borders.chat)     attrs['data-tint-border-chat']    = 'true';

return <div data-panel={panelId} {...attrs} className={...} style={gridStyle}>...</div>;
```

---

## 9. CSS changes

Each audit row in §5 maps to a diff below. All in existing files; no new stylesheets.

**`ai/views/settings/styles/views.css`**
- `.sidebar` — no change to default rule. Add scoped override:
  ```css
  .rv-panel[data-tint-left="true"] .sidebar {
    background: color-mix(in srgb, var(--sidebar-surface-bg, #161616) 88%, var(--ws-primary, #ec4899) 12%);
  }
  .rv-panel[data-tint-border-threads="true"] .sidebar {
    border-right-color: var(--theme-border, rgba(255,255,255,0.38));
  }
  ```
- `.chat-area` — analogous override for `data-tint-border-chat`.

**`ai/views/code-viewer/settings/styles/layout.css`**
- `.file-tree-sidebar` — no change to default. Add scoped override for `data-tint-right`.

**`open-robin-client/src/components/wiki/wiki.css`**
- Swap every `color: var(--ws-primary)` / tinted background on card-scoped selectors to the neutral values in §5c's table.
- Add `.rv-panel[data-tint-cards="true"]` ancestor-scoped rules that restore the accent versions. Every current accent rule gets a paired `[data-tint-cards="true"]` re-enable rule.

**`open-robin-client/src/components/tickets/tickets.css`**
- Same pattern as wiki.css. Every accent-tinted card rule gets its neutral default inverted and a `[data-tint-cards="true"]` re-enable.

**Pattern to follow everywhere** — keep the neutral as the unconditional rule; gate the tinted variant behind `.rv-panel[data-tint-*="true"]`. This makes the default state obvious at read time and keeps the "on" affordance as a single additive selector per rule.

---

## 10. Migration

**No data migration.** The existing workspace `state.json` doesn't have a `tints` key; the resolver fills it from `DEFAULT_VIEW_UI_STATE.tints` on first read. Users who want tinting back for wiki/issues add it to their per-view override by hand.

**Visual impact of landing this spec:** wiki topic rows and issues ticket cards lose their pink/yellow tinting at first paint. This is intentional and is the point of the spec. Document in the commit message so it isn't mistaken for a regression.

**Optional soft-migration path** (not recommended, flagged for discussion):
- Seed `tints.cards: true` into the wiki-viewer and issues-viewer per-view override files during rollout to preserve today's look.
- Downside: future users onboarding fresh wouldn't see the neutral default the spec is designed around. Also contradicts the user's stated intent ("not by default").

---

## 11. Files changed

| File | Action |
|------|--------|
| `open-robin-client/src/state/panelStore.ts`                   | Extend `ViewUIState` + `DEFAULT_VIEW_UI_STATE` with `tints`; add `setTint` action. |
| `open-robin-client/src/types/index.ts`                        | Match the new shape if `ViewState` is mirrored in types. |
| `open-robin-client/src/components/App.tsx`                    | PanelWrapper reads `tints`, emits `data-tint-*` attrs. |
| `ai/views/settings/styles/views.css`                          | Add `.rv-panel[data-tint-left]`, `[data-tint-border-threads]`, `[data-tint-border-chat]` rules. |
| `ai/views/code-viewer/settings/styles/layout.css`             | Add `.rv-panel[data-tint-right]` rule for `.file-tree-sidebar`. |
| `open-robin-client/src/components/wiki/wiki.css`              | Swap accent rules to neutral defaults; add `[data-tint-cards="true"]` re-enables. |
| `open-robin-client/src/components/tickets/tickets.css`        | Same treatment as wiki. |
| `ai/views/settings/state.json`                                | Add `tints` block with all-false defaults on next server boot (server auto-writes the key during resolver normalization — see §12.3). |

No new files. No protocol changes. No new migrations.

---

## 12. Rollout

1. **Server: resolver default shape.** Ensure `resolveViewState` returns `tints` with the default-false shape when the workspace file lacks the key. One-line change in `open-robin-server/lib/view-state/resolver.js` — extend the defaults merge.
2. **Client: store slot.** Extend `ViewUIState` + `DEFAULT_VIEW_UI_STATE` + `setTint`.
3. **PanelWrapper attrs.** Emit `data-tint-*` on the panel root.
4. **CSS: invert wiki + tickets.** The visible behavior change. Land alongside step 3 so nothing renders with mixed states.
5. **CSS: add left/right/border tint scoped rules.** Purely additive; dormant until toggles flip.
6. **Smoke test.** Load wiki + issues with everything off → neutral. Hand-edit `ai/views/settings/state.json` to `"tints": { "cards": true }` → restart server → reload → both views show accents again. Flip `tints.borders.threads: true` → threads column's right border picks up theme accent. Flip `tints.leftPanel: true` → sidebar background blends 12% accent.
7. **Per-view smoke.** Drop `"tints": { "cards": true }` into wiki's per-view override; confirm issues stays neutral, wiki gets accents.

Steps are independently commit-able; the CSS rename (step 4) is the user-visible one and should be called out in the commit message.

---

## 13. Open questions

1. **Blend ratio.** `88% / 12%` (§6) is my proposed starting point. Confirm in the browser with real themes; adjust in one place if needed.
2. **Per-theme tuning.** Some themes may look bad at the default ratio (very saturated accents will over-dominate). Per-theme blend ratios can be added later via a `--tint-blend-ratio` theme variable. Out of scope here.
3. **Hover/active ratios for cards.** Currently issues' hover blends `10%` accent (`tickets.css:91` — `color-mix 90% sidebar + 10% accent`). Wiki's active uses `rgba(236,72,153,0.1)` hardcoded. Keep those ratios when `tints.cards: true`? Proposal: yes, preserve the existing values inside the `[data-tint-cards="true"]` branch verbatim; only the neutral branch replaces them.
4. **Panel outer border.** `.rv-panel` outer border (applied via inline style from `applyPanelTheme`) is unaffected by `tints.borders.*`. Is that the intended scope of "borders" in the JSON, or should this spec also gate the outer border? Proposal: keep the outer border as workspace-identity chrome; if the user wants to turn it off too, a separate `tints.borders.panel` key can be added later without a refactor.
5. **Future settings UI.** v1 has no UI toggle. A later pane in Robin or in a per-view settings surface can call `setTint(view, path, value)` without bypassing the store. Noted in §8b.

---

## 14. Acceptance

- Fresh repo, all-false tints: wiki topic rows render with neutral text + background; issues ticket cards render with neutral border, no accent hover tint. Code-viewer and every other view look identical to today.
- Edit `ai/views/settings/state.json` to set `tints.cards: true`. Restart. Both wiki and issues regain their accent tinting exactly as it looked pre-spec.
- Edit `ai/views/settings/state.json` to set `tints.leftPanel: true`. Restart. Threads sidebar background picks up a subtle accent blend. Chat column and right column unchanged.
- Edit `ai/views/settings/state.json` to set `tints.borders.threads: true`. Restart. Threads column's right border switches from neutral to `--theme-border`. Chat column border unchanged.
- Drop `"tints": { "cards": true }` into `ai/views/wiki-viewer/settings/state.json`. Workspace-global `tints.cards` still `false`. Wiki shows accents; issues stays neutral.
- Per-view override writer correctness: with the above wiki override file present, flipping `tints.cards` off via `setTint('wiki-viewer', 'cards', false)` writes to the per-view file (not the workspace) because the key is already pinned there.
- `tsc -b --noEmit` passes. `npm run build` passes. No console errors.
- The three original smoke-test cases from `STATE_OVERRIDE_SPEC §14` (width propagation, collapse persistence, currentThreadId carry-over) still pass.

---

/Users/rccurtrightjr./projects/open-robin/docs/TINTS_SPEC.md
