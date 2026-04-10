# SPEC-26d — View Chat as Floating Popup (FAB + Menu + Modal)

**Parent:** SPEC-26 (dual-chat paradigm, asymmetric final form)
**Position:** Phase 4 of 5 (final phase of the 26 series for the core dual-chat experience). Delivers the floating popup for view-scoped chats. After this lands, the project chat lives as a left-side column (26c + 26c-2) and the view chat lives as a draggable, resizable floating popup.
**Depends on:**
- 26a (`72d390e`), 26b (`e0913c2`), 26c (`536727e`) shipped
- 26c-2 shipped (left-column collapse/resize + right-side teardown + `viewStates` persistence + `state:get/set` wire messages)
- `FloatingChat.tsx` already exists (currently only wiki-viewer uses it)
**Model recommendation:** **Opus 4.6**. New component (ThreadPickerModal), rework of FloatingChat, extension of existing `viewStates` persistence. The simplification drops warm-state tracking entirely — the popup just reads the MRU thread list.
**Estimated blast radius:** **Medium.** Generalizes FloatingChat to be the universal view-chat popup. Extends the existing `viewStates` slice with a `popup` sub-object. New ThreadPickerModal component. Removes WikiExplorer's inline FloatingChat mount. No server changes — 26b handles view-scoped routing and 26c-2's `state:get/set` handles persistence.

---

## Your mission

Build the floating view-chat popup. Three work streams:

**Stream 1 — Universal FAB + FloatingChat at the app shell.**
Move FloatingChat mounting from `WikiExplorer.tsx` (its current home) up to `App.tsx` so every chat-enabled view gets one. FAB button lives in the bottom-right corner of the viewport. Single instance per app load. Only visible on chat-enabled views.

