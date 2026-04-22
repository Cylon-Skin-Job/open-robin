# CLI Identity (Icon + Name) — Spec

**Status:** Draft — ready for review.
**Owner:** Open Robin core.
**Code standards:** `ai/views/wiki-viewer/content/enforcement/code-standards/PAGE.md`.
**Scope:** Primary chat header, secondary chat header, sidebar thread list, thread-jump dropdown, CLI-picker dropdown.

---

## 1. Purpose

Make the CLI (harness) that owns a thread visible across the UI so the user always knows which backend is handling a given conversation.

Surfaces to update:

1. **Chat header** (primary): icon + display name of the thread's harness, next to existing chrome.
2. **Secondary chat header** (floating + sticky popup): same icon + name.
3. **Thread list** (sidebar + thread-jump dropdown rows): CLI icon to the left of the thread's display name.
4. **CLI picker dropdown**: swap current emoji icons for Material Symbols that match the chat-header icons, so the picker, the header, and the thread-list row all carry the same identity glyph.

---

## 2. Current state

- `open-robin-client/src/config/harness.ts` — `HARNESS_OPTIONS` with fields: `id`, `name`, `description`, `icon` (emoji string), `details`, `enabled`, `recommended?`, `comingSoon?`.
- `CliPickerDropdown.tsx:60` — renders `{option.icon}` (emoji) inside each menu item.
- `Sidebar.tsx` thread rows — render `formatThreadDisplayName(thread)` with a green dot for `status === 'active'`; no CLI icon.
- `ThreadJumpDropdown.tsx` rows — render `formatThreadName(t)`; no CLI icon.
- Chat header (`ChatArea.tsx:rv-chat-header`) — renders nothing on the left by default; `more_vert` (+ `playlist_add`, `subject` when sidebar collapsed) on the right.
- Thread entry carries `harnessId?: string` (`types/index.ts:ThreadEntry`), populated server-side when a thread is created.

---

## 3. Icon + name catalog

| Harness id    | Display name  | Material Symbol  |
|---------------|---------------|------------------|
| `kimi`        | KIMI          | `bedtime`        |
| `claude-code` | Claude Code   | `smart_toy`      |
| `codex`       | Codex         | `terminal_2`     |
| `gemini`      | Gemini        | `stars_2`        |
| `qwen`        | Qwen          | `diamond_shine`  |
| `robin`       | Robin         | `auto_awesome` (default — see §7 Q3) |

Display name is the human-readable form used in both the chat header and the picker. Material Symbol is the glyph used everywhere a CLI identity renders.

---

## 4. Data model changes

### 4a. `HarnessOption`
Add one field. Keep `icon` (emoji) for backwards compatibility with anything still consuming it — it's low-cost to leave — or delete per §9.

```ts
export interface HarnessOption {
  ...existing...
  materialIcon: string;    // Material Symbols name (e.g. 'bedtime')
}
```

### 4b. No server-side changes
Thread entries already carry `harnessId`. The UI resolves `harnessId → HarnessOption` via a single lookup helper.

### 4c. New helper (client only)
`open-robin-client/src/config/harness.ts` — add:

```ts
export function getHarnessIdentity(harnessId: string | null | undefined): {
  name: string;
  icon: string;            // Material Symbol
  option: HarnessOption | null;
};
```

Returns a fallback `{ name: 'Unknown', icon: 'help', option: null }` when `harnessId` is missing or not registered. Every UI surface consumes this one function — no inline lookups duplicated across components.

---

## 5. Components

### 5a. `CliPickerDropdown.tsx` — edit
Replace the emoji `<span aria-hidden="true">{option.icon}</span>` with `<span className="material-symbols-outlined">{option.materialIcon}</span>`. The shared `.rv-dropdown-item .material-symbols-outlined` CSS (18px) already scopes the size.

No other layout change — the existing `name` + `badge` structure stays.

### 5b. `ChatArea.tsx` — edit
Inside `.rv-chat-header`, render a new leading element only when a thread is active:

```tsx
{currentThreadId && (
  <div className="rv-chat-header-identity">
    <span className="material-symbols-outlined">{identity.icon}</span>
    <span className="rv-chat-header-identity-name">{identity.name}</span>
  </div>
)}
```

Where `identity = getHarnessIdentity(currentThread?.entry?.harnessId)`. `currentThread` comes from `state.threads.project.find(t => t.threadId === currentThreadId)`.

Styling: flex row, 6px gap, vertically centered with the existing header row. Hidden on the secondary's embedded ChatArea (the secondary has its own SecondaryHeader).

### 5c. `SecondaryHeader.tsx` — edit
Add the same `[icon] [name]` block between the traffic-light group and the grab zone, so the popup header also carries the harness identity. Traffic lights on the left, CLI identity next, grab zone fills the rest.

The component reads `secondary.threadId` from the store, resolves the thread entry's `harnessId`, looks up identity, renders inline.

### 5d. Thread list rows — edits in `Sidebar.tsx` and `ThreadJumpDropdown.tsx`
Each thread row gains a leading icon:

```tsx
<span className="material-symbols-outlined rv-thread-row-icon">
  {getHarnessIdentity(thread.entry?.harnessId).icon}
</span>
```

