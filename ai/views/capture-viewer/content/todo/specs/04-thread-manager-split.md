# SPEC-04: ThreadManager.js Split

## Context for Executing Session

This is a standalone refactoring task. No architectural decisions are required — the split has been planned and verified. Execute exactly as described. Do not modify behavior, only reorganize code into the proposed file structure. Do not implement anything beyond what is specified here.

This spec was produced from a code standards audit followed by a dependency/gotcha analysis loop. The race condition and silent fail risks below are pre-identified — they must be handled as part of the split, not left for later.

---

## Problem

`open-robin-server/lib/thread/ThreadManager.js` is 590 lines performing five distinct jobs in one class. It cannot be described in one sentence without "and."

---

## Current File: What It Does

**File:** `open-robin-server/lib/thread/ThreadManager.js`

**Five jobs:**
1. **Thread CRUD** — create, get, list, rename, delete threads (calls ThreadIndex + ChatFile)
2. **Session tracking** — Map of active wire processes per thread
3. **Idle timeout management** — per-thread timers, 9-minute default, fires closeSession on expiry
4. **FIFO session eviction** — enforces max active sessions (default 10), kills oldest
5. **Auto-rename** — spawns Kimi subprocess after first assistant message, updates thread name

**Internal state:**
- `this.index` — ThreadIndex instance (SQLite metadata)
- `this.activeSessions` Map — threadId → ThreadSession `{ wireProcess, ws, harness }`
- `this.timeouts` Map — threadId → timeout handle
- `this.config` — `{ maxActiveSessions: 10, idleTimeoutMinutes: 9 }`

**Dependencies:**
- `ThreadIndex` — SQLite metadata
- `ChatFile` — markdown read/write
- `HistoryFile` — rich history from SQLite
- `child_process.spawn` — Kimi subprocess for auto-rename
- `fs.promises` — filesystem

**Consumers of this file:**
- `lib/thread/ThreadWebSocketHandler.js` — creates instances, calls all lifecycle methods
- `lib/thread/index.js` — re-exports

---

## What to Create

### File 1: `lib/thread/session-manager.js`

Extract these methods from ThreadManager into a new standalone module:

```
openSession(threadId, wireProcess, ws)
closeSession(threadId)
getSession(threadId)
touchSession(threadId)
attachWebSocket(threadId, ws)
detachWebSocket(threadId)
isActive(threadId)
getActiveSessionCount()
_enforceSessionLimit()
_setIdleTimeout(threadId)
_clearIdleTimeout(threadId)
```

The `activeSessions` Map, `timeouts` Map, and config values (`maxActiveSessions`, `idleTimeoutMinutes`) move with these methods. SessionManager owns its own state — do not leave these Maps in ThreadManager.

SessionManager does not need to know anything about thread CRUD, ThreadIndex, or ChatFile. It only knows about wire processes, WebSockets, and timers.

**Constructor signature:**
```js
class SessionManager {
  constructor(config = {}) {
    this.maxActiveSessions = config.maxActiveSessions ?? 10;
    this.idleTimeoutMinutes = config.idleTimeoutMinutes ?? 9;
    // ...
  }
}
```

**Type guard required in constructor** (see Gotchas below):
```js
if (typeof this.idleTimeoutMinutes !== 'number' || this.idleTimeoutMinutes <= 0) {
  throw new Error(`idleTimeoutMinutes must be a positive number, got: ${config.idleTimeoutMinutes}`);
}
```

---

### File 2: `lib/thread/auto-rename.js`

Extract these methods:
```
generateSummary(threadId)
autoRename(threadId)
```

`autoRename` needs to call back to ThreadIndex to write the new name. Accept the index as a constructor argument or pass it in as a parameter — do not import ThreadManager.

**Required race condition guard** (see Gotchas below) — add this check at the top of `autoRename` before writing the rename:

```js
async autoRename(threadId, index, sessionManager) {
  const summary = await this.generateSummary(threadId);
  if (!summary) return;

  // Guard: session may have closed while Kimi was running
  if (!sessionManager.isActive(threadId)) {
    console.log(`[AutoRename] Session ${threadId} closed during summarization, skipping rename`);
    return;
  }

  await index.rename(threadId, summary);
}
```

**Kimi pre-flight guard** (see Gotchas below) — wrap the spawn in a try/catch that logs a warning instead of silently failing:

```js
async generateSummary(threadId) {
  try {
    // existing spawn code
  } catch (err) {
    console.warn(`[AutoRename] Failed to spawn kimi for ${threadId}: ${err.message}`);
    return null;
  }
}
```

