---
title: Chat Isolation Refactor
status: ready
created: 2026-04-03
---

# Chat Isolation Refactor

## The Problem

Chat threads from code-viewer bleed into every other panel. The root cause is not one bug — it's a stack of architectural shortcuts that all compound.

---

## Bug Stack (Bottom to Top)

### 1. Global Thread Store (Client — panelStore.ts)

**File:** `kimi-ide-client/src/state/panelStore.ts`
**Lines:** 65-68, 316-329

`threads` and `currentThreadId` are **global state** — a single flat array shared across the entire app. Every panel that renders a `<Sidebar>` reads the same `state.threads`. When the server sends `thread:list` for any panel, it overwrites the one global list.

```ts
// panelStore.ts:65-68 — global, not per-panel
threads: Thread[];
currentThreadId: string | null;
setThreads: (threads: Thread[]) => void;
setCurrentThreadId: (threadId: string | null) => void;
```

**Fix:** Move `threads` and `currentThreadId` into the per-panel `PanelState` interface (alongside `messages`, `segments`, etc.). Each panel gets its own isolated thread list.

---

### 2. Client Never Sent `set_panel` to Server (Client — panelStore.ts)

**File:** `kimi-ide-client/src/state/panelStore.ts`
**Lines:** 107-118

`setCurrentPanel()` only updated local Zustand state. It never sent a `set_panel` WebSocket message to the server. The server was permanently stuck on `code-viewer`'s ThreadManager for the entire session.

**Status:** Fixed (2026-04-03). `setCurrentPanel` now sends `{ type: 'set_panel', panel: id }` to the server.

---

### 3. Server Hardcoded `code-viewer` on Connect (Server — server.js)

**File:** `kimi-ide-server/server.js`
**Lines:** ~562-567

On every new WebSocket connection, the server called `ThreadWebSocketHandler.setPanel(ws, 'code-viewer', ...)`. This was needed because wire spawning depends on the ThreadManager existing. But it also meant the thread list was scoped to code-viewer until the client sent `set_panel`.

The original code also immediately sent the thread list on connect (before the client identified itself), which was removed.

**Status:** Partially fixed. `setPanel` still defaults to `code-viewer` (needed for wire dependency), but the thread list is no longer sent on connect — it waits for `set_panel`.

---

### 4. `hasChat` Was a Static JSON Flag (Client — panels.ts)

**File:** `kimi-ide-client/src/lib/panels.ts`
**Line:** 81

`hasChat` was read from each panel's `index.json` config as a manually-set boolean. If someone set `"hasChat": true` but never created the `chat/threads/` folder, the client would render a chat panel with nothing behind it.

**Status:** Fixed (2026-04-03). `hasChat` is now derived by probing `chat/threads/index.json` on disk via the `__panels__` pseudo-panel fetch. No folder = no chat.

The `hasChat` property was removed from all 7 panel `index.json` files.

---

### 5. Sidebar Requests Threads Without Panel Scoping (Client — Sidebar.tsx)

**File:** `kimi-ide-client/src/components/Sidebar.tsx`
**Lines:** 137-141

On mount, the Sidebar sends `{ type: 'thread:list' }` to the server — but with no panel identifier. The server returns threads for whatever panel the ThreadManager happens to be scoped to at that moment.

```ts
// Sidebar.tsx:137-141 — no panel in the request
useEffect(() => {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'thread:list' }));
  }
}, [ws, panel]);
```

**Fix:** Either include `panel` in the `thread:list` request, or ensure `set_panel` always fires before `thread:list` (order dependency — fragile).

---

### 6. `thread:list` Response Has No Panel Identifier (Server — ThreadWebSocketHandler.js)

**File:** `kimi-ide-server/lib/thread/ThreadWebSocketHandler.js`
**Lines:** 119-138

The server sends `{ type: 'thread:list', threads: [...] }` with no `panel` field. The client has no way to know which panel these threads belong to. It blindly dumps them into the global `state.threads`.