Positioned before the thread name text. Existing `.chat-item--secondary-indent::before` (the `subdirectory_arrow_right` prefix) continues to signal secondary-indent — it lives on the row's left edge (as an indent marker), and the CLI icon sits inside the row content (next to the name). See §7 Q2 for the stacking decision.

### 5e. CSS additions
Minimal — all use existing tokens:

- `.rv-chat-header-identity` — flex row, gap `var(--space-xs, 4px)`, color `var(--text-dim)` for icon, `var(--text-primary)` for name, font-size `var(--font-sm, 12px)`, icon `font-size: 18px`.
- `.rv-thread-row-icon` — `font-size: 16px`, `color: var(--text-dim)`, `margin-right: var(--space-xs, 4px)`, `opacity: 0.85`.
- Scoped to the secondary header identity block: same layout, tightened to fit the 40px header.

No new CSS files. Rules go into the existing `views.css` next to their component's sibling rules (per "styles live next to component" — but since these are already global CSS files in this project, they stay there, matching the existing pattern for the sidebar and chat header).

---

## 6. Behavioral rules

### 6a. When there's no active thread
Chat header's identity block is not rendered at all — no icon, no name, no placeholder. The `more_vert` menu, `playlist_add`, and `subject` buttons continue to live on the right as before.

### 6b. During harness-select (post-click, pre-thread-created)
`currentThreadIds[scope]` is null (cleared by `selectHarness`). The identity block is therefore hidden — matches §6a. The `ConnectingOverlay` in the chat body area already signals "Connecting to Kimi…" during this brief window.

### 6c. After thread:created
`currentThreadIds[scope]` is set to the new thread's id; its entry carries `harnessId`; identity renders.

### 6d. Resumed old threads
Threads that predate this spec carry `harnessId: 'kimi'` (current default on the server per `ThreadIndex.js:80`). Their rows and headers render the KIMI identity. Nothing special needed for migration.

### 6e. Missing `harnessId`
If a thread entry somehow lacks `harnessId`, `getHarnessIdentity` returns the fallback (`'help'` icon, `'Unknown'` name). The row still renders — no crash, no empty-space gap.

---

## 7. Open questions

1. **Robin's icon.** Robin ships with the app (builtIn). The user listed icons for the five external CLIs but not for Robin. `auto_awesome` is a common "AI" glyph and is proposed as the default; `hub` or `flare` are alternatives.
2. **Secondary-indent interaction.** A thread row can be both indented (it's the currently-open secondary) AND carry its CLI icon. Proposal: the `::before` `subdirectory_arrow_right` stays on the row's outer indent margin (16px), and the CLI icon lives inside the row content immediately before the name. Visually: `↳  [icon] Thread name  ●`. Confirm that's the desired stack.
3. **Icon size in chat header.** Proposal: 18px (matches menu-item icons elsewhere). Alternative: 20px to match the other header buttons. Pick one for consistency.
4. **Emoji vs Material Symbol in picker.** The old emoji icons in the picker are decorative; Material Symbols match the rest of the app. Proposal: replace entirely (single `materialIcon` field on `HarnessOption`, `icon` deleted per §9). Alternative: keep both and let the picker choose, but that's a premature abstraction.
5. **Name case.** `'KIMI'` (current config) is all caps; other names are title-cased. Consistent with user's list. Leave as-is unless that contrast is unwanted.

---

## 8. Implementation order

1. Add `materialIcon` to `HarnessOption` interface + fill values for all six harnesses in `HARNESS_OPTIONS`.
2. Add `getHarnessIdentity()` helper in `config/harness.ts`.
3. Update `CliPickerDropdown` to render `materialIcon`.
4. Add `.rv-chat-header-identity` and identity element to `ChatArea.tsx`.
5. Add identity element to `SecondaryHeader.tsx`.
6. Add `.rv-thread-row-icon` and icon element to `Sidebar.tsx` and `ThreadJumpDropdown.tsx` rows.
7. Delete old `icon` emoji field from `HarnessOption` (per §9).

Each step is independently mergeable. Steps 1 and 2 don't affect any rendering; rendering changes start at step 3.

---

## 9. Cleanup

After the rollout lands:

- Delete `HarnessOption.icon` (emoji). No other consumer after step 3 above (grep confirms).
- If `ChatHarnessPicker.tsx` is no longer rendered anywhere (it was removed from `ChatArea.tsx` earlier), delete the component file entirely. Grep first.

Per "Delete, don't deprecate" from the standards.

---

## 10. Out of scope

- Per-harness color accents in the header or thread rows.
- Keyboard-driven CLI switching (e.g. a shortcut to cycle harnesses).
- Per-harness custom theming of the popup.
- Showing harness version number next to the name.
- Harness-specific badges (installed / built-in / recommended) in the chat header — those remain a picker-only concern.

---

## 11. Code-standards checklist

- [x] Each edit has one describable job per file; no file approaches the 400-line threshold.
- [x] CSS uses `var(--token, fallback)` — no hardcoded colors, spacing, or z-index.
- [x] `getHarnessIdentity` extracted *only because* three consumers need it (chat header, thread rows, secondary header) — not premature.
- [x] No cross-layer imports: the helper is pure lookup, components call it directly.
- [x] `HarnessOption.icon` deletion covered in §9 — delete, don't deprecate.
- [x] Scope-creep check: nothing outside "show CLI identity in four specific surfaces." No new theming, no new harness behaviors, no server-side changes.
