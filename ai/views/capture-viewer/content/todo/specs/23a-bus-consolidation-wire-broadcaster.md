# SPEC-23a: Server Bus Consolidation + Wire-Broadcaster Extraction

Part of SPEC-23. Read `23-CONTEXT-FORWARD.md` first for the architectural vision.

**Coordination warning:** This spec touches the same lines of `server.js` as SPEC-01 Extract 2 (Wire Message Router). Read `01-COORDINATION-with-SPEC-23.md` before starting. Recommended: combine this work into SPEC-01 Extract 2's pass.

---

## Issue

`server.js` does double work for chat events. For each chat event (turn_begin, content, thinking, tool_call, tool_result, turn_end, status_update), it both:

1. Emits to `event-bus` for internal subscribers (audit-subscriber, trigger-loader)
2. Calls `ws.send()` directly to forward to WebSocket clients

The two paths emit slightly different shapes of the same logical event. They drift over time. They duplicate the responsibility of "deliver chat events somewhere."

The bus is already the canonical source of truth for these events on the server side — `audit-subscriber.js:28-31` proves the pattern works. The missing piece is a bus subscriber that fans out to WebSocket clients. That's the wire-broadcaster.

## Files

- `open-robin-server/server.js` — currently lines 768-1037 (the wire message router region) contain both the bus emits AND the parallel ws.send calls
- `open-robin-server/lib/event-bus.js` — already exists, no changes needed
- `open-robin-server/lib/audit/audit-subscriber.js` — exists as the architectural template for the new module
- **NEW:** `open-robin-server/lib/wire/wire-broadcaster.js` — bus subscriber + WebSocket fan-out (~50-80 lines)

## Current emit call sites

```
server.js:802  emit('chat:turn_begin',   { workspace, threadId, turnId, userInput })
server.js:825  emit('chat:content',      { workspace, threadId, turnId, text })
server.js:842  emit('chat:thinking',     { workspace, threadId, turnId, text })
server.js:868  emit('chat:tool_call',    { workspace, threadId, turnId, toolName, toolCallId })
server.js:931  emit('chat:tool_result',  { workspace, threadId, turnId, toolCallId, toolName, isError })
server.js:961  emit('chat:turn_end',     { ... })
server.js:993  emit('chat:status_update',{ ... })
```

Each of these is followed (or preceded) somewhere nearby by a `ws.send(JSON.stringify({ type: '...', ... }))` call delivering the same logical event in a slightly different shape. **Audit these in detail before extracting** — the wire-broadcaster needs to know the exact wire shape clients expect today, because we cannot change client-facing wire shapes in this spec.

## Proposed extraction

### New file: `lib/wire/wire-broadcaster.js`

**One job:** Subscribe to `chat:*` events from event-bus and forward them to all connected WebSocket clients in the wire shape clients currently expect.

**Shape:**

```javascript
// lib/wire/wire-broadcaster.js
const { on } = require('../event-bus');

/**
 * Wire Broadcaster — bus → WebSocket fan-out for chat events.
 *
 * One job: subscribe to chat:* events and forward them to all
 * connected WebSocket clients in the shape clients expect.
 *
 * Replaces the inline ws.send() calls in server.js's wire message router.
 * After this, server.js emits each chat event to the bus exactly once;
 * we handle delivery.
 */
function createWireBroadcaster({ getConnectedClients }) {
  // getConnectedClients: () => Iterable<WebSocket> — provided by server.js
  // (the sessions Map or wss.clients).

  function broadcast(wireMessage) {
    const payload = JSON.stringify(wireMessage);
    for (const ws of getConnectedClients()) {
      if (ws.readyState === 1) ws.send(payload);
    }
  }

  // Map bus event to wire message shape (preserve existing client wire format)
  on('chat:turn_begin', (event) => {
    broadcast({ type: 'turn_begin', turnId: event.turnId, /* ... */ });
  });

  on('chat:content', (event) => {
    broadcast({ type: 'content', turnId: event.turnId, text: event.text });
  });

  on('chat:thinking', (event) => {
    broadcast({ type: 'thinking', turnId: event.turnId, text: event.text });
  });

  on('chat:tool_call', (event) => {
    broadcast({ type: 'tool_call', /* ... */ });
  });

  on('chat:tool_result', (event) => {
    broadcast({ type: 'tool_result', /* ... */ });
  });

  on('chat:turn_end', (event) => {
    broadcast({ type: 'turn_end', /* ... */ });
  });

  on('chat:status_update', (event) => {
    broadcast({ type: 'status_update', /* ... */ });
  });

  return { broadcast };
}

module.exports = { createWireBroadcaster };
```

### Modifications to `server.js`

1. Remove all inline `ws.send(JSON.stringify({ type: 'turn_begin', ... }))` and equivalent calls for chat events from the wire message router region (lines 768-1037).
2. Keep the `emit('chat:*', ...)` calls — they become the single source of truth.
3. In the startup orchestrator (around line 1639), instantiate the broadcaster: `createWireBroadcaster({ getConnectedClients: () => wss.clients })` (or pass a function that yields the relevant ws set per session-scoping).
4. Move `lib/wire/wire-broadcaster.js` instantiation BEFORE the WebSocket server starts accepting connections so subscriptions are registered up front.