---

### Result: ThreadManager (thin orchestrator, ~250-300 lines)

ThreadManager keeps:
- Thread CRUD methods
- `_getViewsDir()`, `_ensureThreadsIndex()`, `_createChatFile()`
- `init()`
- `getHistory()`, `getRichHistory()`
- Delegation calls to SessionManager and AutoRename

ThreadManager constructor creates a SessionManager instance and an AutoRename instance, holds references to both.

---

## Gotchas — Handle These During Implementation

### 1. Race condition: closeSession() during autoRename() — MUST FIX

`autoRename()` is called fire-and-forget after the first assistant message. It spawns a Kimi subprocess that takes up to 10 seconds. If the user closes their WebSocket during that window:

1. `closeSession()` kills the main wire and marks the thread suspended in the index
2. Kimi finishes and calls `renameThread()` — writes a new name to a suspended thread
3. Thread state is now inconsistent: suspended but with a freshly updated name

**Fix:** The race condition guard is already specified above in the auto-rename.js implementation. The check `if (!sessionManager.isActive(threadId))` before writing the rename is mandatory.

This is not detectable by reading the two extracted files in isolation — it only surfaces when you think about the cross-module timing. It will not be caught in a normal review pass.

### 2. Idle timeout type validation — MUST ADD

`_setIdleTimeout()` does: `this.idleTimeoutMinutes * 60 * 1000`. If a string is passed (e.g., `'9'`), JavaScript evaluates this as NaN. `setTimeout(fn, NaN)` fires immediately. Every session closes the instant it opens.

Currently no config is passed from `server.js` so defaults are used safely, but this is a latent bug. The type guard in the SessionManager constructor (specified above) is mandatory.

### 3. Kimi not installed — wrap the spawn

If `kimi` is not in PATH, `spawn('kimi', ...)` throws synchronously. This is currently caught nowhere. The thread silently stays named "New Chat" forever.

The try/catch wrapper in `generateSummary` (specified above) is mandatory. Log a warning, return null, let the thread stay with its default name.

### 4. Kimi output format is version-dependent — do not change parsing logic

The current parsing logic (`TextPart`, `TurnBegin` JSON-RPC format) is fragile and version-dependent. Do not improve or change it during this refactor — just move it as-is. Changing it is a separate concern.

### 5. Eviction is LRU, not FIFO — enforceSessionLimit stays in ThreadManager

`_enforceSessionLimit()` uses `index.list()` (MRU-ordered via `touch()` calls) to find the least recently used session. This is **LRU eviction**, not FIFO. The spec originally called it FIFO — that was wrong.

SessionManager cannot access `index.list()` by design (it doesn't know about ThreadIndex). Therefore `enforceSessionLimit` must stay in ThreadManager, calling `sessionManager.closeSession()` to do the actual cleanup. SessionManager only owns session lifecycle (open, close, timeout), not eviction policy.

Do not implement eviction as Map insertion order — that would evict the first-opened session regardless of activity, killing actively-used conversations.

---

## What NOT to Do

- Do not change any method signatures visible to `ThreadWebSocketHandler.js`
- Do not add features, error handling for new scenarios, or logging beyond what is specified
- Do not change the Kimi output parsing logic
- Do not modify `ThreadWebSocketHandler.js` — it should continue to work by calling the same methods on ThreadManager, which now delegates internally
- Do not modify `lib/thread/index.js` re-exports unless the file paths change

---

## Verification

After the split, `ThreadWebSocketHandler.js` should require zero changes. It calls methods on a ThreadManager instance — those method signatures stay identical. ThreadManager just delegates internally to SessionManager and AutoRename.

Check that these still work end-to-end:
- Create a thread → opens session, starts idle timer
- Send a message → timer resets (touchSession)
- Close WebSocket → session cleans up, timer clears
- First assistant response → autoRename fires, doesn't throw if Kimi missing
- Open 11 threads → 11th evicts oldest (FIFO)

---

## Silent Fail Risks

| Risk | What Breaks | Symptom |
|------|-------------|---------|
| Race condition not guarded | Thread name written after suspension | Inconsistent thread list display |
| NaN timeout (string config) | Sessions close immediately on open | All threads disconnect after opening |
| Kimi spawn not try/caught | autoRename throws, crashes caller | Unhandled rejection in server process |
| activeSessions Map left in ThreadManager | Session state split across two objects | isActive() and closeSession() diverge |
| Timeout handles left in ThreadManager | Timers not cleared on close | Timer fires on dead session, logs errors |
