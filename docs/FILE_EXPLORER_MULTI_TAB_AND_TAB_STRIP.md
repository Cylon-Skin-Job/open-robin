# File explorer: multi-tab viewer and tab strip (what we built and fixed)

This document records the work to add **multiple open files as tabs** in the code panel file viewer, and the **tab strip UX/CSS** iterations required before the behavior matched intent.

---

## Product goals

1. **Multi-tab editing** — Opening another file **adds a tab**; it does not replace the only open file.
2. **Same file again** — Clicking an already-open file in the tree **does not** create a duplicate tab; it **moves that tab to the front** of the strip and **makes it active**.
3. **Tab strip behavior** — Correct **active** vs **inactive** appearance, **click targets**, and **navigation** (chevrons), without stealing clicks or fighting the layout.
4. **Visual intent (tab chrome)** — The **active** tab should **read as connected** to the editor (no extra “selected underline” on the active tab). **Inactive** tabs are visually distinct; optional **small vertical nudge** so the **header’s bottom rule** reads like the **top edge of the content stack**. **No bottom border on tabs** unless explicitly desired — we ended with **no bottom border on any tab**.

---

## Architecture (client)

### Types (`kimi-ide-client/src/types/file-explorer.ts`)

- **`EditorTab`** — `{ file: FileInfo; content: string; size: number; loading: boolean }`.

### State (`kimi-ide-client/src/state/fileStore.ts`)

Replaced single-file fields with:

- **`tabs: EditorTab[]`**, **`activeTabPath: string | null`**
- **`openFileTab(file)`** — If a tab for `file.path` exists: **move tab to index 0** (front), set active, return `{ shouldFetch: false }`. Else append a new tab with `loading: true`, return `{ shouldFetch: true }`.
- **`applyFileContent`**, **`removeTabAfterError`**, **`setActiveTab`**, **`closeTab`**, **`closeActiveTab`**, **`activateAdjacentTab`** (prev/next **without wrap** at ends; chevrons disabled when there is nowhere to go).
- After closing the active tab, focus moves to the **tab to the left** in the strip when possible.

### Wire / tree (`kimi-ide-client/src/lib/file-tree.ts`, `useFileTree.ts`)

- **`loadFileContent`** calls **`openFileTab`**; sends **`file_content_request`** only when **`shouldFetch`**.
- **`file_content_response`** (panel **`code-viewer`**) applies content or removes the tab on error.

### UI (`kimi-ide-client/src/components/file-explorer/FileViewer.tsx`)

- Renders **all tabs**; **active** tab drives **info bar** and **`FileContentRenderer`**.
- **Tab strip** uses **event delegation** on **`.file-viewer-tabs`**: reads **`data-tab-path`** from the clicked row and calls **`setActiveTab`**, so selection is tied to the **clicked DOM node’s path** (avoids stale closure confusion).
- **Close** buttons **`stopPropagation`** so they don’t fire select.
- **Chevrons** — Previous / next tab only (not “close”).

### Tree (`kimi-ide-client/src/components/file-explorer/FileNode.tsx`)

- Per-file loading: **`tabs.some(t => t.file.path === node.path && t.loading)`** instead of a global **`isLoading`**, so the rest of the tree stays clickable while one file loads.

### Styles (`kimi-ide-client/src/index.css`)

- Tab strip rules live under **FILE VIEWER** — see **Final tab strip CSS** below.

---

## Bugs we hit (and what fixed them)

### 1. Left chevron closed the tab / “wrong tab” after click

The **left chevron** was wired to **`closeActiveTab`**, and **`pickActiveAfterClose`** moved focus to another tab — felt like “switching to the other tab” instead of navigating.

**Fix:** Chevrons call **`activateAdjacentTab(±1)`** with **no wrap** at the first/last tab; buttons **disabled** when there is no adjacent tab.

### 2. Whole viewer blocked clicks while loading

**`.file-viewer.loading`** used **`pointer-events: none`** on the **entire** viewer, including the tab bar.

**Fix:** Apply loading (dim + **`pointer-events: none`**) only to **`.file-viewer-content.loading`**, not the header/tabs.

### 3. Clicking a tab activated the wrong tab / active tab stole clicks

**Causes:**