### IMPORTANT: Per-client filtering

If chat events are scoped per-client (e.g., panel filtering, session filtering), the broadcaster needs to know which sessions should receive which events. Today server.js uses the per-session `ws` reference directly, which is implicit per-client routing.

**Read the existing emit + ws.send pairs carefully** to understand whether each chat event is:
- (a) broadcast to all clients (true broadcast), or
- (b) routed to a single client based on session/threadId (per-client)

If most are (b), the broadcaster needs a different shape — it takes a sessions map and routes by session ID, not raw fan-out. Adjust the API accordingly. Don't assume; verify in code.

This is the single biggest gotcha for this spec. Get it wrong and clients receive events for other users' threads, or events go to the wrong panel.

## Dependencies

- **Hard depends on:** Nothing (it's the first SPEC-23 sub-spec)
- **Soft depends on:** Nothing
- **Coordinates with:** SPEC-01 Extract 2 (see coordination doc). Also touches the same region as SPEC-01 Extract 2 — if they happen separately, do this one first so SPEC-01 Extract 2 inherits cleaner code.

## Gotchas

### 1. Per-client routing — see above
The biggest risk. Today the client message routing is implicit via direct `ws.send()` calls inside per-session closures. Moving to a global subscriber means routing has to become explicit. Read every chat-related ws.send call before extracting.

### 2. Event emission ordering
Today the order is roughly: `emit()` then `ws.send()` (or vice versa) in the same code block, in the same tick. After extraction, the bus emit triggers an async-but-synchronous-feeling `bus.on()` callback that calls broadcast. This is still synchronous (Node EventEmitter is sync), so ordering is preserved. **But verify** — if anything between the emit and the original ws.send mutated state, the new code path may see different state.

### 3. Same-event loop suppression in event-bus
`event-bus.js:33-39` has an `isSameEventLoop` guard that suppresses A→action→A loops on the same entity. The wire-broadcaster's subscribers should NOT trigger any further bus emits (or if they do, only after the guard chain depth resets). Audit subscriber doesn't emit, so it's clean. The broadcaster only calls `ws.send()` — no bus re-emit. Should be safe but verify.

### 4. checkSettingsBounce enforcement is in this region
`server.js:886-905`, inside the `ToolResult` event handler. **Do not move or alter this enforcement.** It runs after parsing tool args but before saving to history, and the `break` semantics matter. SPEC-23a touches the surrounding code but the bounce check stays exactly where it is. The bus emit for `chat:tool_result` happens AFTER the bounce check on line 931 — preserve that ordering.

### 5. wire-debug.log emission
There are some other ws.send calls related to wire debug logging, parse errors, and harness install state. These are NOT chat events. **Don't extract those.** Only extract the ones tied to `chat:*` bus emits.

### 6. The `'chat:turn_end'` event has multiple emit sites
server.js:961 AND every harness module (kimi, robin, qwen, gemini, codex, claude-code) all emit it. The harness emits are for cases where the harness signals turn end internally (vs server.js detecting it from wire messages). The wire-broadcaster doesn't care which source emitted it — it subscribes once and handles all of them. But be aware: there will be turn_end events flowing through that don't originate in server.js.

## Silent fail risks

| Risk | What Breaks | Symptom |
|---|---|---|
| Per-client routing collapsed to broadcast | Clients receive events for other users' threads | Privacy violation, wrong content in wrong panel |
| Bus subscriber registered after `wss.listen()` | First-connect clients miss early events | First message of first session looks blank or stalls |
| ws.send removed but bus emit not preserved | Event reaches no clients | Silent — chat appears stuck mid-stream |
| Wire shape changed during refactor | Client deserialization breaks | Console errors, blank chat |
| `checkSettingsBounce` accidentally moved | Tools write to settings/ folders | Security violation |
| Same-event loop suppression triggers spuriously | Some events get dropped | Intermittent missing chat events |

## Verification

After this spec is implemented:

- [ ] `server.js` no longer contains `ws.send(JSON.stringify({ type: 'turn_begin' ...` or any other chat event ws.send calls
- [ ] `lib/wire/wire-broadcaster.js` exists, under 100 lines, has one job described in one sentence without "and"
- [ ] Existing client receives chat events with no visible difference (manual test: send a message, watch the chat render — should look identical to before)
- [ ] Audit subscriber still receives events (check audit logs are still being written)
- [ ] `chat:status_update` still updates context usage on the client
- [ ] Settings bounce still works (test: ask AI to write to a settings/ folder; should bounce)
- [ ] Multi-session test if possible: open two browser tabs, send a message from tab A, verify only tab A's panel updates (not tab B)
- [ ] Server.js line count drops by ~80-100 lines
- [ ] No new dependencies introduced

## Estimated work

This is a single focused refactor on a small region of server.js. The work is mostly mechanical (move ws.send calls into a new file, swap them for bus subscriptions) plus careful auditing of per-client routing. Should be completable in one session if done carefully.

## After this spec

- SPEC-23b can begin (harness tier tagging) — it depends on the broadcaster being in place because new event types (`chat:tool_open`, `chat:tool_close`) will flow through the same path
- SPEC-01 Extract 2 (Wire Message Router) is now operating on cleaner code, OR this spec was combined into SPEC-01 Extract 2 and they finished together
