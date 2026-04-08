# Harness Routing Spec
**Status:** Ready for implementation  
**Date:** 2026-04-06  
**Session context:** Fresh — no prior context needed

---

## The Problem

When a user selects a harness in the `ChatHarnessPicker` UI (e.g. Gemini, Qwen, Claude Code), the client sends:

```json
{ "type": "thread:create", "harnessId": "gemini" }
```

The server receives this message at **`server.js` line 1037**, but **ignores `harnessId` entirely**. It always calls:

```js
session.wire = spawnThreadWire(threadId, projectRoot);
```

`spawnThreadWire` is imported from `lib/harness/compat.js`. In the current `HARNESS_MODE=legacy` (the default), it always spawns the KIMI CLI wire regardless of what harness was selected. Every "New Chat" always connects to KIMI.

---

## Architecture Context

### The two systems

**Legacy path** (current default):
- `spawnThreadWire()` in `lib/harness/compat.js` → spawns `kimi --wire --yolo --session <threadId>`
- Output is raw Kimi wire protocol (JSON-RPC)
- `setupWireHandlers()` in `server.js` reads stdout and forwards to WebSocket client
- Works well for KIMI

**New harness path** (built but not yet routed to):
- `lib/harness/registry.js` — singleton registry with all 6 harnesses registered
- `lib/harness/kimi/` — KimiHarness (wraps same CLI, but `sendMessage` not yet implemented)
- `lib/harness/clis/gemini/` — GeminiHarness (ACP protocol, fully wired to event bus)
- `lib/harness/clis/qwen/` — QwenHarness (ACP protocol, fully wired to event bus)
- `lib/harness/clis/claude-code/` — ClaudeCodeHarness (ACP protocol, fully wired)
- `lib/harness/clis/codex/` — CodexHarness (ACP protocol, fully wired)
- `lib/harness/robin/` — RobinHarness (Vercel AI SDK, fully wired)
- All CLI harnesses emit `chat:turn_end` and `chat:status_update` to the shared event bus
- The audit subscriber persists these to SQLite

### The feature flag

`lib/harness/feature-flags.js` reads `process.env.HARNESS_MODE`:
- `'legacy'` (default) → always KIMI wire
- `'new'` → uses registry + harness
- `'parallel'` → runs both (experimental)

Currently the server logs: `[Server] Harness mode: legacy`

### The `threads` DB table

`lib/harness/compat.js` has `getHarnessIdForThread(threadId)` which reads `harness_id` from the `threads` table. This is the intended lookup mechanism — the selected harness should be stored when the thread is created and read back when the thread is opened.

---

## What Needs to Be Built

### Step 1: Store `harnessId` when thread is created

Find where `ThreadWebSocketHandler.handleThreadCreate` is defined:

```
lib/thread/ThreadWebSocketHandler.js  (or similar)
```

The `clientMsg` passed to it contains `harnessId`. This value needs to be written to the `threads` table's `harness_id` column when the thread record is created.

If the `threads` table doesn't have a `harness_id` column yet, add the migration in the DB setup (check `lib/db/` for the schema setup file).

### Step 2: Route `thread:create` to the correct harness

In **`server.js` around line 1037–1065**, currently:

```js
if (clientMsg.type === 'thread:create') {
  console.log('[WS] thread:create received');
  await ThreadWebSocketHandler.handleThreadCreate(ws, clientMsg);
  
  const state = ThreadWebSocketHandler.getState(ws);
  const threadId = state?.threadId;
  if (threadId) {
    session.currentThreadId = threadId;
    session.wire = spawnThreadWire(threadId, projectRoot);   // ← ALWAYS KIMI
    registerWire(threadId, session.wire, projectRoot);
    setupWireHandlers(session.wire, threadId);
    initializeWire(session.wire);
    
    if (state?.threadManager) {
      await state.threadManager.openSession(threadId, session.wire, ws);
    }
  }
  return;
}
```

This needs to become harness-aware. The routing logic:

- If `harnessId === 'kimi'` or `harnessId` is missing → use `spawnThreadWire()` (legacy path, same as today)
- If `harnessId` is any other value → use the harness registry to start the thread

**For non-KIMI harnesses**, the flow is different from the legacy wire:

The ACP harnesses (Gemini, Qwen, Claude Code, Codex) communicate via `session.sendMessage()` not via raw stdin/stdout. They don't return a raw process — they return a session object with a `sendMessage` async generator.

The legacy `setupWireHandlers` expects a raw process with `.stdout` that emits Kimi wire protocol. ACP harnesses don't produce that.

