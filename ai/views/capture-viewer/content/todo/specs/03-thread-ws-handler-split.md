# SPEC-03: ThreadWebSocketHandler.js Split

## Context for Executing Session

This is a standalone refactoring task. SPEC-04 (ThreadManager split) is already complete — ThreadManager now delegates to SessionManager and AutoRename internally. This spec does NOT depend on those internals; ThreadWebSocketHandler calls the same ThreadManager public API as before.

Execute exactly as described. Do not modify behavior, only reorganize code. Do not implement anything beyond what is specified here.

---

## Problem

`open-robin-server/lib/thread/ThreadWebSocketHandler.js` is 590 lines with two distinct groups of handlers sharing three module-level Maps. The CRUD handlers (create, open, rename, delete, etc.) and the message handlers (send, addAssistantMessage) are independent concerns glued together by shared state.

---

## Current File: What It Does

**File:** `open-robin-server/lib/thread/ThreadWebSocketHandler.js` — 590 lines

**Module-level state (3 Maps + 1 constant):**
- `threadManagers` Map — panelId → ThreadManager (shared across all WS connections)
- `wsState` Map — ws → { panelId, viewName, threadId, threadManager }
- `pendingReorderTimers` Map — ws → timeout handle
- `REORDER_DELAY_MS = 3000`

**Functions by group:**

### State management (~100 lines)
- `getThreadManager(panelId, config)` — get or create ThreadManager per panel
- `setPanel(ws, panelId, config)` — set panel for WS, close current thread if switching
- `getState(ws)` — get wsState for WS
- `cleanup(ws)` — close thread, delete state, clear timers
- `closeCurrentThread(ws)` — close wire session, null out threadId

### Thread list (~40 lines)
- `sendThreadList(ws)` — list threads, send to client
- `newChatName()` — generate timestamped "New Chat MM/DD H:MM:SS AM"

### Thread CRUD handlers (~250 lines)
- `handleThreadCreate(ws, msg)` — create thread, set harness mode, auto-open
- `handleThreadOpen(ws, msg)` — open thread, send history, delayed reorder
- `handleThreadOpenDaily(ws, msg)` — date-based session, create or resume
- `handleThreadRename(ws, msg)` — rename thread
- `handleThreadDelete(ws, msg)` — delete thread
- `handleThreadCopyLink(ws, msg)` — get thread file path

### Message handlers (~60 lines)
- `handleMessageSend(ws, msg)` — add user message, touch MRU
- `addAssistantMessage(ws, content, hasToolCalls, metadata)` — add assistant message, trigger auto-rename

### Accessors (~15 lines)
- `getCurrentThreadId(ws)`
- `getCurrentThreadManager(ws)`

### Test exports
- `_getThreadManagers` — returns threadManagers Map
- `_getWsState` — returns wsState Map

**Exports (16 functions):** setPanel, getState, cleanup, sendThreadList, handleThreadCreate, handleThreadOpen, handleThreadOpenDaily, handleThreadRename, handleThreadDelete, handleThreadCopyLink, handleMessageSend, addAssistantMessage, getCurrentThreadId, getCurrentThreadManager, _getThreadManagers, _getWsState

**Consumers:**
- `server.js` — imports and calls all exported functions
- `lib/thread/index.js` — re-exports

---

## What to Create

### File 1: `lib/thread/thread-crud.js`

Extract these functions:
```
handleThreadCreate(ws, msg)
handleThreadOpen(ws, msg)
handleThreadOpenDaily(ws, msg)
handleThreadRename(ws, msg)
handleThreadDelete(ws, msg)
handleThreadCopyLink(ws, msg)
newChatName()
```

**Critical internal dependency:** `handleThreadCreate` and `handleThreadOpenDaily` both call `handleThreadOpen` at the end. All three must be in the same file, or `handleThreadOpen` must be importable by the other two.

**These functions need access to:**
- `wsState` Map (read state, set threadId)
- `sendThreadList` function (called after create/rename/delete)
- `closeCurrentThread` function (called from handleThreadOpen)
- `pendingReorderTimers` Map + `REORDER_DELAY_MS` (handleThreadOpen sets delayed reorder)
- `require('../harness/feature-flags').setThreadMode` (handleThreadCreate, handleThreadOpen)

**Approach:** These functions receive the shared Maps and helper functions as parameters from a factory function, or import them from the coordinator module. The factory pattern is cleaner:

```js
// thread-crud.js
function createCrudHandlers({ wsState, sendThreadList, closeCurrentThread, pendingReorderTimers, REORDER_DELAY_MS }) {
  
  function newChatName() { ... }
  
  async function handleThreadCreate(ws, msg) { ... }
  async function handleThreadOpen(ws, msg) { ... }
  async function handleThreadOpenDaily(ws, msg) { ... }
  async function handleThreadRename(ws, msg) { ... }
  async function handleThreadDelete(ws, msg) { ... }
  async function handleThreadCopyLink(ws, msg) { ... }
  
  return {
    handleThreadCreate,
    handleThreadOpen,
    handleThreadOpenDaily,
    handleThreadRename,
    handleThreadDelete,
    handleThreadCopyLink
  };
}

module.exports = { createCrudHandlers };
```

---

### File 2: `lib/thread/thread-messages.js`

Extract these functions:
```
handleMessageSend(ws, msg)
addAssistantMessage(ws, content, hasToolCalls, metadata)
```

