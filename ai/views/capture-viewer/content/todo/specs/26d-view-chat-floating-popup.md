# SPEC-26d — View Chat as Floating Popup (FAB + Menu + Modal)

**Parent:** SPEC-26 (dual-chat paradigm, asymmetric final form)
**Position:** Phase 4 of 5 (final phase of the 26 series for the core dual-chat experience). Delivers the floating popup for view-scoped chats. After this lands, the project chat lives as a left-side column (26c + 26c-2) and the view chat lives as a draggable floating popup with per-view warm state.
**Depends on:**
- 26a (`72d390e`), 26b (`e0913c2`), 26c (`536727e`) shipped
- 26c-2 shipped (left-column collapse/resize + right-side teardown)
- `FloatingChat.tsx` already exists (currently only wiki-viewer uses it)
**Model recommendation:** **Opus 4.6**. New components (FAB logic + thread picker modal), new per-view state slice with non-obvious semantics (warm state, "first click = new chat"), interaction with the existing FloatingChat component, careful wire lifecycle integration.
**Estimated blast radius:** **Medium.** Generalizes FloatingChat to be the universal view-chat popup. New store slice. New ThreadPickerModal component. Removes WikiExplorer's inline FloatingChat mount. No server changes — 26b already handles view-scoped routing and the server doesn't need to know about popup visibility.

---

## Your mission

Build the floating view-chat popup with per-view warm state. Four work streams:

**Stream 1 — Universal FAB + FloatingChat at the app shell.**
Move FloatingChat mounting from `WikiExplorer.tsx` (its current home) up to `App.tsx` so every chat-enabled view gets one. FAB button lives in the bottom-right corner of the viewport. Single instance per app load.

**Stream 2 — First-click semantics + warm state.**
The FAB button behaves based on the current view's state:
- **First click in a view (no warm chat yet)** → opens the harness picker (two-step wizard eventually, per the saved memory on `project_two_step_harness_picker`, but this spec just uses the existing `<ChatHarnessPicker>` flow). User picks a harness, a new view-scoped thread is created, the popup opens to it. That thread becomes the view's warm chat.
- **Subsequent click in the same view** → popup re-opens bound to the warm chat. No harness picker, no new thread. Same conversation state.
- **After picking a different thread via the menu** → the picked thread becomes the new warm chat (replaces the previous warm chat).

**Stream 3 — Menu + Exit buttons on the popup header.**
- **Upper-LEFT: menu button** (small icon, e.g. `menu` material symbol). Click → opens `<ThreadPickerModal>` showing all view-scoped threads for the current view, most recent first.
- **Upper-RIGHT: exit button** (the existing X close). Click → popup closes. Warm state preserved. Click FAB again to re-open.

**Stream 4 — Thread picker modal.**
- **"+ New Chat" button at the top** → runs the harness picker flow, creates a new thread, activates it as the warm chat, closes the modal.
- **Scrollable list of threads** below, sorted by `updated_at` descending (most recent first). The current warm chat is at the top of the list (because it was most recently active).
- **Click a thread** → switches the popup to that thread, closes the modal. Thread becomes the new warm chat.
- **Click outside or press Escape** → closes the modal without changing anything.

---

**After this phase:**
- Every chat-enabled view has a floating popup accessible via a FAB in the bottom-right corner.
- Per-view warm state: each view remembers its currently-active popup chat independently. Switching views does not affect other views' warm state.
- First click in a fresh view opens the harness picker. Subsequent clicks surface the warm chat directly.
- Menu button opens a thread picker modal for the current view's threads; picking one replaces the warm chat.
- Exit button (X) hides the popup but preserves all state in RAM.
- Browser refresh wipes all warm state (current reality — future workspace switcher + flushing system will formalize RAM lifecycle).
- Draggable popup with position remembered per view.
- `WikiExplorer.tsx` no longer mounts FloatingChat inline — replaced by the universal mount in `App.tsx`.

