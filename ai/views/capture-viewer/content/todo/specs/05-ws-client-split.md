# SPEC-05: ws-client.ts Split

## Issue
`ws-client.ts` is 551 lines handling WebSocket connection lifecycle, 30+ message type routing, multi-store updates, and Robin message pub/sub.

## File
`open-robin-client/src/lib/ws-client.ts` — 551 lines

## Current Responsibilities
1. **Connection lifecycle** — connect, reconnect (3s delay), disconnect, HMR guard
2. **Message routing** — giant switch statement (lines 138-487) with 30+ message types
3. **Multi-store updates** — writes to panelStore, activeResourceStore, fileDataStore
4. **Robin pub/sub** — robinListeners Map for decoupled robin:* message routing
5. **Tool grouping integration** — calls onToolCall, getGroupForResult, breakSequence, resetGrouper
6. **Turn state management** — setPendingTurnEnd, segment array management, completion detection
7. **Panel discovery** — calls loadAllPanels on connect

## Critical Invariants
- `setPendingTurnEnd(false)` on `turn_begin` prevents stale state from previous turn
- Every handler calls `getState()` fresh to prevent stale closures
- Completion detection is effect-based (not callback-based) to handle both orderings

## Imports (12 modules)
panelStore, activeResourceStore, fileDataStore, instructions, catalog-visual, tool-grouper, logger, file-tree, toast, modal, panels, types

## Exports
- `connectWs()`, `disconnectWs()`, `sendRobinMessage()`, `onRobinMessage()`

## Consumers
- `RobinOverlay.tsx` — sendRobinMessage, onRobinMessage
- `clipboard-api.ts` — sendRobinMessage
- `tool-renderers/read.ts` — sendRobinMessage
- `hooks/useWebSocket.ts` — connectWs initialization

## Message Type Groups
| Group | Types | Count |
|-------|-------|-------|
| Session | connected, wire_ready | 2 |
| Streaming | turn_begin, content, thinking, tool_call, tool_result, turn_end | 6 |
| Status | status_update, request, error, auth_error | 4 |
| Thread | thread:list, thread:created, thread:opened, thread:renamed, thread:deleted, message:sent | 6 |
| UI | modal:show, panel_config | 2 |
| Files | file_changed, file_tree_response, file_content_response, file:moved, file:move_error | 5 |
| Robin | robin:tabs, robin:items, robin:wiki, robin:theme-data | 4 |
| Clipboard | clipboard:list, clipboard:append, clipboard:touch, clipboard:clear | 4 |

## Proposed Split

### Extract 1: Stream Message Handlers
**turn_begin, content, thinking, tool_call, tool_result, turn_end -> `lib/ws/stream-handlers.ts`**
- All streaming/turn state management
- Needs: panelStore access, tool-grouper calls

### Extract 2: Thread Message Handlers
**thread:*, message:sent -> `lib/ws/thread-handlers.ts`**
- Thread list and lifecycle updates
- Needs: panelStore access

### Extract 3: File Message Handlers
**file_*, file:moved, file:move_error -> `lib/ws/file-handlers.ts`**
- File explorer response handling
- Needs: fileDataStore, activeResourceStore

### Extract 4: Robin Message Handlers
**robin:* -> `lib/ws/robin-handlers.ts`**
- Robin pub/sub dispatch
- Already partially decoupled via robinListeners

### Result: ws-client becomes connection manager + router
- Connection lifecycle, message parse, dispatch to handler modules
- ~150-200 lines

## Dependencies
- SPEC-02 (RobinOverlay) depends on robin message routing — extract robin handlers before changing RobinOverlay imports
- No hard blockers, but extreme care required

## Gotchas

### setPendingTurnEnd lifecycle — CRITICAL PAST BUG
`turn_begin` handler (line 181) calls `store.setPendingTurnEnd(panel, false)`. `turn_end` handler (line 315) calls `store.setPendingTurnEnd(panel, true)`. This was a past bug: without the `false` on turn_begin, new turns inherited stale flag from previous turn, causing the renderer to finalize the new turn prematurely. If stream handlers are extracted and lose access to `panelStore.getState()`, the `setPendingTurnEnd()` call fails silently — no error, just skipped.

### tool-grouper module-level state — HIGH RISK
Stream handlers call `onToolCall()`, `breakSequence()`, `getGroupForResult()`, `resetGrouper()`. These manage module-level Maps (`activeGroup`, `toolCallMap`) in tool-grouper.ts. If extractors call `resetGrouper()` too early or forget it entirely, grouper state leaks between turns. Groupable tools (read, glob, grep) from turn N show results from turn N-1, or results disappear.

### robinListeners Map must travel with robin handlers
`robinListeners: Map<string, Set<RobinListener>>` (line 38) is module-level. If robin handlers are extracted to a separate file, this Map must go with them AND `onRobinMessage()` / `sendRobinMessage()` must reference the same Map instance. If forgotten, RobinOverlay's subscriptions never fire.

### Reconnect timer must clear message state
`onclose` handler sets `reconnectTimer`. `connectWs()` clears it. If connection lifecycle is separated from message handling, the reconnect flow might not reset `toolCallMap` or `activeGroup`. User reconnects with stale grouper state from dead connection — new turn's tool calls collide with old IDs.

### Message ordering and state consistency
All handlers currently live in one `handleMessage()` function — order is atomic. If split across files, imports might execute out of order. If `thread:opened` handler runs before stream handler initialization, the new thread's first turn gets stale grouper state.

## Silent Fail Risks

| Risk | What Breaks | Symptom |
|------|-------------|---------|
| pendingTurnEnd not cleared on turn_begin | New turns finalize immediately | Spinner loops forever, rendering broken |
| tool-grouper state leaks between turns | Old turn's results in new turn | Grouped file searches show wrong results |
| robinListeners Map not exported | RobinOverlay subscriptions never fire | System panel opens, nothing loads |
| Reconnect doesn't reset grouper | Stale tool IDs from dead connection | First message after reconnect shows garbled tool results |
| Handler import order wrong | First message in reopened thread has stale state | Grouped results from previous session appear |