```ts
// ThreadWebSocketHandler.js:131 — no panel in the response
ws.send(JSON.stringify({
  type: 'thread:list',
  threads: threads.map(t => ({
    threadId: t.threadId,
    entry: t.entry
  }))
}));
```

**Fix:** Include `panel: state.panelId` in the response. Client uses this to route threads to the correct per-panel state.

---

## Filesystem State (Current)

| Panel | `chat/threads/` exists | `index.json` inside | Should have chat |
|-------|----------------------|-------------------|-----------------|
| code-viewer | Yes | Yes | Yes |
| issues-viewer | No | No | TBD |
| wiki-viewer | No | No | TBD |
| capture-viewer | No | No | No |
| settings-viewer | No | No | No |
| agents-viewer | No | No | No |
| terminal-viewer | No | No | No |

To enable chat for a new panel: create `ai/views/{panelId}/chat/threads/index.json` with `{ "sort": "last-active", "order": "desc" }`. The filesystem probe in `panels.ts` will detect it automatically.

---

## App.tsx Layout Decision (Line 169)

```tsx
const layout = config.layout || (config.hasChat ? 'sidebar-chat-content' : 'full');
```

This is a fallback. Since every panel has `layout` set explicitly in its `index.json`, this line rarely fires. But the `hasChat` fallback still drives the decision if `layout` is missing. After the refactor, `hasChat` is filesystem-derived, so this is now correct.

**Layout → Components rendered:**

| Layout | Sidebar | ChatArea | ContentArea |
|--------|---------|----------|-------------|
| `full` | No | No | Yes |
| `chat-content` | No | Yes | Yes |
| `sidebar-chat-content` | Yes | Yes | Yes |

---

## Refactor Checklist

### Must Fix (Threads Bleed)
- [ ] **panelStore.ts** — Move `threads` and `currentThreadId` into per-panel `PanelState`
- [ ] **panelStore.ts** — Update `setThreads`, `setCurrentThreadId`, `addThread`, `updateThread`, `removeThread` to be panel-scoped
- [ ] **Sidebar.tsx** — Read threads from `state.panels[panel].threads` instead of `state.threads`
- [ ] **ThreadWebSocketHandler.js** — Include `panel` in `thread:list` response
- [ ] **ws-client.ts** — Route incoming `thread:list` to the correct panel's thread state using the `panel` field

### Already Fixed (2026-04-03)
- [x] `panels.ts` — `hasChat` derived from filesystem probe
- [x] `panelStore.ts` — `setCurrentPanel` sends `set_panel` to server
- [x] `server.js` — Removed premature thread list send on connect
- [x] All panel `index.json` — Removed `hasChat` property

### Verify After Refactor
- [ ] Switch from code-viewer to issues-viewer → thread list is empty (no chat folder)
- [ ] Switch back to code-viewer → thread list shows code-viewer threads only
- [ ] Create thread in code-viewer → does NOT appear in any other panel
- [ ] If chat folder added to issues-viewer → threads appear only there
- [ ] Wire spawning still works after panel switch

---

## Files Involved

```
Client:
  src/state/panelStore.ts        ← Thread state must become per-panel
  src/lib/panels.ts              ← hasChat detection (fixed)
  src/lib/ws-client.ts           ← thread:list routing
  src/components/App.tsx          ← Layout decision
  src/components/Sidebar.tsx      ← Thread list display
  src/components/ChatArea.tsx     ← Chat rendering
  src/components/FloatingChat.tsx ← Floating chat wrapper (uses ChatArea)

Server:
  server.js                            ← Connection setup, set_panel handler
  lib/thread/ThreadWebSocketHandler.js  ← Thread list, panel scoping
  lib/thread/ThreadManager.js           ← Per-panel thread lifecycle
  lib/thread/ThreadIndex.js             ← SQLite queries (already scoped by panel_id)

Filesystem:
  ai/views/{panelId}/chat/threads/index.json  ← Existence = chat enabled
```