**These functions need access to:**
- `wsState` Map (read state, get threadManager/threadId)

**Same factory pattern:**

```js
// thread-messages.js
function createMessageHandlers({ wsState }) {
  
  async function handleMessageSend(ws, msg) { ... }
  async function addAssistantMessage(ws, content, hasToolCalls, metadata) { ... }
  
  return { handleMessageSend, addAssistantMessage };
}

module.exports = { createMessageHandlers };
```

**Note:** `addAssistantMessage` contains the auto-rename trigger logic (checks `entry.name === 'New Chat'` and `entry.messageCount >= 2`, then fires `threadManager.autoRename(threadId)`). This logic moves with the function — do not leave it behind.

---

### Result: ThreadWebSocketHandler.js becomes coordinator (~150 lines)

Keeps:
- The three Maps (`threadManagers`, `wsState`, `pendingReorderTimers`) + `REORDER_DELAY_MS`
- `getThreadManager(panelId, config)`
- `setPanel(ws, panelId, config)`
- `getState(ws)`
- `cleanup(ws)`
- `closeCurrentThread(ws)`
- `sendThreadList(ws)`
- `getCurrentThreadId(ws)` / `getCurrentThreadManager(ws)`
- Test exports `_getThreadManagers`, `_getWsState`

Creates the handlers via factory on module load:

```js
const { createCrudHandlers } = require('./thread-crud');
const { createMessageHandlers } = require('./thread-messages');

const crud = createCrudHandlers({ wsState, sendThreadList, closeCurrentThread, pendingReorderTimers, REORDER_DELAY_MS });
const messages = createMessageHandlers({ wsState });

module.exports = {
  setPanel,
  getState,
  cleanup,
  sendThreadList,
  ...crud,
  ...messages,
  addAssistantMessage: messages.addAssistantMessage,
  getCurrentThreadId,
  getCurrentThreadManager,
  _getThreadManagers: () => threadManagers,
  _getWsState: () => wsState
};
```

**The exported API must be identical.** server.js and lib/thread/index.js change nothing.

---

## Gotchas — Handle These During Implementation

### 1. handleThreadCreate and handleThreadOpenDaily both call handleThreadOpen

These three functions are coupled. They must all be in the same file (thread-crud.js) or handleThreadOpen must be importable. The factory pattern handles this — all three close over the same scope.

### 2. Test exports must be preserved

`_getThreadManagers()` and `_getWsState()` are test exports that verify thread isolation between WebSocket connections. Do not remove them. They stay in the coordinator.

### 3. pendingReorderTimers + REORDER_DELAY_MS must travel together

`handleThreadOpen` creates timers. `cleanup` clears them. Both need the same Map instance. The factory injects the shared Map — do not create a second Map.

### 4. sendThreadList is used by CRUD handlers AND the coordinator

Called from `handleThreadCreate`, `handleThreadRename`, `handleThreadDelete`, and from `cleanup` (via delayed timer). It must be accessible to both the coordinator and the CRUD handlers. Inject it into the factory.

### 5. addAssistantMessage auto-rename check uses `entry.name === 'New Chat'`

The `newChatName()` function generates names like `"New Chat 04/06 2:34:00 PM"`. But the auto-rename check compares against the literal string `"New Chat"` — NOT the timestamped version. This means auto-rename only triggers for threads named exactly "New Chat", not for timestamped variants. This is existing behavior — preserve it exactly, do not "fix" it.

### 6. handleThreadOpenDaily temporarily overrides state.viewName

Lines 318-321 and 354-356: if `msg.panel` is provided, `state.viewName` is temporarily swapped so `handleThreadOpen` sends the right panel name, then restored. This is a stateful side effect. If the factory doesn't share the same `wsState` Map instance, the override won't propagate to `handleThreadOpen`.

---

## What NOT to Do

- Do not change the exported API — server.js must require zero changes
- Do not change lib/thread/index.js re-exports
- Do not modify any handler behavior
- Do not remove test exports
- Do not create a class — the current module pattern (functions + Maps) is the established pattern
- Do not add error handling, logging, or features beyond what exists

---

## Verification

After the split:
- `server.js` requires zero changes (same imports, same function signatures)
- `lib/thread/index.js` requires zero changes
- All 16 exported functions still work
- `_getThreadManagers()` and `_getWsState()` still return the shared Maps
- Thread create → auto-opens thread (handleThreadCreate calls handleThreadOpen)
- Daily open → creates or resumes (handleThreadOpenDaily calls handleThreadOpen)
- Thread list reorder delayed by 3 seconds after open
- Cleanup clears pending reorder timers
- addAssistantMessage triggers auto-rename for "New Chat" threads

---

## Silent Fail Risks

| Risk | What Breaks | Symptom |
|------|-------------|---------|
| Factory gets different Map instance | State not shared, handlers see stale data | Thread opens but state shows no thread |
| handleThreadOpen not accessible from create/daily | Create/daily fail silently after thread creation | Thread created but not opened |
| pendingReorderTimers not cleared in cleanup | Timer fires on dead WS | Server log errors, potential crash |
| viewName override not propagated | Daily thread opened with wrong panel name | Client routes thread to wrong panel |
| Auto-rename logic left behind | Assistant messages never trigger rename | All threads stay "New Chat" |
