# WebSocket Client Extraction

## Problem

The WebSocket connection, reconnection, discovery, and message routing all live inside `useWebSocket` — a React hook. This couples socket lifecycle to React's component lifecycle, creating three classes of bugs:

### 1. Stale closure — live bug

`handleMessage` is a `useCallback([currentWorkspace])`. `socket.onmessage` captures it once inside `useEffect([], [])`. The `onmessage` never updates. Result: `workspace` inside `handleMessage` is always the initial value (`'coding-agent'`). Every streaming response — content, tool calls, turns — routes to the wrong workspace if the user has switched tabs.

### 2. Lifecycle coupling — structural

The socket exists inside a React hook. It lives and dies with the component that calls it. We just fixed a deadlock where the component couldn't mount because discovery hadn't completed, but discovery couldn't complete because the component hadn't mounted. Other failure modes waiting to happen: React Strict Mode double-mount (dev), HMR tear-down (dev), error boundary unmount (prod).

### 3. Unnecessary guard — side effect

Lines 181-185 of `useWebSocket.ts`:
```ts
if (!store.workspaces[workspace]) {
  store.setCurrentWorkspace(workspace);
}
```
Runs on every message. `setCurrentWorkspace` does two things: initializes workspace state AND switches the active workspace. This guard was written to handle the first case but triggers the second as a side effect. It's also redundant now — `setWorkspaceConfigs` initializes state for all discovered workspaces during discovery.

---

## Solution

Extract all WebSocket concerns into a plain TypeScript module (`ws-client.ts`). No React hooks, no closures, no refs. The module writes directly to the Zustand store. React components read from the store only.

---

## Architecture

### Before

```
App.tsx
  └─ useWebSocket() hook
       ├─ creates WebSocket
       ├─ manages reconnection (refs)
       ├─ runs discovery (onopen)
       ├─ routes all messages (onmessage → handleMessage)
       ├─ reads currentWorkspace via React subscription (stale)
       └─ stores socket in Zustand + ref

ChatArea reads sendMessage from store
Other components read ws from store, send directly
```

### After

```
ws-client.ts (plain module, no React)
  ├─ connect() — creates WebSocket, auto-reconnects
  ├─ onopen → discovery, store.setWs()
  ├─ onmessage → handleMessage() reads workspace from store.getState() (always fresh)
  └─ disconnect() — clean shutdown

App.tsx
  └─ useEffect([], []) calls wsClient.connect(), cleanup calls disconnect()

All components read from store only
```

---

## Files

### New: `src/lib/ws-client.ts`

The standalone WebSocket client. ~200 lines (extracted from useWebSocket's 430).

**Exports:**
- `connectWs(): void` — opens socket, sets up onopen/onmessage/onclose/onerror, starts discovery
- `disconnectWs(): void` — closes socket, clears reconnect timer
- `getSocket(): WebSocket | null` — direct socket access (for components that send)

**Internal:**
- `handleMessage(msg)` — the full message switch/case, reads `currentWorkspace` via `useWorkspaceStore.getState()` on every call (no stale closure)
- Reconnection with backoff (replace `setTimeout(connect, 3000)`)
- `groupState` as module-level variable (replaces `groupRef`)

**Key difference from current code:** Every reference to workspace state uses `useWorkspaceStore.getState()` at call time, not a React subscription captured at mount time.

### Modified: `src/hooks/useWebSocket.ts`

Reduced to a thin wrapper (~15 lines):

```ts
import { useEffect } from 'react';
import { connectWs, disconnectWs } from '../lib/ws-client';

export function useWebSocket() {
  useEffect(() => {
    connectWs();
    return () => disconnectWs();
  }, []);
}
```

All message handling, discovery, reconnection logic removed — it's in `ws-client.ts` now.

The 12 `useWorkspaceStore` subscriptions at the top of the current hook go away. The helper functions (`convertExchangesToMessages`, `convertPartToSegment`, `convertHistoryToMessages`) move to `ws-client.ts` since they're only used by message handling.

### Modified: `src/components/App.tsx`

No change needed — already calls `useWebSocket()` at the top.

### Modified: `src/state/workspaceStore.ts`

- Remove the `handleMessage` guard logic (it moves nowhere — it's deleted)
- `sendMessage` stays in the store (already done)
- Consider: add `ensureWorkspaceState(id)` action that only initializes (doesn't switch), for cases where message routing needs state to exist for a workspace that hasn't been discovered yet

### Unchanged

All components that do `ws.send(...)` directly (Sidebar, TileRow, TicketBoard, PageViewer, useFileTree, useWorkspaceData) continue working — they read `ws` from the store, which `ws-client.ts` still sets via `store.setWs()`.

---

## The stale closure fix (detail)

Current broken pattern:
```ts
// React hook — currentWorkspace captured at subscription time
const currentWorkspace = useWorkspaceStore((state) => state.currentWorkspace);

const handleMessage = useCallback((msg) => {
  const workspace = currentWorkspace; // stale after first render
  appendSegment(workspace, ...);
}, [currentWorkspace]); // recreates, but socket.onmessage never gets the new version
```

Fixed pattern:
```ts
// Plain module — reads fresh state on every call
function handleMessage(msg: WebSocketMessage) {
  const store = useWorkspaceStore.getState();
  const workspace = store.currentWorkspace; // always current
  store.appendSegment(workspace, ...);
}
```

Every store action is called via `store.actionName()` instead of through a captured React subscription. No stale data possible.

---

## What doesn't change

- `fetchWorkspaceFile` in `lib/workspaces.ts` — uses `addEventListener` directly on the socket object passed to it. This is fine; it doesn't go through React.
- `useWorkspaceData`, `useFileTree` — same pattern, receive `ws` from store, attach listeners. Fine.
- `workspace-context.ts` — receives socket, attaches listeners. Fine.
- The Zustand store API — no new actions needed beyond what exists.
- Server-side — no changes.

---

## Risk assessment

**Low risk.** This is a mechanical extraction:
- Move code from hook into module
- Replace `useWorkspaceStore((s) => s.action)` with `useWorkspaceStore.getState().action`
- Replace `useRef` with module-level `let` variables
- Delete the guard
- The message handling switch/case is copy-paste with only the state access pattern changing

**One thing to watch:** `groupRef` (tracks segment grouping state) is currently a React ref. As a module-level variable, it persists across reconnections. Need to reset it in `connectWs()` when a new socket opens (same as current code resets it on `turn_begin`).

---

## Verification

1. Start app → workspaces discovered, tab bar populated
2. Switch to Wiki → send message → response appears in Wiki (not coding-agent)
3. Switch to Issues → send message → response appears in Issues
4. Kill server → "Disconnected" shown → restart server → auto-reconnects, workspaces rediscovered
5. Browser console: no `[WS]` errors, `[WS] Discovered 9 workspaces` appears