- **Active tab** had **higher `z-index`** than siblings → could **steal hits** on adjacent tabs.
- **Close** control was **invisible** (`opacity: 0`) but still **received clicks** → accidental close or wrong target.

**Fix:** Equal stacking for tabs; **`pointer-events: none`** on **`.tab-close`** until the tab row is **`:hover`** or **`:focus-within`**, then **`pointer-events: auto`**.

### 4. “Previous” wrapped from first tab to last (two tabs)

**Fix:** **`activateAdjacentTab`** clamps at ends — no modulo wrap.

### 5. Measured underline + `ResizeObserver` broke the whole UI

A **JS-positioned** underline (`ResizeObserver` + **absolute** bar) caused **layout thrash / tight update loops** — UI felt **unclickable** everywhere.

**Fix:** **Removed** that approach entirely. No measured overlay in the tab strip.

### 6. Tab strip visuals vs intent (biggest confusion)

Several iterations assumed “**underline the active tab**” with **`theme-primary`**.

**Actual intent:** The **active** tab should **not** gain a decorative **bottom border / cyan line** as “selection.” The **header `::after` 1px line** should read as the boundary; the **active** tab **meets** the content without an extra **bottom border** on the tab. **Inactive** tabs may be **nudged up** slightly (**`translateY(-2px)`**) so the header line aligns with the **content stack**; **active** stays **`translateY(0)`**.

**Mis-step:** Adding **`border-bottom`** on the **active** tab when the user asked to **remove** bottom border from **inactive** tabs only.

**Final:** **All tabs:** **`border-bottom: none`** on **`.file-viewer-tab`**. **Active** only adds **`background-color`** and **transform** — **no** bottom border on active or inactive.

### 7. Hover looked like “selected”

**`.file-viewer-tab:hover`** used the **same** background as **`.active`**.

**Fix:** **`.file-viewer-tab:not(.active):hover`** with a **light** tint (`rgba(var(--theme-primary-rgb), 0.12)`), not the full active fill.

---

## Final tab strip CSS (behavioral summary)

| Rule | Purpose |
|------|--------|
| **`.file-viewer-tab`** | Left/right borders; **`border-bottom: none`**; **`margin-bottom: -1px`** to sit over header `::after`; base styles. |
| **`.file-viewer-tab:not(.active)`** | **`transform: translateY(-2px)`** — inactive tabs slightly up. |
| **`.file-viewer-tab.active`** | **`transform: translateY(0)`**, **`background-color: #0a161c`** — no bottom border. |
| **`.file-viewer-tab:not(.active):hover`** | Subtle hover tint; must not match active fill. |
| **`.tab-close`** | **`pointer-events: none`** until hover/focus-within on the row. |

---

## Build and server

The app is served from **`kimi-ide-client/dist/`** via **`kimi-ide-server`**. After client changes:

```bash
# From repo root (adjust path if needed)
./restart-kimi.sh
```

Or: **`npm run build`** in **`kimi-ide-client/`**, then **`node server.js`** in **`kimi-ide-server/`** (port **3001** by default).

---

## Files touched (reference)

| Area | Files |
|------|--------|
| Types | `kimi-ide-client/src/types/file-explorer.ts` |
| State | `kimi-ide-client/src/state/fileStore.ts` |
| Wire | `kimi-ide-client/src/lib/file-tree.ts`, `kimi-ide-client/src/hooks/useFileTree.ts` |
| UI | `kimi-ide-client/src/components/file-explorer/FileViewer.tsx`, `FileExplorer.tsx`, `FileNode.tsx` |
| Styles | `kimi-ide-client/src/index.css` |

---

## Lessons (for the next change)

1. **Match browser-tab mental model** — “Active” often means **no** bottom rule on the tab **cell** so it **connects** to the pane; **accent underline on the active tab** was the wrong default without explicit product ask.
2. **Don’t add overlays** without **`pointer-events: none`** and proof they don’t **resize-loop** with **`ResizeObserver`**.
3. **Do exactly the request** — e.g. “remove bottom border on inactive” does **not** imply “add one on active.”
4. **Rebuild + restart** the server after **`kimi-ide-client`** changes so **`dist/`** is what you test.

---

*Last updated from the multi-tab + tab strip work session.*
