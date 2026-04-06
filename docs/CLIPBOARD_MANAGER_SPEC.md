# Clipboard manager — extracted spec (Fusion Studio viewer)

**Source:** `~/Desktop/projects/fusion-studios/viewer/` — `js/clipboard.js`, clipboard bubble block in `js/main.js`, styles in `styles.css` (`.clipboard-bubble` … `.clipboard-toast`).

**Note on “server submodule”:** In this tree, clipboard behavior is **entirely client-side** (module + UI in `main.js`). There is no separate Node server for clipboard state. Persistence is **`localStorage`**, not an HTTP API. If you had a different fork with a server, this spec still captures the **UI and state concepts** to re-implement or reattach to a bridge later.

---

## 1. Purpose

- **History of recent copies** made through a single write API (`clipboardWrite`), with typed previews (link, icon, emoji, file contents, context, etc.).
- **Quick recall**: hover or click the status-bar control to open a **popover** anchored near the trigger; pick a row to copy again.
- **Feedback**: toast after copy/clear.

---

## 2. Visual design (styling)

### Popover container (`.clipboard-bubble`)

| Property | Behavior |
|----------|----------|
| Position | `fixed`, **`bottom: 40px`**, **`left: 1rem`** — anchored to bottom-left (above status bar). |
| Size | **`width: 320px`**, **`max-height: calc(100vh - 120px)`** — uses most of the viewport height; reads as a large “sheet” without being a full opaque overlay. |
| Layering | **`z-index: 1003`** — floats above main chrome. |
| Surface | `background: var(--bg-secondary)`, **`border: 1px solid var(--border)`**, **`border-radius: 8px`**, **`box-shadow: 0 4px 16px rgba(0,0,0,0.4)`**. |
| Show/hide | Default **`opacity: 0`**, **`pointer-events: none`**; **`.open`** sets **`opacity: 1`**, **`pointer-events: auto`**, **`transition: opacity 0.15s ease`**. |

### “Bridge” from button to popover

- **`.clipboard-bubble::after`**: invisible hit target **`60px × 16px`** at **`bottom: -16px`**, **`left: 0`** — extends the interactive zone **downward** so the pointer can travel from the status button to the panel without leaving “bubble territory” (reduces accidental close during the gap).

### Caret

- **`.clipboard-bubble-caret`**: CSS triangle pointing **down** toward the trigger (`border-top` uses bubble background color), **`left: 12px`**, **`bottom: -6px`** — reinforces anchor relationship.

### Header

- Flex row: title **“Clipboard History”** (small, secondary text) + **clear** control (icon button, hover → error color).

### List

- **`.clipboard-bubble-list`**: **`overflow-y: auto`**, **`max-height: calc(100vh - 180px)`** — scrollable body; **6px** scrollbar, dark thumb (`#333`).

### Rows

- **`.clipboard-entry`**: padding **`8px 12px`**, **`cursor: pointer`**, transition on background.
- **Hover**: **`background: var(--bg-tertiary)`**.
- **Selected (keyboard / focus)** — **`.clipboard-entry-selected`**: same tertiary background **plus** **`border-left: 2px solid var(--accent)`** and **`padding-left: 10px`** (2px border eats 2px of left padding vs default 12px).
- **Primary line**: preview text, ellipsis, nowrap.
- **Meta line**: type label · relative time, smaller muted text.
- **Dividers** between rows: 1px, inset horizontal margins.

### Empty state

- Centered muted copy when there are no items.

### Toast (`.clipboard-toast`)

- **Fixed** near bottom center: **`bottom: 80px`**, **`left: 50%`**, **`transform`** for slide-up.
- **Glass**: **`background: rgba(30,30,30,0.85)`**, **`backdrop-filter: blur(12px)`**, light border, rounded, flex row with check icon + message.
- **`z-index: 2000`** — above the bubble.
- Enters with **`.visible`** (opacity + transform); auto-remove after ~2s.

---

## 3. Interaction: why the popover does not collapse when hovering the modal

This is a **small state machine** plus **timers**, not CSS alone.

### States

`clipboardBubbleState ∈ { CLOSED, PREVIEW, LOCKED, LEAVING }`

| State | Meaning |
|-------|---------|
| **CLOSED** | Popover hidden. |
| **PREVIEW** | Shown after hover delay; **not yet “sticky”** — leaving the trigger without touching the popover **closes immediately**. |
| **LOCKED** | **Sticky**: user is “in” the interaction — leaving the trigger is OK; leaving the **popover** starts dismiss only after a delay. |
| **LEAVING** | Pointer left the popover while locked; **dismiss timer** running — can be **canceled** by re-entering the popover or the trigger. |

### Timings (constants in code)

| Constant | Value | Role |
|----------|-------|------|
| `HOVER_DELAY` | **200 ms** | Delay before opening on trigger **mouseenter** (avoids accidental flashes). |
| `LOCK_DELAY` | **500 ms** | After open, time until state becomes **LOCKED** (from trigger hover path **or** from entering the bubble). |
| `DISMISS_DELAY` | **500 ms** | After **mouseleave** from bubble while **LOCKED**, delay before **hide**. |

### Event wiring

- **Trigger**: `mouseenter` / `mouseleave`, **`click`** (toggle open/locked on tap), **`click` + `touchstart` on document** for outside-close.
- **Popover**: `mouseenter` / `mouseleave`.

