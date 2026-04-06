# Clipboard manager — Kimi integration architecture

**Goal:** Clipboard history + popover UI **under the chat input, left-aligned**, shared by every panel’s chat (same chrome, same behavior). **Strict modularity:** no new `switch` arms in `ws-client`, no stuffing logic into `ChatArea.tsx` or `ChatInput.tsx` beyond composition.

**References:** Fusion extraction `docs/CLIPBOARD_MANAGER_SPEC.md`; tool modularity pattern `kimi-ide-client/src/lib/tool-renderers/index.ts`; wire routing `kimi-ide-client/src/lib/ws-client.ts` (message `switch` stays **wire-only**).

---

## 1. Domain boundaries

| Domain | Owns | Must not own |
|--------|------|----------------|
| **Wire / stream** | `ws-client`, panel segments, turns | Clipboard rows, hover timers |
| **Chat shell** | `ChatArea`, layout, composing named children | MRU history math, `localStorage` keys |
| **Clipboard** | History list, persistence adapter, preview strings, popover interaction state, write API for app copies | WebSocket message types, tool segment types |

Clipboard touches the chat **only** as a **visual slot** (where the row lives) and by calling **`recordClipboardCopy`** (or similar) when other domains perform a copy — those domains call a **single public API**, not the store internals.

---

## 2. Folder layout (proposed)

All clipboard code under one tree so nothing “spills” into unrelated files:

```
kimi-ide-client/src/clipboard/
  types.ts                 # ClipboardEntry, ClipboardItemType, BubbleState, …
  history-model.ts         # Pure: insert MRU, dedupe, trim cap, reorder on re-copy
  preview.ts               # (text, type) → preview line — no I/O
  persistence.ts           # WS adapter: clipboard:list / clipboard:append → server → robin.db
  clipboard-api.ts         # Public: writeTextAndRecord(), clearHistory(), getHistorySnapshot()
  interaction-controller.ts # CLOSED | PREVIEW | LOCKED | LEAVING + timers (vanilla TS)
  clipboard-store.ts       # Optional thin Zustand *only* for history + selection index (if needed)
  ClipboardPopover.tsx       # Presentational: list, empty, header, a11y hooks
  ClipboardTrigger.tsx       # Icon control + passes refs/callbacks to controller attach API
  index.ts                   # Re-exports stable public surface
```

**Optional** (if you prefer colocating the composer strip):

```
kimi-ide-client/src/components/chat-composer/
  ChatComposerFooter.tsx   # Layout only: input row + bottom row [clipboard | context]
```

`ChatArea.tsx` would import **`ChatComposerFooter`** (or compose two rows) instead of inlining clipboard markup.

---

## 3. Controller pattern (parallel to your stack)

| Existing pattern | Clipboard analogue |
|------------------|-------------------|
| **`ws-client` `handleMessage`**: one `switch` on **wire message type**, delegates to store + helpers | **No clipboard cases** in `ws-client`. Clipboard is not a wire concern. |
| **`getToolRenderer(type)`**: registry lookup, components stay dumb | **No tool-like registry** unless you add many **preview strategies** — then `previewStrategies.ts` + `getPreviewStrategy(kind)` (small table), not a 200-line `switch` in one file. |
| **Store**: panel state separate from WS | **`clipboard-store` or module scope** holds history; **not** mixed into `PanelState` unless you explicitly want per-panel history later (default: **global** MRU, one list for the whole app). |
| **Timers / orchestration**: forbidden in React components per project rules | **Vanilla `interaction-controller.ts`** (same spirit as `ws-client`: no React in the timer layer). It exposes `subscribe(listener)` or `getState()` + `attach({ triggerEl, popoverEl })` so **one** mount site wires DOM without a giant `switch` in JSX. |

The **React** layer is thin: subscribe (e.g. `useSyncExternalStore`) and render `ClipboardPopover` + `ClipboardTrigger` from controller state. **Decisions** (open/close/lock) stay in `interaction-controller.ts`.

---

## 4. Placement: left under the input

Current structure (`ChatArea.tsx`):

- `.chat-footer` → column: **`ChatInput`** then **context meter** (`.context-usage-below-input`, right-aligned).

**Target structure:**

- `.chat-footer` → column:
  1. **`ChatInput`** (unchanged component API).
  2. **Composer bottom row** (new wrapper, flex row):
     - **Left:** clipboard trigger + popover anchor (or inline strip).
     - **Right:** existing context usage block (keep `align-self: flex-end` behavior on the meter).

**CSS** (`ai/views/settings/styles/views.css`): add a class e.g. `.chat-composer-meta-row` with `display: flex`, `justify-content: space-between`, `align-items: flex-end`, `gap`, `width: 100%`. Clipboard cluster `align-self: flex-start` or default stretch.

Popover positioning: Fusion used **fixed bottom-left**; here anchor **near the trigger** (left under input) with the same **bridge `::after`**, **`z-index`** above chat chrome, tokens from `UI_THEME_SURFACE.md`.

---

## 5. Who calls `writeTextAndRecord`

Any feature that copies to the system clipboard should go through **`clipboard-api.ts`** so history stays consistent:

- Future: “Copy message”, file path copy, code selection — each **caller** invokes the API; **no** duplicate `navigator.clipboard` scattered without recording.

The **wire protocol** does not emit clipboard events; no change to `handleMessage` required.

**Persistence:** Clipboard is **workspace-scoped** — a table in `{projectRoot}/ai/system/robin.db`, added via Knex migration (`005_clipboard.js`). See **`docs/SQLITE_SYSTEM_LAYER.md`** (table shape, `clipboard:list` / append, RAM window 30–50, “See more”, future `host_metadata` realm).

---

## 6. What stays out of existing files

| File | Rule |
|------|------|
| `ws-client.ts` | No clipboard branches. |
| `panelStore.ts` | No clipboard fields unless you later want per-thread history (then a dedicated slice module, not ad-hoc fields). |
| `ChatInput.tsx` | Stays **input + send/stop only**; footer layout moves to `ChatComposerFooter` or `ChatArea` composition only. |
| `MessageList.tsx` / segment renderers | Unchanged. |

---

## 7. Implementation order (suggested)

1. **`types` + `history-model` + `clipboard-api` + server clipboard handlers + migration `005_clipboard.js`** — unit-testable; persistence via `robin.db`.
2. **`interaction-controller`** — match Fusion spec timings/states; vanilla only.
3. **`ClipboardTrigger` + `ClipboardPopover`** — presentational; wired to controller.
4. **`ChatComposerFooter` + `views.css`** — layout row; **`ChatArea`** composes.
5. **Replace stray `navigator.clipboard` calls** (if any) with `clipboard-api` over time.

---

## 8. Open decisions (for you)

- **Global vs per-panel history:** Default global MRU; per-panel is a separate product call and would need keyed storage + UI hint.
- **Floating chat:** If the same `ChatArea` chrome is reused, clipboard follows; if floating uses a slim variant, pass a **`variant="embedded" | "floating"`** into composer footer to hide or reposition clipboard (per existing `.floating-chat-body .context-usage` pattern).

---

*Architecture note for synthesis with `CLIPBOARD_MANAGER_SPEC.md` — implementation not started in this step.*