Instead, ACP harnesses:
1. Emit `chat:turn_end` to the shared event bus (already implemented)
2. The client gets updates via the existing WebSocket message flow from the event bus

**The minimum viable routing:**

```js
const harnessId = clientMsg.harnessId || 'kimi';

if (harnessId === 'kimi') {
  // Legacy path — unchanged
  session.wire = spawnThreadWire(threadId, projectRoot);
  registerWire(threadId, session.wire, projectRoot);
  setupWireHandlers(session.wire, threadId);
  initializeWire(session.wire);
  if (state?.threadManager) {
    await state.threadManager.openSession(threadId, session.wire, ws);
  }
} else {
  // New harness path — use registry
  const { registry } = require('./lib/harness/registry');
  const harness = registry.get(harnessId);
  
  if (!harness) {
    console.error(`[WS] Unknown harness: ${harnessId}, falling back to kimi`);
    // fall back to KIMI
    session.wire = spawnThreadWire(threadId, projectRoot);
    registerWire(threadId, session.wire, projectRoot);
    setupWireHandlers(session.wire, threadId);
    initializeWire(session.wire);
  } else {
    await harness.initialize({});
    const harnessSession = await harness.startThread(threadId, projectRoot);
    session.harnessSession = harnessSession;  // store for sendMessage later
    session.harnessId = harnessId;
    // No wire to register — harness handles its own event bus output
  }
}
```

### Step 3: Route incoming chat messages to the correct harness

When the user sends a message in an active harness (non-KIMI) thread, the server currently writes to `process.stdin`. For ACP harnesses, it needs to call `harnessSession.sendMessage(text)` instead.

Find the handler in server.js where `user_input` messages from the client are processed (look for `clientMsg.type === 'user_input'` or similar). Add a check:

```js
if (session.harnessSession && session.harnessId !== 'kimi') {
  // ACP harness path
  for await (const event of session.harnessSession.sendMessage(userInput)) {
    // events already go to the event bus — but we may need to forward
    // some to the WebSocket for the UI streaming display
    if (event.type === 'content') {
      ws.send(JSON.stringify({ type: 'content', text: event.text }));
    }
    // ... etc
  }
} else {
  // Legacy path — write to wire stdin
  session.wire.stdin.write(JSON.stringify({ ... }) + '\n');
}
```

> **Note:** The exact WebSocket message format the client expects for streaming content needs to match the existing format that `setupWireHandlers` produces. Read `setupWireHandlers` carefully before implementing this step.

### Step 4: Handle `thread:open` for harness threads

When the user opens an existing thread (`clientMsg.type === 'thread:open'`), the server currently always spawns a new KIMI wire. It needs to:

1. Read `harness_id` from the `threads` table (use `getHarnessIdForThread(threadId)` already in `compat.js`)
2. If `harness_id !== 'kimi'`, start the correct harness instead of spawning a wire

---

## Files to Read Before Starting

In this order:

1. `lib/thread/ThreadWebSocketHandler.js` — understand `handleThreadCreate`, what it writes to DB
2. `lib/db/` — find schema file, check if `threads.harness_id` column exists
3. `server.js` lines 700–750 — read `setupWireHandlers` to understand the streaming format
4. `server.js` lines 900–1000 — find where `user_input` messages are handled
5. `lib/harness/registry.js` — confirm all 6 harnesses are registered
6. `lib/harness/clis/gemini/index.js` — understand what `startThread()` returns (session shape)

---

## Files to Modify

- `server.js` — thread:create routing logic (line ~1037), thread:open routing, user_input routing
- `lib/thread/ThreadWebSocketHandler.js` — store `harnessId` on thread creation
- Possibly `lib/db/` schema — add `harness_id` column to threads table if missing

---

## Do NOT Touch

- `lib/harness/clis/*/` — the harnesses themselves are complete and working
- `lib/harness/registry.js` — already has all 6 harnesses registered
- `lib/audit/audit-subscriber.js` — already working
- `lib/harness/model-catalog.js` — already built
- The legacy `spawnThreadWire` / `setupWireHandlers` path — keep it for KIMI

---

## Verification

After implementation:

1. Select Gemini in the harness picker → send a message → response appears in chat
2. Select Qwen → send a message → thinking blocks appear → response appears
3. Select KIMI → everything works exactly as before (legacy path unchanged)
4. Open an existing Gemini thread → correct harness reconnects (not KIMI wire)
5. Check `robin.db` — exchanges table has rows for non-KIMI harness conversations

---

## Restart

Always use `bash restart-kimi.sh` from the project root. Never manually kill processes or restart the server.