**Stream 2 — MRU-default open behavior + menu + exit.**
The FAB button behavior is dead simple — no warm-state tracking:
- **Click FAB** → open the popup. Read `threads.view` from the store (already MRU-sorted from the server's `thread:list`).
  - If `threads.view.length > 0` → open the popup bound to `threads.view[0]` (the most recently used view thread). Send `thread:open-assistant { scope: 'view', threadId: threads.view[0].threadId }` to activate it on the server.
  - If `threads.view.length === 0` → open the popup with ChatArea's "no active thread" state, which shows the harness picker inline.
- **Upper-LEFT: menu button** → opens `<ThreadPickerModal>` showing all view-scoped threads for the current view, MRU sorted. The "+ New Chat" button at the top creates a new thread via the harness picker. Picking an existing thread sends `thread:open-assistant`, which makes it MRU top. Modal closes.
- **Upper-RIGHT: exit button (X)** → popup closes. Per-view popup state (open/position/size) persists via `viewStates`.

**Stream 3 — Popup state persistence via `viewStates`.**
Extend the existing `viewStates` slice from 26c-2 with a `popup` sub-object. No new store slices, no new wire messages, no new server modules — just a richer shape in the same per-view JSON file.

The popup is draggable AND resizable (the user wants to stretch it). Position AND size persist per view.

---

**After this phase:**
- Every chat-enabled view has a floating popup accessible via a FAB in the bottom-right corner.
- Click FAB → popup opens with the most recent view thread (or harness picker if none exist).
- No warm-state tracking. Just read the thread list. The most recent thread is always the default.
- Menu button (upper-left) opens a thread picker modal for the current view.
- Exit button (upper-right, X) closes the popup. State persists.
- Popup is draggable AND resizable. Position + size remembered per view via the existing `viewStates` persistence layer.
- Whether the popup was open/closed also persists per view — returning to a view where the popup was open finds it open again.
- `WikiExplorer.tsx` no longer mounts FloatingChat inline — replaced by the universal mount in `App.tsx`.
- Browser refresh resets popup open/closed state (per `viewStates` persistence, which reads from the per-user JSON file — so position/size survive refresh but open state does too if persisted).

**You are not touching:**
- Any server code. No new wire messages. The existing `state:get/set` from 26c-2 handles popup state persistence. The existing `thread:open-assistant { scope: 'view' }` from 26b handles thread activation.
- Project chat (left column), its Sidebar, its ResizeHandles, its collapse state.
- SQLite schema.
- The frontmatter catalog, the agents area, the runner, the CSS architecture migration.
- Traffic lights / dock / right-click easter egg — all dropped.
- FIFO flushing rules — explicitly deferred.
- Workspace switching — not implemented yet.

---

## Design decisions locked in

**D1 — No warm-state tracking.**
Don't track `activeThreadId` per view. Don't maintain a separate store slice for "which thread was last in the popup." Just read `threads.view[0]` on every FAB click. The server returns threads in MRU order. Picking a thread via the menu sends `thread:open-assistant`, which touches `updated_at`, making it the new MRU top. The system is self-correcting.

**D2 — Popup state lives inside `viewStates`.**
Extend the existing `viewStates[panel]` shape (from 26c-2) with a `popup` sub-object:

```json
{
  "collapsed": { "leftSidebar": false, "leftChat": false },
  "widths": { "leftSidebar": 220, "leftChat": 320 },
  "popup": {
    "open": false,
    "x": 800,
    "y": 300,
    "width": 420,
    "height": 520
  }
}
```

Same file (`ai/views/<view>/state/<username>.json`), same `state:get/set` wire messages, same server module. Just a richer object. The server's `writeViewStatePatch` already merges partial patches, so sending `{ popup: { x: 500 } }` correctly deep-merges.

**D3 — Popup is resizable as well as draggable.**
Four edges + four corners as resize affordances (or simpler: a resize handle at the bottom-right corner). Min size ~300×300. Max size ~800×700 (or whatever feels right). Size persists alongside position.

**D4 — `popup.open` persists per view.**
When the user closes the popup in code-viewer and switches to issues-viewer, then comes back to code-viewer, the popup is still closed (they have to click FAB). But if they left the popup OPEN and switch away, returning to code-viewer finds it open again. This is because `popup.open` is stored in `viewStates[panel]` and persisted via the JSON file.

On view switch: the `floatingChatOpen` runtime flag is still global (reset on switch per 26c's `setCurrentPanel`). But when the new view loads its `viewStates`, the popup's `open` field from the file is read and the runtime flag is synced to it.

**D5 — FAB visible only on chat-enabled views.**
If a view has `hasChat === false` (from its content.json), the FAB is not rendered. Check `config.hasChat` from `panelStore.getPanelConfig(currentPanel)`.

**D6 — Thread picker modal is view-scoped.**
Shows only `threads.view` (not project threads). Sorted by the order the server returned them (MRU). "+ New Chat" at the top. Click a thread → `thread:open-assistant { scope: 'view', threadId }` → close modal → popup switches. Escape or backdrop click to dismiss.

---

## Context before you touch code

Read these in order:

1. **`ai/views/wiki-viewer/content/enforcement/code-standards/PAGE.md`** — house rules.
2. **`ai/views/capture-viewer/content/todo/specs/26c-2-dual-chat-slider-persistence.md`** — understand the existing `viewStates` persistence layer you're extending.
3. **`open-robin-client/src/components/FloatingChat.tsx`** (all ~115 lines) — the file you rework.
4. **`open-robin-client/src/components/wiki/WikiExplorer.tsx`** — find the FloatingChat mount you're removing.
5. **`open-robin-client/src/components/App.tsx`** — mount FloatingChat at the top level.
6. **`open-robin-client/src/state/panelStore.ts`** — read the existing `viewStates` slice from 26c-2 and the `threads: { project, view }` shape from 26c.
7. **`open-robin-client/src/lib/ws/thread-handlers.ts`** — understand how `thread:list` populates `threads.view`.

### Pre-prod wipe

```bash
pkill -9 -f "node.*server.js" 2>/dev/null; sleep 1
sqlite3 /Users/rccurtrightjr./projects/open-robin/ai/system/robin.db "PRAGMA foreign_keys=ON; DELETE FROM threads;"
find /Users/rccurtrightjr./projects/open-robin/ai/views/chat/threads -type f -name '*.md' -delete 2>/dev/null
find /Users/rccurtrightjr./projects/open-robin/ai/views/*/chat/threads -type f -name '*.md' -delete 2>/dev/null
rm -rf /Users/rccurtrightjr./projects/open-robin/ai/views/*/state/ 2>/dev/null
```

---

## Changes — file by file

### 1. `open-robin-client/src/types/index.ts`

Extend `ViewUIState` to include the popup sub-object:

```ts
export interface PopupState {
  open: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewUIState {
  collapsed: {
    leftSidebar: boolean;
    leftChat: boolean;
  };
  widths: {
    leftSidebar: number;
    leftChat: number;
  };
  popup?: PopupState;  // SPEC-26d — optional so old state files still parse
}
```

The `popup` field is optional to handle backward compat with pre-26d state files. Missing popup → use defaults (closed, default position/size).

---

### 2. `open-robin-client/src/state/panelStore.ts`

**2a. Add popup defaults.**

```ts
const DEFAULT_POPUP: PopupState = {
  open: false,
  x: -1,  // -1 means "compute default on first render" (bottom-right with padding)
  y: -1,
  width: 420,
  height: 520,
};
```

**2b. Add popup actions to the AppState interface.**

```ts
interface AppState {
  // ... existing ...

  // SPEC-26d: floating popup for view chats
  openFloatingChat: () => void;
  closeFloatingChat: () => void;
  setPopupPosition: (panel: string, x: number, y: number) => void;
  setPopupSize: (panel: string, width: number, height: number) => void;
  commitPopupState: (panel: string) => void;  // persist after drag/resize ends
}
```

**2c. Implementations.**

```ts
openFloatingChat: () => {
  const state = get();
  const panel = state.currentPanel;
  const threads = state.threads.view;
  const ws = state.ws;

  // If there are view threads, activate the MRU one on the server
  if (threads.length > 0 && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'thread:open-assistant',
      scope: 'view',
      threadId: threads[0].threadId,
    }));
  }
  // If no threads, ChatArea will show the harness picker automatically
  // (its existing "no active view thread" behavior)

  // Update popup.open in viewStates
  set((s) => {
    const vs = s.viewStates[panel] || { ...DEFAULT_VIEW_UI_STATE };
    const popup = vs.popup || { ...DEFAULT_POPUP };
    return {
      viewStates: {
        ...s.viewStates,
        [panel]: { ...vs, popup: { ...popup, open: true } },
      },
    };
  });
},

closeFloatingChat: () => {
  const panel = get().currentPanel;
  set((s) => {
    const vs = s.viewStates[panel];
    if (!vs?.popup) return s;
    return {
      viewStates: {
        ...s.viewStates,
        [panel]: { ...vs, popup: { ...vs.popup, open: false } },
      },
    };
  });
  // Persist the close state
  get().commitPopupState(panel);
},

setPopupPosition: (panel, x, y) => set((s) => {
  const vs = s.viewStates[panel] || { ...DEFAULT_VIEW_UI_STATE };
  const popup = vs.popup || { ...DEFAULT_POPUP };
  return {
    viewStates: {
      ...s.viewStates,
      [panel]: { ...vs, popup: { ...popup, x, y } },
    },
  };
}),

setPopupSize: (panel, width, height) => set((s) => {
  const vs = s.viewStates[panel] || { ...DEFAULT_VIEW_UI_STATE };
  const popup = vs.popup || { ...DEFAULT_POPUP };
  return {
    viewStates: {
      ...s.viewStates,
      [panel]: { ...vs, popup: { ...popup, width, height } },
    },
  };
}),

commitPopupState: (panel) => {
  const state = get();
  const vs = state.viewStates[panel];
  if (!vs?.popup) return;
  const ws = state.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    type: 'state:set',
    view: panel,
    state: { popup: vs.popup },
  }));
},
```

**2d. On `setCurrentPanel` — sync popup open state from loaded viewStates.**

When the user returns to a view and its `viewStates` are loaded, check `vs.popup.open`. If true, the popup should re-open. Add to the `state:result` handler flow:

In `ws-client.ts` (or wherever `state:result` is handled), after `store.setViewState(msg.view, msg.state)`, check:

```ts
// If the loaded view state says popup was open, and this IS the current panel, re-open
if (msg.view === store.currentPanel && msg.state.popup?.open) {
  store.openFloatingChat();
}
```

This handles the "return to a view where the popup was left open" case.

---

### 3. `open-robin-client/src/components/FloatingChat.tsx` — rework

Rewrite to use the store-based popup state instead of local component state. Keep the draggable logic. Add resize logic. Add the menu button. Remove the `panel` prop (reads `currentPanel` from store). Make the FAB conditional on `hasChat`.

```tsx
/**
 * @module FloatingChat
 * @role Universal floating popup for view-scoped chats.
 *
 * SPEC-26d: mounted once at the app shell level (in App.tsx).
 * FAB button always visible on chat-enabled views. Popup opens
 * to the MRU view thread (or harness picker if none exist).
 * Menu button → ThreadPickerModal. X → close with state preserved.
 * Draggable by header. Resizable from bottom-right corner.
 * Position + size persisted per view via viewStates.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { usePanelStore } from '../state/panelStore';
import { ChatArea } from './ChatArea';
import { ThreadPickerModal } from './ThreadPickerModal';

const MIN_WIDTH = 300;
const MIN_HEIGHT = 300;
const MAX_WIDTH = 800;
const MAX_HEIGHT = 700;
const DEFAULT_PADDING = 80;

export function FloatingChat() {
  const currentPanel = usePanelStore((s) => s.currentPanel);
  const hasChat = usePanelStore((s) => {
    const config = s.panelConfigs.find(c => c.id === currentPanel);
    return !!config?.hasChat;
  });
  const popupState = usePanelStore((s) => s.viewStates[currentPanel]?.popup);
  const openFloatingChat = usePanelStore((s) => s.openFloatingChat);
  const closeFloatingChat = usePanelStore((s) => s.closeFloatingChat);
  const setPopupPosition = usePanelStore((s) => s.setPopupPosition);
  const setPopupSize = usePanelStore((s) => s.setPopupSize);
  const commitPopupState = usePanelStore((s) => s.commitPopupState);

  const [modalOpen, setModalOpen] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);

  // Don't render FAB on views without chat
  if (!hasChat) return null;

  const isOpen = popupState?.open ?? false;

  // Resolve position: -1 means "compute default"
  let posX = popupState?.x ?? -1;
  let posY = popupState?.y ?? -1;
  if (posX < 0 || posY < 0) {
    posX = window.innerWidth - (popupState?.width ?? 420) - DEFAULT_PADDING;
    posY = window.innerHeight - (popupState?.height ?? 520) - DEFAULT_PADDING;
  }
  const popupWidth = popupState?.width ?? 420;
  const popupHeight = popupState?.height ?? 520;

  // --- Drag handlers ---
  const handleDragMouseDown = useCallback((e: React.MouseEvent) => {
    if (!(e.target as HTMLElement).closest('.floating-chat-header')) return;
    if ((e.target as HTMLElement).closest('button')) return; // don't drag when clicking buttons
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: posX, origY: posY };

    const handleMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      setPopupPosition(
        currentPanel,
        dragRef.current.origX + (ev.clientX - dragRef.current.startX),
        dragRef.current.origY + (ev.clientY - dragRef.current.startY),
      );
    };

    const handleUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      commitPopupState(currentPanel);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [posX, posY, currentPanel, setPopupPosition, commitPopupState]);

  // --- Resize handlers (bottom-right corner) ---
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: popupWidth, origH: popupHeight };
    document.body.style.userSelect = 'none';

    const handleMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const newW = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH,
        resizeRef.current.origW + (ev.clientX - resizeRef.current.startX)));
      const newH = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT,
        resizeRef.current.origH + (ev.clientY - resizeRef.current.startY)));
      setPopupSize(currentPanel, newW, newH);
    };

    const handleUp = () => {
      resizeRef.current = null;
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      commitPopupState(currentPanel);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [popupWidth, popupHeight, currentPanel, setPopupSize, commitPopupState]);

  return (
    <>
      {/* Floating chat panel */}
      {isOpen && (
        <>
          <div
            className="floating-chat-panel"
            style={{
              left: `${posX}px`,
              top: `${posY}px`,
              width: `${popupWidth}px`,
              height: `${popupHeight}px`,
            }}
            onMouseDown={handleDragMouseDown}
          >
            <div className="floating-chat-header">
              {/* Menu button (upper-left) */}
              <button
                className="floating-chat-menu-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setModalOpen(true);
                }}
                title="Switch thread"
              >
                <span className="material-symbols-outlined">menu</span>
              </button>

              {/* Title */}
              <span className="floating-chat-title">{currentPanel} assistant</span>

              {/* Exit button (upper-right) */}
              <button
                className="floating-chat-close"
                onClick={closeFloatingChat}
                title="Close"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="floating-chat-body">
              <ChatArea panel={currentPanel} scope="view" />
            </div>

            {/* Resize handle (bottom-right corner) */}
            <div
              className="floating-chat-resize-handle"
              onMouseDown={handleResizeMouseDown}
            />
          </div>

          {/* Thread picker modal */}
          {modalOpen && (
            <ThreadPickerModal
              panel={currentPanel}
              onClose={() => setModalOpen(false)}
            />
          )}
        </>
      )}

      {/* FAB button — visible when popup is closed */}
      {!isOpen && (
        <button
          className="floating-chat-fab"
          onClick={openFloatingChat}
          title="Open chat"
        >
          <span
            className="material-symbols-outlined"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            chat_bubble
          </span>
        </button>
      )}
    </>
  );
}
```

Key differences from the old version:
- No `panel` prop — reads `currentPanel` from store
- No local position/open state — reads from `viewStates[panel].popup`
- Drag updates go through store actions (persist on mouseup)
- Resize handle added (bottom-right corner)
- Menu button added (upper-left)
- FAB conditionally hidden on views without chat
- No warm-state tracking — `openFloatingChat` reads `threads.view[0]`

---

### 4. `open-robin-client/src/components/ThreadPickerModal.tsx` — new component

```tsx
/**
 * @module ThreadPickerModal
 * @role Modal for switching between view-scoped threads.
 *
 * SPEC-26d: opened by the menu button in FloatingChat's header.
 * Shows all view-scoped threads for the current panel, MRU sorted.
 * "+ New Chat" at the top creates a new thread via the harness picker.
 */

import { useEffect, useCallback } from 'react';
import { usePanelStore } from '../state/panelStore';
import type { Thread } from '../types';

interface ThreadPickerModalProps {
  panel: string;
  onClose: () => void;
}

export function ThreadPickerModal({ panel, onClose }: ThreadPickerModalProps) {
  const threads = usePanelStore((s) => s.threads.view);
  const currentThreadId = usePanelStore((s) => s.currentThreadIds.view);
  const ws = usePanelStore((s) => s.ws);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleNewChat = useCallback(() => {
    // Clear the current view thread so ChatArea shows the harness picker.
    const store = usePanelStore.getState();
    store.setCurrentThreadId('view', null);
    onClose();
  }, [onClose]);

  const handlePick = useCallback((threadId: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'thread:open-assistant',
      scope: 'view',
      threadId,
    }));
    onClose();
  }, [ws, onClose]);

  // threads.view is already MRU-sorted from the server
  return (
    <div className="rv-modal-backdrop" onClick={onClose}>
      <div
        className="rv-modal rv-thread-picker-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Pick a view chat thread"
      >
        <div className="rv-modal-header">
          <h3>Switch chat</h3>
          <button className="rv-modal-close" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <button className="rv-thread-picker-new" onClick={handleNewChat}>
          <span className="material-symbols-outlined">add</span>
          New chat
        </button>

        <div className="rv-thread-picker-list">
          {threads.length === 0 ? (
            <div className="rv-thread-picker-empty">No previous chats for this view.</div>
          ) : (
            threads.map((thread: Thread) => (
              <button
                key={thread.threadId}
                className={`rv-thread-picker-item ${thread.threadId === currentThreadId ? 'rv-thread-picker-item--active' : ''}`}
                onClick={() => handlePick(thread.threadId)}
              >
                <span className="rv-thread-picker-name">
                  {thread.entry?.name || thread.threadId.replace(/-\d{3}$/, '')}
                </span>
                <span className="rv-thread-picker-meta">
                  {thread.entry?.messageCount || 0} msgs
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
```

---

### 5. `open-robin-client/src/components/App.tsx` — mount FloatingChat at the app shell

**5a. Import.**

```tsx
import { FloatingChat } from './FloatingChat';
```

**5b. Mount at the end of the main render tree.**

After the panel container (or alongside Toast / ModalOverlay), add:

```tsx
<FloatingChat />
```

The component reads `currentPanel` internally. It handles `hasChat` visibility gating.

---

### 6. `open-robin-client/src/components/wiki/WikiExplorer.tsx` — remove inline mount

**6a. Remove import.**

```tsx
import { FloatingChat } from '../FloatingChat';
```
DELETE.

**6b. Remove JSX mount.**

```tsx
<FloatingChat panel="rv-wiki-viewer" />
```
DELETE.

---

### 7. `open-robin-client/src/components/App.css` — popup + modal styles

**7a. FloatingChat enhancements.**

Existing floating-chat CSS is already in App.css. Augment:

```css
/* SPEC-26d: menu button in the popup header */
.floating-chat-menu-btn {
  background: transparent;
  border: none;
  color: var(--text-dim, #888);
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
}

.floating-chat-menu-btn:hover {
  color: var(--theme-primary, #888);
}

/* Header layout: menu left, title center (flex-grow), close right */
.floating-chat-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: move;
  user-select: none;
}

.floating-chat-title {
  flex: 1;
  font-size: 13px;
  color: var(--text-primary, #ddd);
}

/* Popup panel — now with explicit width/height from inline style */
.floating-chat-panel {
  position: fixed;
  z-index: var(--z-popup, 300);
  background: var(--bg-surface, #1a1a1a);
  border: 1px solid var(--theme-border, #444);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-medium, 0 4px 16px rgba(0, 0, 0, 0.4));
  overflow: hidden;
}

.floating-chat-body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* Resize handle — small triangle/affordance at the bottom-right corner */
.floating-chat-resize-handle {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 16px;
  height: 16px;
  cursor: nwse-resize;
  /* Optional: a subtle visual indicator */
  background: linear-gradient(135deg, transparent 50%, var(--text-dim, #555) 50%);
  opacity: 0.3;
  border-radius: 0 0 8px 0;
}

.floating-chat-resize-handle:hover {
  opacity: 0.6;
}
```

**7b. Modal styles (same as previous draft — ThreadPickerModal).**

```css
.rv-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.rv-modal {
  background: var(--bg-surface, #1a1a1a);
  border: 1px solid var(--theme-border, #444);
  border-radius: 8px;
  padding: 16px;
  min-width: 360px;
  max-width: 480px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
}

.rv-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.rv-modal-header h3 {
  margin: 0;
  font-size: 14px;
  color: var(--text-primary, #ddd);
}

.rv-modal-close {
  background: transparent;
  border: none;
  color: var(--text-dim, #888);
  cursor: pointer;
}

.rv-thread-picker-new {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
  background: var(--theme-primary, #888);
  border: none;
  border-radius: 6px;
  color: white;
  cursor: pointer;
  font-size: 13px;
}

.rv-thread-picker-new:hover {
  opacity: 0.9;
}

.rv-thread-picker-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.rv-thread-picker-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--text-primary, #ddd);
  cursor: pointer;
  text-align: left;
}

.rv-thread-picker-item:hover {
  background: var(--bg-hover, rgba(255, 255, 255, 0.05));
  border-color: var(--theme-border, #444);
}

.rv-thread-picker-item--active {
  background: var(--bg-active, rgba(255, 255, 255, 0.08));
  border-color: var(--theme-primary, #888);
}

.rv-thread-picker-name { font-size: 13px; }
.rv-thread-picker-meta { font-size: 11px; color: var(--text-dim, #888); }
.rv-thread-picker-empty { padding: 16px; text-align: center; color: var(--text-dim, #888); font-size: 13px; }
```

---

### 8. `open-robin-client/src/lib/ws-client.ts` — sync popup open state on view load

After the existing `state:result` handler sets `store.setViewState(msg.view, msg.state)`, add:

```ts
// SPEC-26d: if the loaded view state says popup was open AND this is
// the current panel, sync the popup visibility.
const currentPanel = usePanelStore.getState().currentPanel;
if (msg.view === currentPanel && msg.state?.popup?.open) {
  usePanelStore.getState().openFloatingChat();
}
```

This handles the "return to a view where the popup was left open" and the "browser refresh restores popup if the state file says open" scenarios.

---

### 9. `open-robin-server/lib/view-state/index.js` — minor update for deep merge

The existing `writeViewStatePatch` merges `collapsed` and `widths`. It needs to also merge `popup`:

```js
async function writeViewStatePatch(projectRoot, viewId, username, patch) {
  const current = (await readViewState(projectRoot, viewId, username)) || {};
  const merged = {
    collapsed: { ...(current.collapsed || {}), ...(patch.collapsed || {}) },
    widths:    { ...(current.widths    || {}), ...(patch.widths    || {}) },
    popup:     { ...(current.popup     || {}), ...(patch.popup     || {}) },
  };
  await writeViewState(projectRoot, viewId, username, merged);
  return merged;
}
```

One line added to the merge — `popup: { ... }`. Same atomic-write pattern.

Also update `resolveViewState` to include popup defaults:

```js
async function resolveViewState(projectRoot, viewId, username) {
  const userState = await readViewState(projectRoot, viewId, username);
  const defaults = getDefaults(projectRoot, viewId);

  return {
    collapsed: { /* ... existing ... */ },
    widths:    { /* ... existing ... */ },
    popup: {
      open:   userState?.popup?.open   ?? false,
      x:      userState?.popup?.x      ?? -1,
      y:      userState?.popup?.y      ?? -1,
      width:  userState?.popup?.width  ?? 420,
      height: userState?.popup?.height ?? 520,
    },
  };
}
```

---

## Test plan

### Static checks

```bash
cd /Users/rccurtrightjr./projects/open-robin/open-robin-client
npx tsc --noEmit
npm run build
```

### Live validation — 18-item checklist

**FAB presence:**
1. Chat-enabled view (code-viewer) → FAB visible in bottom-right.
2. Non-chat view (calendar-viewer) → NO FAB. Just content.
3. Project chat left column still works independently (26c-2 intact).

**First click (empty view):**
4. Click FAB with no view threads. Popup opens. ChatArea shows harness picker.
5. Pick Kimi. Thread created (`scope=view`). Chat area becomes live. Send a message.

**Close + reopen (MRU default):**
6. Click X. Popup closes. FAB reappears.
7. Click FAB. Popup re-opens with the same thread (it's MRU top).
8. Send another message to confirm the wire is live.

**Menu + thread picker:**
9. Click menu button (upper-left, `menu` icon). Modal opens.
10. Modal shows the thread from step 5 (at the top — MRU).
11. Click "+ New Chat". Popup shows harness picker. Pick a harness. New thread created.
12. Click menu again. Two threads listed. Previous MRU is now second.
13. Click the older thread. Popup switches to it. Modal closes.

**Per-view independence:**
14. Create a view thread in code-viewer. Close the popup.
15. Switch to issues-viewer. Click FAB → harness picker (no threads yet for this view).
16. Create a thread in issues-viewer. Close.
17. Switch back to code-viewer. Click FAB → code-viewer's thread (not issues-viewer's).

**Drag + resize + persistence:**
18. Drag the popup header to a new position. Close. Reopen. Position preserved.
19. Drag the bottom-right resize handle. Popup grows/shrinks. Close. Reopen. Size preserved.
20. Refresh the browser. Open code-viewer. State from the JSON file loads — position and size preserved. Open state depends on whether it was open when the JSON was last written.

**Modal dismissal:**
21. Open modal. Click outside. Closes.
22. Open modal. Press Escape. Closes.

### What breaks if you get it wrong

| Failure | Root cause | Fix |
|---|---|---|
| FAB shows on calendar-viewer | `hasChat` check missing | Read `panelConfigs.find(c => c.id === currentPanel)?.hasChat` |
| First click does nothing | `openFloatingChat` not wired to FAB onClick | Check the wiring |
| First click creates a thread instead of showing harness picker | `threads.view` is non-empty from a different session | Pre-prod wipe, or the store's `threads.view` has stale data from a prior view |
| Popup reopens with wrong thread | `threads.view[0]` is not the expected one | Verify the server's MRU ordering via `thread:list` response |
| Menu shows project threads | ThreadPickerModal reading `threads.project` | Must read `threads.view` |
| "+ New Chat" doesn't clear the current thread | `setCurrentThreadId('view', null)` not called | Check `handleNewChat` implementation |
| Popup position not persisted | `commitPopupState` not called on drag end | Check handleUp in drag handler |
| Resize exceeds min/max | Clamp missing | `Math.max(MIN, Math.min(MAX, value))` in resize handler |
| Wiki-viewer broken | Old inline FloatingChat mount still exists | Check step 6 — both import and JSX mount must be gone |
| Popup fights with drag on button click | Button clicks bubble to the header's mousedown | Check `e.stopPropagation()` on button clicks AND `if (closest('button')) return` in drag handler |
| Popup state doesn't survive view switch | `state:set` not persisting popup | Check `commitPopupState` is called on close and after drag/resize |

---

## Do not do

- **Do not** track `activeThreadId` per view. Just read `threads.view[0]`. The system is self-correcting — picking a thread makes it MRU.
- **Do not** create a separate `viewChatStates` store slice. Extend the existing `viewStates` with a `popup` sub-object.
- **Do not** add any server code beyond the one-line deep-merge update in `view-state/index.js`.
- **Do not** add traffic lights, dock, right-click shortcut, or multiple popups.
- **Do not** implement FIFO flushing or workspace-switch reset.
- **Do not** touch the project chat column, Sidebar, ResizeHandle, or viewStates collapse/widths.
- **Do not** touch the wire protocol (`thread:*` messages). Existing `thread:open-assistant { scope: 'view' }` is sufficient.
- **Do not** persist warm state (which thread is "the active one"). The MRU list is the only source of truth. No `activeThreadId` field in the store or the JSON file.
- **Do not** create a separate `FAB.tsx` component. The FAB lives inside FloatingChat.tsx.
- **Do not** add multiple resize handles (edges + corners). Start with one handle at the bottom-right corner. Richer resize can come later.
- **Do not** touch agents-viewer, runner, frontmatter catalog, CSS migration.

---

## Commit message template

```
SPEC-26d: view chat as floating popup (FAB + menu + modal)

Delivers the floating popup for view-scoped chats, completing the
asymmetric dual-chat layout: project chat as a left sidebar column
(26c + 26c-2), view chat as a draggable/resizable floating popup.

Simplification over the previous draft: no warm-state tracking.
The popup just opens to the MRU view thread (threads.view[0]). If
no view threads exist, ChatArea shows the harness picker inline.
Picking a thread via the menu sends thread:open-assistant which
makes it MRU top — the system is self-correcting.

New files:
  - ThreadPickerModal.tsx — modal listing view-scoped threads for
    the current panel (MRU order). "+ New Chat" at the top runs the
    harness picker. Click a thread → activate + close modal.

Reworked:
  - FloatingChat.tsx — no longer takes a panel prop; reads
    currentPanel from the store. FAB visible on chat-enabled views
    only (hasChat gate). Popup state (open/position/size) comes from
    viewStates[panel].popup (not local component state). Draggable
    by header; resizable via bottom-right corner handle. Menu button
    (upper-left) → ThreadPickerModal. X (upper-right) → close with
    state preserved. Drag/resize commit to server on mouseup via
    existing state:set wire messages from 26c-2.

Extended:
  - panelStore.ts — viewStates gains popup sub-object. New actions:
    openFloatingChat (reads threads.view[0]), closeFloatingChat,
    setPopupPosition, setPopupSize, commitPopupState.
  - types/index.ts — PopupState interface.
  - lib/view-state/index.js — one-line addition: deep-merge popup
    field in writeViewStatePatch + defaults in resolveViewState.
  - ws-client.ts — state:result handler syncs popup.open on view
    load so returning to a view with the popup left open finds it
    open again.

Removed:
  - WikiExplorer.tsx — inline <FloatingChat panel="..."> mount
    replaced by the universal mount in App.tsx.

Added CSS:
  - Menu button + header flex layout
  - Resize handle (bottom-right corner, nwse-resize cursor)
  - Modal backdrop + thread picker list styles

Per-view popup state persisted via 26c-2's existing viewStates
JSON file at ai/views/<view>/state/<username>.json:
  { ..., popup: { open, x, y, width, height } }

No new wire messages. No new server modules. One server-side
one-liner for the popup merge in writeViewStatePatch.

Live-validated: FAB presence + first-click harness picker +
MRU-default restore + menu modal + new chat + thread switching +
per-view independence + drag + resize + position/size persistence
+ refresh behavior + modal dismiss (escape + backdrop).

Part of SPEC-26 (dual-chat paradigm, asymmetric final form).
This is the last core 26 phase.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

## Report back

1. **Diff stats.** Expected: FloatingChat.tsx (~150 lines rewritten), new ThreadPickerModal.tsx (~100), panelStore.ts (~60 net), App.tsx small (~5), WikiExplorer.tsx small (~-5), App.css medium (~120), types/index.ts small (~10), ws-client.ts small (~5), view-state/index.js small (~5).

2. **Static checks.** tsc + npm build.

3. **Live validation.** Run all 22 items. Focus on:
   - First-click → harness picker works inside the popup
   - Subsequent click → MRU thread loads correctly
   - Menu modal → new chat clears view thread and shows picker
   - Per-view independence (two views, different threads)
   - Drag AND resize work, positions persist

4. **State file audit.** `cat ai/views/code-viewer/state/<username>.json` after using the popup. Confirm `popup` sub-object is present alongside the existing `collapsed` and `widths`.

5. **Surprises.** Especially: does the `state:result` handler correctly sync `popup.open` on view return? Does the WikiExplorer removal cause any wiki-specific breakage?

6. **Files outside the change list.** Expected: zero except the one-line view-state/index.js update (listed).

Hand the report back to the orchestrator.