### Critical behaviors

1. **Hover open path**: `CLOSED` → (200ms) → `showBubble()` → `PREVIEW` → (500ms) → `LOCKED`.
2. **Leave trigger in PREVIEW**: If the user never reached the bubble, **`hideBubble()` immediately** (preview is fragile).
3. **Enter bubble in PREVIEW**: Cancel dismiss; start **same 500ms lock** from bubble so interaction promotes to **LOCKED** without requiring the trigger timer.
4. **Leave bubble while LOCKED**: Transition to **LEAVING**, start **500ms dismiss** — unless pointer re-enters bubble or trigger **re-lock** (cancel timer, `LOCKED`).
5. **Re-enter trigger from LEAVING**: Cancel dismiss, back to **LOCKED**.
6. **Click outside**: If target is neither popover nor trigger → **hide**.
7. **Keyboard**: **Escape** closes; **ArrowUp/ArrowDown** move selection; **Enter** copies selected row.

Together with the **`::after` bridge** pseudo-element, this makes **moving through the list** stable: once **LOCKED**, minor pointer slips don’t instantly dismiss; **LEAVING** gives a grace period to return.

---

## 4. List order, selection, and highlighting

### Internal array order vs display

- **`clipboardHistory`** is stored **newest-first** (`unshift` on add). Index **`0`** = most recently copied item in the **data model**.
- **On screen**, the list is **reversed**: **oldest at top**, **newest at bottom** (`[...clipboardHistory].reverse()`).
- **Mapping**: For each rendered row at `displayIdx`, **`historyIdx = clipboardHistory.length - 1 - displayIdx`** so DOM `data-index` matches the **array index** used for copy/splice.

### Default selection when opening

- **`selectedIndex = 0`** in array terms = **newest** item — which is the **bottom** row visually. After render, **`list.scrollTop = list.scrollHeight`** scrolls to show the newest at the bottom.

### Keyboard

- **ArrowUp** (toward older / visually up): **`selectedIndex++`**, wrap.
- **ArrowDown** (toward newer / visually down): **`selectedIndex--`**, wrap.
- **Update**: Toggle **`.clipboard-entry-selected`**; **`scrollIntoView({ block: 'nearest' })`** for the active row.

### Mouse

- Row **hover** uses **`.clipboard-entry:hover`** (tertiary background); **selected** row adds left accent border (can overlap visually with hover).

---

## 5. Data model and persistence (`clipboard.js`)

### Entry shape

```ts
{
  text: string;        // full payload
  type: string;        // 'link' | 'icon' | 'emoji' | 'contents' | 'context' | 'unknown' | …
  preview: string;     // short line for list UI
  timestamp: number;   // Date.now()
}
```

**Preview** is derived in one place (`generatePreview`) from `text` + `type` (e.g. icon markup → “Icon: name”, emoji → “Emoji: …”, long file → char count).

### Single write path

- **`clipboardWrite(text, type)`** → `navigator.clipboard.writeText` → **`addToClipboardHistory`** on success. All app copy flows should use this so history stays consistent.

### Ordering and capacity semantics

- **New insert**: **Remove duplicate** same `text` if present, then **`unshift(newEntry)`** — rerank to “most recent.”
- **Cap**: **`MAX_HISTORY = 20`**; **`clipboardHistory.slice(0, MAX_HISTORY)`** — drops the **oldest** entries at the **end** of the array. So **eviction** of overflow is **FIFO** on the **tail** of the newest-first list (the least recently (re)added items fall off).
- **“FIFO” in plain language**: The list is a **recency-ordered MRU cache**, not a strict queue of paste order only — **dedup** breaks pure FIFO of events, but **overflow eviction** removes the **stale end**.

### Persistence

- **`localStorage`** key **`fusion-clipboard-history`**, JSON array. Load on module init; save on every mutation.

### Re-copy from history

- **`copyAndDismiss`**: writes **`entry.text`** with **`navigator.clipboard.writeText`** **without** creating a duplicate history entry via `clipboardWrite` (comment: don’t re-add). Then **moves that item to front** (splice + unshift with new timestamp), saves, closes popover, shows toast.

### Clear

- Wipes array + `localStorage`, re-renders list, toast.

---

## 6. Integration hooks (for a future Kimi IDE synthesis)

- **Trigger**: A status-bar or toolbar control (id `clipboardBtn` in Fusion).
- **Stacking**: Popover **`z-index`** must sit above app shell; toasts above popover.
- **Optional server later**: Same entry schema could sync over WebSocket; **LOCK/PREVIEW** behavior stays UI-only.
- **Accessibility**: Consider `role="dialog"` / `aria-expanded`, focus trap, and visible focus ring when porting to React.

---

## 7. File map (Fusion Studio)

| Piece | Location |
|-------|----------|
| History + `clipboardWrite` | `viewer/js/clipboard.js` |
| Bubble UI, state machine, keyboard, toast | `viewer/js/main.js` (clipboard bubble section) |
| CSS | `viewer/styles.css` (clipboard bubble + toast blocks) |
| Trigger | `viewer/index.html` — `footer.status-bar` `#clipboardBtn` |

---

*Extracted for integration discussion; behavior described matches viewer sources as of extraction.*