**You are not touching:**
- Any server code. 26b's view-scope routing is unchanged. 26c-2's view-state persistence is unrelated (it's for left-column widths/collapse, not popup state). No new wire messages.
- Project chat (left column), its Sidebar, its ResizeHandles, its collapse state. All of that is untouched.
- SQLite schema. No new tables or columns.
- The frontmatter catalog, the agents area, the runner, the CSS architecture migration.
- Traffic lights (red/yellow/green) — dropped per the simplification conversation.
- Dock / minimized chats — dropped per the simplification.
- Right-click on FAB easter egg — dropped per the simplification.
- Harness wizard per side (separate from harness picker — deferred to a future spec or the two-step-wizard spec).
- FIFO flushing rules — explicitly deferred. For now, warm state lives until browser refresh.
- Workspace switching — not implemented yet; when it is, the future flushing work will reset view-chat warm state on workspace switch.

---

## Design decisions locked in (from the iterative conversation)

**D1 — Warm state is per-view.**
Each chat-enabled panel has its own `viewChatState` slot in the store: `{ activeThreadId, position }`. Switching panels does not touch other panels' slots. First click in a fresh panel → harness picker. Subsequent click in same panel → restore warm chat.

**D2 — FAB is global UI, state is per-view.**
The FAB button is mounted once at the app shell level. It reads the CURRENT panel's `viewChatState` to decide what happens on click. There is only ever ONE floating popup visible at a time (belongs to the current panel). Switching panels hides the popup; returning to a panel does NOT auto-reopen — user must click the FAB again. When they click, it restores the warm chat.

**D3 — The `floatingChatOpen` flag is global AND ephemeral.**
One boolean in the store: `floatingChatOpen`. Reflects whether the popup is currently visible. Switching panels sets it to false. Closing via X sets it to false. Clicking the FAB sets it to true. Refresh resets to false.

**D4 — Warm state IS just "which thread was last active in this view."**
Nothing more. No "is it open" flag per view. No "position per thread." Just `activeThreadId` and `position` per view. The "open/closed" is a global property of the current view.

**D5 — Thread picker is a modal, scoped to the current view.**
The modal lists view-scoped threads for the current panel only (not project threads, not other views' threads). Sorted by `updated_at` DESC. Has a "+ New Chat" button at the top. Picking a thread activates it as the warm chat and opens the popup to it.

**D6 — No server-side changes.**
Everything is client state plus existing wire messages (`thread:open-assistant`, `thread:list`). The server already supports view-scoped thread creation/listing via 26b's `scope` field. All 26d needs is client-side wiring.

**D7 — Position is draggable and remembered per view.**
Each panel's `viewChatState.position` stores `{ x, y }`. Drag the popup header to update. `null` means "use the default position" (bottom-right). Persists in RAM only; refresh resets.

**D8 — Browser refresh wipes all warm state.**
Not a bug — it's the interim behavior until the flushing system is built. Don't persist warm state to disk or localStorage.

---

## Context before you touch code

Read these in order:

1. **`ai/views/wiki-viewer/content/enforcement/code-standards/PAGE.md`** — house rules.
2. **`ai/views/capture-viewer/content/todo/specs/26a-dual-chat-data-model.md`** — scope data model.
3. **`ai/views/capture-viewer/content/todo/specs/26b-dual-chat-routing-layer.md`** — scope routing and wire protocol.
4. **`ai/views/capture-viewer/content/todo/specs/26c-dual-chat-client-layout.md`** — client state split (scope-keyed threads, `currentThreadIds.view`, etc.) that this spec consumes.
5. **`ai/views/capture-viewer/content/todo/specs/26c-2-dual-chat-slider-persistence.md`** — left-column collapse/resize work. 26d does NOT touch any of it.
6. **`open-robin-client/src/components/FloatingChat.tsx`** (all 115 lines) — the file you generalize.
7. **`open-robin-client/src/components/wiki/WikiExplorer.tsx`** (find and read the FloatingChat mount around L78) — you remove that inline mount.
8. **`open-robin-client/src/components/App.tsx`** (focus on the panel render loop and where PanelContent is mounted) — you add the FAB + FloatingChat at the top level, outside PanelContent.
9. **`open-robin-client/src/state/panelStore.ts`** — read the existing `threads: { project, view }` and `currentThreadIds: { project, view }` from 26c. You add a new slice alongside.
10. **`open-robin-client/src/components/ChatHarnessPicker/`** — understand the existing harness picker flow. It gets reused here.

### Line-number drift verification

```bash
cd /Users/rccurtrightjr./projects/open-robin/open-robin-client
wc -l \
  src/components/FloatingChat.tsx \
  src/components/App.tsx \
  src/components/wiki/WikiExplorer.tsx \
  src/state/panelStore.ts
```

### Pre-flight — confirm WikiExplorer's current FloatingChat mount

```bash
grep -n "FloatingChat" /Users/rccurtrightjr./projects/open-robin/open-robin-client/src/components/wiki/WikiExplorer.tsx
```

Expected: one hit around L17 (import) and one around L78 (the `<FloatingChat panel="rv-wiki-viewer" />` mount). Both go.

### Pre-prod wipe

```bash
pkill -9 -f "node.*server.js" 2>/dev/null; sleep 1
sqlite3 /Users/rccurtrightjr./projects/open-robin/ai/system/robin.db "PRAGMA foreign_keys=ON; DELETE FROM threads;"
find /Users/rccurtrightjr./projects/open-robin/ai/views/chat/threads -type f -name '*.md' -delete 2>/dev/null
find /Users/rccurtrightjr./projects/open-robin/ai/views/*/chat/threads -type f -name '*.md' -delete 2>/dev/null
```

---

## Changes — file by file

### 1. `open-robin-client/src/types/index.ts` — new types

Add near the existing `Scope` / `ViewUIState` types:

```ts
// SPEC-26d: per-view floating popup state (warm state + drag position)
export interface ViewChatState {
  activeThreadId: string | null;  // the warm view-scoped thread
  position: { x: number; y: number } | null;  // drag-remembered; null = default
}
```

---

### 2. `open-robin-client/src/state/panelStore.ts` — new slice

**2a. Add to the AppState interface.**

```ts
interface AppState {
  // ... existing ...

  // SPEC-26d: floating popup for view chats
  floatingChatOpen: boolean;                    // is the popup visible right now
  viewChatStates: Record<string, ViewChatState>;  // per-panel warm state

  openFloatingChat: () => void;                              // click FAB — smart behavior based on current view's warm state
  closeFloatingChat: () => void;                             // click X
  setActiveViewChat: (panel: string, threadId: string) => void;  // menu picker or new thread flow
  setFloatingChatPosition: (panel: string, x: number, y: number) => void;  // drag update
}
```

**2b. Initial state.**

Add to the initial state block:
```ts
floatingChatOpen: false,
viewChatStates: {},
```

**2c. Action implementations.**

```ts
openFloatingChat: () => {
  const state = get();
  const panel = state.currentPanel;
  const warm = state.viewChatStates[panel];

  if (!warm || !warm.activeThreadId) {
    // First click in this view: no warm chat. Set floatingChatOpen to true;
    // the rendered FloatingChat component detects "no active thread" and
    // shows the harness picker inline (reusing ChatArea's existing
    // harness-picker-when-no-thread behavior).
    set({ floatingChatOpen: true });
    return;
  }

  // Warm chat exists. Send thread:open-assistant to re-activate it on
  // the server, then show the popup.
  const ws = state.ws;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'thread:open-assistant',
      scope: 'view',
      threadId: warm.activeThreadId,
    }));
  }
  set({ floatingChatOpen: true });
},

closeFloatingChat: () => set({ floatingChatOpen: false }),

setActiveViewChat: (panel, threadId) => set((s) => {
  const existing = s.viewChatStates[panel] || { activeThreadId: null, position: null };
  return {
    viewChatStates: {
      ...s.viewChatStates,
      [panel]: { ...existing, activeThreadId: threadId },
    },
  };
}),

setFloatingChatPosition: (panel, x, y) => set((s) => {
  const existing = s.viewChatStates[panel] || { activeThreadId: null, position: null };
  return {
    viewChatStates: {
      ...s.viewChatStates,
      [panel]: { ...existing, position: { x, y } },
    },
  };
}),
```

**2d. Update `setCurrentPanel` to close the popup on view switch.**

In the existing `setCurrentPanel` action, after the `set_panel` wire message send, add:

```ts
// SPEC-26d: leaving a view hides the popup. Warm state for the new view
// (if any) will be restored on the next FAB click.
set({ floatingChatOpen: false });
```

**2e. Wire up `thread:created` for view-scoped threads to update warm state.**

This is handled in `thread-handlers.ts` in step 3 below — when a `thread:created` message arrives with `scope: 'view'`, the handler calls `setActiveViewChat(currentPanel, threadId)` so the new thread becomes the warm chat immediately.

---

### 3. `open-robin-client/src/lib/ws/thread-handlers.ts` — wire view-thread creation to warm state

**3a. In the `thread:created` handler, add warm-state update when scope is view.**

Current (post-26c):
```ts
case 'thread:created':
  if (msg.thread && msg.threadId) {
    store.addThread(scope, { threadId: msg.threadId, entry: msg.thread });
    store.setCurrentThreadId(scope, msg.threadId);
    store.setCurrentScope(scope);
    store.clearChat(scope);
  }
  return true;
```

New:
```ts
case 'thread:created':
  if (msg.thread && msg.threadId) {
    store.addThread(scope, { threadId: msg.threadId, entry: msg.thread });
    store.setCurrentThreadId(scope, msg.threadId);
    store.setCurrentScope(scope);
    store.clearChat(scope);
    // SPEC-26d: a new view thread becomes the warm chat for the current panel
    if (scope === 'view') {
      store.setActiveViewChat(store.currentPanel, msg.threadId);
    }
  }
  return true;
```

**3b. Same for `thread:opened` when the scope is view.**

When the user picks a thread from the menu picker, the flow is:
1. Client sends `thread:open-assistant { scope: 'view', threadId }`
2. Server responds with `thread:opened { scope: 'view', threadId, ... }`
3. Handler runs — should ALSO update warm state so the popup knows which thread to render

Update the `thread:opened` case:
```ts
case 'thread:opened':
  if (msg.threadId && msg.thread) {
    store.setCurrentThreadId(scope, msg.threadId);
    store.setCurrentScope(scope);
    store.clearChat(scope);

    if (msg.exchanges && msg.exchanges.length > 0) {
      convertExchangesToMessages(scope, msg.exchanges);
    } else if (msg.history && msg.history.length > 0) {
      convertHistoryToMessages(scope, msg.history);
    }

    if (msg.contextUsage !== undefined && msg.contextUsage !== null) {
      store.setContextUsage(msg.contextUsage);
    }

    // SPEC-26d: opened view thread becomes the warm chat
    if (scope === 'view') {
      store.setActiveViewChat(store.currentPanel, msg.threadId);
    }
  }
  return true;
```

---

### 4. `open-robin-client/src/components/FloatingChat.tsx` — rework

Rewrite the component to match the new model. The existing file has ~115 lines; the new version is roughly the same size.

```tsx
/**
 * @module FloatingChat
 * @role Universal floating popup for view-scoped chats.
 *
 * SPEC-26d: mounted once at the app shell level (in App.tsx).
 * Renders the FAB button always. When the popup is visible
 * (store.floatingChatOpen === true), renders the floating panel
 * bound to the current panel's warm view chat.
 *
 * Behavior:
 *  - Click FAB → store.openFloatingChat() handles the logic:
 *      first click in a view = harness picker, subsequent = restore warm chat
 *  - Click X → store.closeFloatingChat() (warm state preserved)
 *  - Click menu → opens ThreadPickerModal for the current view
 *  - Drag header → updates position via store.setFloatingChatPosition
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { usePanelStore } from '../state/panelStore';
import { ChatArea } from './ChatArea';
import { ThreadPickerModal } from './ThreadPickerModal';

const DEFAULT_PANEL_WIDTH = 420;
const DEFAULT_PANEL_HEIGHT = 520;
const DEFAULT_PADDING = 80;

export function FloatingChat() {
  const currentPanel = usePanelStore((s) => s.currentPanel);
  const isOpen = usePanelStore((s) => s.floatingChatOpen);
  const viewChatState = usePanelStore((s) => s.viewChatStates[currentPanel]);
  const openFloatingChat = usePanelStore((s) => s.openFloatingChat);
  const closeFloatingChat = usePanelStore((s) => s.closeFloatingChat);
  const setFloatingChatPosition = usePanelStore((s) => s.setFloatingChatPosition);

  const [modalOpen, setModalOpen] = useState(false);
  const [defaultPos, setDefaultPos] = useState({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  // Compute the default position (bottom-right) on first render
  useEffect(() => {
    setDefaultPos({
      x: window.innerWidth - DEFAULT_PANEL_WIDTH - DEFAULT_PADDING,
      y: window.innerHeight - DEFAULT_PANEL_HEIGHT - DEFAULT_PADDING,
    });
  }, []);

  // Actual position: stored position or default
  const position = viewChatState?.position ?? defaultPos;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only drag from the header bar
    if (!(e.target as HTMLElement).closest('.floating-chat-header')) return;
    e.preventDefault();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: position.x,
      origY: position.y,
    };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      setFloatingChatPosition(
        currentPanel,
        dragRef.current.origX + dx,
        dragRef.current.origY + dy,
      );
    };

    const handleMouseUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [position, currentPanel, setFloatingChatPosition]);

  return (
    <>
      {/* Floating chat panel */}
      {isOpen && (
        <>
          <div
            ref={panelRef}
            className="floating-chat-panel"
            style={{
              left: `${position.x}px`,
              top: `${position.y}px`,
            }}
            onMouseDown={handleMouseDown}
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
                title="Close (state preserved)"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="floating-chat-body">
              <ChatArea panel={currentPanel} scope="view" />
            </div>
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

      {/* FAB button — always visible */}
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

Notes:
- No `panel` prop — reads `currentPanel` from store directly.
- FAB is visible when `!isOpen`; panel is visible when `isOpen`.
- Drag updates go through the store, so they survive remounts.
- Menu button stops event propagation so the header drag doesn't fight with the button click.
- The existing `<ChatArea panel={currentPanel} scope="view" />` is reused — its internal logic already handles "no active thread → harness picker" so `openFloatingChat`'s first-click behavior doesn't need special component rendering.

---

### 5. `open-robin-client/src/components/ThreadPickerModal.tsx` — new component

```tsx
/**
 * @module ThreadPickerModal
 * @role Modal for switching between view-scoped threads.
 *
 * SPEC-26d: opened by clicking the menu button in FloatingChat's header.
 * Shows all view-scoped threads for the current panel, sorted most
 * recent first. Has a "+ New Chat" button at the top that runs the
 * harness picker flow and creates a new thread.
 */

import { useEffect, useCallback } from 'react';
import { usePanelStore } from '../state/panelStore';

interface ThreadPickerModalProps {
  panel: string;
  onClose: () => void;
}

export function ThreadPickerModal({ panel, onClose }: ThreadPickerModalProps) {
  const threads = usePanelStore((s) => s.threads.view);
  const currentThreadId = usePanelStore((s) => s.currentThreadIds.view);
  const setActiveViewChat = usePanelStore((s) => s.setActiveViewChat);
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
    // Clear the current view thread — this triggers ChatArea's harness
    // picker when the popup re-renders. Close the modal so the picker
    // is visible.
    setActiveViewChat(panel, ''); // empty = no warm chat
    // Actually we want to CLEAR, not set empty. Use the store action:
    const store = usePanelStore.getState();
    store.setCurrentThreadId('view', null);
    // The ChatArea inside the popup will now show its harness picker,
    // and picking a harness will send thread:open-assistant which creates
    // a new thread; the thread-handlers.ts 3a logic then auto-sets the
    // new thread as the warm chat.
    onClose();
  }, [panel, setActiveViewChat, onClose]);

  const handlePick = useCallback((threadId: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'thread:open-assistant',
      scope: 'view',
      threadId,
    }));
    // The thread:opened response handler will call setActiveViewChat
    // automatically (per step 3b).
    onClose();
  }, [ws, onClose]);

  // Sort threads by updated_at DESC (server already returns in MRU order
  // via thread:list, but make sure we sort here in case the store order
  // has drifted)
  const sortedThreads = [...threads].sort((a, b) => {
    // If server provides updated_at on entry, sort by that; else fall
    // back to the order we got them in (which is MRU from server-side)
    return 0;
  });

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
          {sortedThreads.length === 0 ? (
            <div className="rv-thread-picker-empty">No previous chats for this view.</div>
          ) : (
            sortedThreads.map((thread) => (
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

**Note on sorting:** the server's `thread:list` response already returns threads in MRU order (per ThreadIndex's `.orderBy('updated_at', 'desc')`), so the list is already sorted when it arrives. The `.sort((a, b) => 0)` is a placeholder no-op — you can delete it. The key insight is that the current warm thread is most-recently-touched (via `thread:open-assistant` + the server's `touch` call), so it'll be at position 0 naturally.

---

### 6. `open-robin-client/src/components/App.tsx` — mount FloatingChat at the app shell

**6a. Import FloatingChat.**

Add to the imports at the top of App.tsx:
```tsx
import { FloatingChat } from './FloatingChat';
```

**6b. Mount it at the end of the main app render tree.**

Find the top-level return in the `App` component. After the `</div>` that closes the panel container or the app root, add:
```tsx
<FloatingChat />
```

It should sit OUTSIDE the panel container so it's not memoized/remounted per panel — it reads `currentPanel` directly from the store and re-renders itself.

---

### 7. `open-robin-client/src/components/wiki/WikiExplorer.tsx` — remove inline FloatingChat

**7a. Remove the import.**

```tsx
import { FloatingChat } from '../FloatingChat';
```
↑ DELETE this line.

**7b. Remove the mount.**

```tsx
<FloatingChat panel="rv-wiki-viewer" />
```
↑ DELETE this line (or the whole JSX block that contains just this).

**Caveat on the panel prop:** the old mount passed `"rv-wiki-viewer"` which looks suspicious (might be a prefix typo — the actual panel id is probably `wiki-viewer`). Either way, the new universal mount reads `currentPanel` from the store, so the hardcoded prop goes away.

---

### 8. `open-robin-client/src/components/App.css` — FloatingChat + modal styles

The existing FloatingChat CSS is already in App.css (or a dedicated file). Augment it for the new menu button and modal.

**8a. Add menu button style.**

```css
.floating-chat-menu-btn {
  background: transparent;
  border: none;
  color: var(--text-dim, #888);
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.floating-chat-menu-btn:hover {
  color: var(--theme-primary, #888);
}

/* Menu on left, title in middle (flex-grow), close on right */
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
```

**8b. Modal backdrop and container.**

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

.rv-thread-picker-name {
  font-size: 13px;
}

.rv-thread-picker-meta {
  font-size: 11px;
  color: var(--text-dim, #888);
}

.rv-thread-picker-empty {
  padding: 16px;
  text-align: center;
  color: var(--text-dim, #888);
  font-size: 13px;
}
```

(Use CSS variables where the existing design system has them; fall back to literals otherwise. The executor can refine tokens to match existing conventions.)

---

## Test plan

### Static checks

```bash
cd /Users/rccurtrightjr./projects/open-robin/open-robin-client
npx tsc --noEmit
npm run build
```

Both must pass.

### Live validation — the 12-item checklist

Hard-refresh after `npm run build` + server restart.

**FAB presence:**
1. On any chat-enabled view (code-viewer, issues-viewer, etc.), the FAB chat_bubble button is visible in the bottom-right corner.
2. Project chat column (left) is still visible and functional (26c-2 intact).
3. No right-side chat column. Content area fills from the left chat column to the right edge of the screen.

**First click in a fresh view:**
4. Click the FAB on a view with no warm chat. The floating panel opens. Inside, the ChatArea shows the harness picker (its existing "no active thread → pick a harness" behavior).
5. Pick Kimi. The panel's ChatArea transitions to the live chat state. Send a user message; get a reply. The new thread is created with `scope=view` and the correct view_id.

**Close + reopen (warm state):**
6. Click the X (upper-right). The popup disappears. The FAB is visible again.
7. Click the FAB. The popup re-opens with the SAME conversation state (not a fresh harness picker). Send another message to confirm the wire is still live or auto-reconnects.

**Menu button:**
8. Click the menu button (upper-left, material `menu` icon). The ThreadPickerModal opens.
9. The warm thread is at the top of the list (because it's most-recently-updated).
10. Below it, a "+ New Chat" button with an add icon.
11. Click an existing thread. The popup switches to that thread's conversation. The picked thread becomes the new warm chat.
12. Click the + New Chat button. The current view thread clears, the harness picker appears in the popup. Pick a harness, create another thread. It's now the warm chat.

**Per-view warm state:**
13. Create warm chats in two different views (e.g., code-viewer and issues-viewer). Close both popups via X.
14. Click FAB in code-viewer. Warm chat restored.
15. Switch to issues-viewer. FAB is visible. Popup is closed (not automatically reopened). Click FAB. Issues-viewer's warm chat restored.
16. Switch back to code-viewer. FAB closed state. Click FAB. Code-viewer's warm chat restored.

**Drag + position remembered:**
17. Drag the popup to a new position via the header.
18. Close the popup. Reopen. Position is preserved (within the same view session).
19. Switch to a different view. Click FAB. New view's popup is at its own remembered position (or the default if none).

**Refresh wipes:**
20. Refresh the browser. All warm state gone. FAB is visible, clicking it = first-click-in-view behavior (harness picker) everywhere.

**Modal dismissal:**
21. Open the menu modal. Click outside the modal box. Modal closes.
22. Open the modal. Press Escape. Modal closes.

### What breaks if you get it wrong

| Failure | Root cause | Fix |
|---|---|---|
| FAB doesn't appear | FloatingChat not mounted at app shell, or `isOpen === true` permanently | Check App.tsx mount location and initial state `floatingChatOpen: false` |
| Clicking FAB does nothing | `openFloatingChat` not wired to the button | Check onClick |
| First click opens empty popup (no harness picker) | ChatArea's no-thread behavior isn't triggering | Verify `currentThreadIds.view === null` when popup first opens; the ChatArea scope='view' should render its picker in that state |
| Second click creates a new thread instead of restoring | `viewChatStates[panel].activeThreadId` not being set after thread creation | Check step 3a — thread-handlers.ts `thread:created` must call `setActiveViewChat` |
| Warm state bleeds across views | Using global state instead of `viewChatStates[panel]` | Check panelStore — `viewChatStates` must be `Record<string, ViewChatState>` keyed by panel |
| Popup reappears after switching views | `setCurrentPanel` not clearing `floatingChatOpen` | Check step 2d |
| Drag moves the whole window | Click propagation — mousedown not stopped | Check handleMouseDown only starts drag when target is inside `.floating-chat-header` |
| Menu button doesn't open modal | Event propagation to the header drag | Check `e.stopPropagation()` in the menu button onClick |
| Modal picker shows project threads | Using `threads.project` instead of `threads.view` | Check the selector in ThreadPickerModal |
| Wiki-viewer breaks | WikiExplorer's old inline mount wasn't removed, or the new universal mount fights with it | Check step 7 — both WikiExplorer import and mount should be gone |
| Position not preserved | Not using the store's `setFloatingChatPosition` | Check handleMouseMove — it writes to the store, not local state |

---

## Do not do

- **Do not** add traffic lights (red/yellow/green). Dropped per the simplification conversation.
- **Do not** add a dock for minimized chats. Dropped.
- **Do not** add a right-click easter egg on the FAB. Dropped.
- **Do not** add multiple popups at once. One per current view, single instance.
- **Do not** persist warm state to disk, localStorage, or SQLite. RAM only. Refresh wipes.
- **Do not** implement FIFO or flushing rules. Explicitly deferred.
- **Do not** touch any server code. This spec is 100% client-side.
- **Do not** touch the project chat column, Sidebar, ResizeHandle, viewStates (the left-column one from 26c-2 — different slice!), or any of 26c/26c-2's work.
- **Do not** touch the wire protocol. `thread:open-assistant` and `thread:list` already handle view-scope from 26b.
- **Do not** rename FloatingChat.tsx — reuse the file in place.
- **Do not** create a separate `FAB.tsx` component. The FAB lives inside FloatingChat.tsx (current structure preserved).
- **Do not** touch agents-viewer, runner, frontmatter catalog, CSS architecture migration.
- **Do not** bundle 26c-2's left-column viewStates slice with this spec's viewChatStates slice. They have similar names but are unrelated — viewStates is per-view UI prefs (collapse + widths), viewChatStates is per-view floating popup warm state. Keep them separate.

---

## Commit message template

```
SPEC-26d: view chat as floating popup (FAB + menu + modal)

Delivers the floating popup for view-scoped chats. Together with
26c-2's left-column work, this completes the asymmetric dual-chat
design: project chat as a left sidebar column, view chat as a
draggable floating popup with per-view warm state.

New files:
  - ThreadPickerModal.tsx — scrollable list of view threads for
    the current panel, "+ New Chat" button at top, picks switch the
    popup and close the modal. Escape and backdrop click dismiss.

Reworked:
  - FloatingChat.tsx — mounted once at the app shell level (no
    longer per-component). Reads currentPanel from the store.
    FAB button always visible (chat_bubble). Click → openFloatingChat
    store action decides behavior: first click = ChatArea's harness
    picker, subsequent = restore warm chat. Menu button (upper-left,
    material:menu) opens ThreadPickerModal. X button (upper-right)
    closes with state preserved. Draggable header, position stored
    per view in the store (remembered across open/close within the
    same session).
  - panelStore.ts — new slice:
      floatingChatOpen: boolean (global, resets on view switch)
      viewChatStates: Record<string, { activeThreadId, position }>
        (per-panel warm state, persists in RAM until refresh)
      Actions: openFloatingChat, closeFloatingChat, setActiveViewChat,
      setFloatingChatPosition. setCurrentPanel now sets
      floatingChatOpen = false on view switch.
  - thread-handlers.ts — thread:created and thread:opened for
    scope='view' now call setActiveViewChat(currentPanel, threadId)
    so the created/opened thread becomes the warm chat for the
    current view.
  - App.tsx — <FloatingChat /> mounted at the top-level return,
    outside PanelContent. Single instance.
  - App.css — menu button styles, modal backdrop/container styles,
    thread picker list styles.
  - types/index.ts — ViewChatState type added.

Removed:
  - WikiExplorer.tsx — the inline <FloatingChat panel="rv-wiki-viewer" />
    mount and its import are gone. Wiki-viewer now uses the
    universal FAB like every other view.

Warm state semantics:
  - Each view remembers its currently-active view thread as its
    "warm chat" (viewChatStates[panel].activeThreadId).
  - First FAB click in a view with no warm chat opens the harness
    picker (via ChatArea's existing no-thread behavior).
  - Subsequent FAB clicks in the same view restore the warm chat
    directly — no new thread created.
  - Picking a different thread via the menu modal replaces the
    warm chat.
  - Creating a new thread via "+ New Chat" replaces the warm chat
    with the newly-created thread.
  - Switching views hides the popup but preserves each view's warm
    state independently. Returning to a view and clicking FAB
    restores that view's warm chat.
  - Browser refresh wipes all warm state (current reality; future
    workspace-switch + flushing rules will formalize lifecycle).

Per-view drag position: viewChatStates[panel].position. Drag the
header to update. Preserved within the session. Default is
bottom-right with padding.

No server changes. No new wire messages. No new persistence. This
is entirely client-side — leverages 26b's view-scope routing as-is.

Live-validated via 22-step browser checklist: FAB presence,
first-click harness picker, close/reopen warm state restoration,
menu modal, new chat via modal, thread switching, per-view
independence, drag + position memory, refresh wipes, modal escape
and backdrop dismissal.

Part of SPEC-26 (dual-chat paradigm, asymmetric final form).
This is the last core phase. Remaining 26-series work (dual-wire,
harness wizard per side, etc.) is future if/when needed; the
current design intentionally ships with the single-wire model and
reuses the existing harness picker.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

## Report back

1. **Diff stats.** `git diff --stat main`. Expected:
   - New `ThreadPickerModal.tsx` (~120 lines)
   - `FloatingChat.tsx` rewritten (~150 lines net, similar size to before)
   - `panelStore.ts` medium (~80 net for the new slice + action implementations + setCurrentPanel update)
   - `thread-handlers.ts` small (~10 net for the two setActiveViewChat calls)
   - `App.tsx` small (~5 — import + mount at top level)
   - `WikiExplorer.tsx` small (~-5 — remove import + inline mount)
   - `App.css` medium (~100 for menu button + modal styles)
   - `types/index.ts` small (~10 for ViewChatState)

2. **Static checks.** tsc, npm build — both pass.

3. **Server restart and HTTP 200 confirmation.**

4. **Live validation walkthrough.** Run all 22 checklist items. Report each.

5. **Two tricky moments to watch specifically:**
   - **First-click behavior:** the harness picker should appear INSIDE the floating popup when you first click the FAB in a view with no warm chat. It should NOT be a separate modal or inline on the page. This requires ChatArea scope='view' to render its "no thread" state gracefully when wrapped inside FloatingChat.
   - **The "+ New Chat" modal flow:** picking "+ New Chat" clears the current view thread, closes the modal, and the open popup's ChatArea should then show the harness picker. If this doesn't work, the cause is usually that `setActiveViewChat('')` doesn't propagate to `currentThreadIds.view`, so ChatArea still thinks there's a thread open.

6. **Files touched outside the change list.** Expected: zero.

7. **Any weird interaction with 26c-2's collapse or resize.** The floating popup sits on top of the app layout — shouldn't interfere with the left-column grid. But verify: does dragging the popup near the left edge land it OVER the sidebar/chat columns cleanly (as an overlay), or does something weird happen with z-index?

Hand the report back to the orchestrator.
