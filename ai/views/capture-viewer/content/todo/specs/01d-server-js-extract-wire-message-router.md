# SPEC-01d — Extract Wire Message Router + Consolidate Bus (combined with SPEC-23a)

**Parent:** SPEC-01 (server.js decomposition) + SPEC-23 (chunking queue / bus-as-spine)
**Position:** Extraction 4 of 6 under SPEC-01. Combined with SPEC-23a per `01-COORDINATION-with-SPEC-23.md`.
**Depends on:** SPEC-01a, 01b, 01c all merged. Latest commit should be `d6dcc4b` (docs) or later — functional baseline is `4ea8ae3` (01c).
**Model recommendation:** Opus 4.6 with 1M context window. This spec is substantially more complex than 01a/b/c. Budget for careful reading.
**Estimated blast radius:** **High.** Fragile region. Two new files. Session closure extraction. Event bus schema change. Per-thread routing via augmented registry. Security-critical (`checkSettingsBounce` must stay atomic). The chat round-trip test is the ONLY reliable proof this works.

---

## Your mission

Two things happen in this spec, in one coordinated pass:

1. **SPEC-01 Extract 2** — Pull the `handleWireMessage` function (currently inside `wss.on('connection')` closure at `server.js:311–580`) out of server.js and into a new `lib/wire/message-router.js` module. The function becomes a factory-produced handler closed over the per-connection `session`/`ws`.

2. **SPEC-23a** — Consolidate the bus-vs-ws.send double-emit pattern. Today, every chat event in `handleWireMessage` does BOTH `emit('chat:*', ...)` AND `ws.send(JSON.stringify({ type: '...' }))`. After this spec, chat events emit to the bus **only**. A new `lib/wire/wire-broadcaster.js` module subscribes to `chat:*` events at startup and routes each to the correct client via the augmented `wireRegistry`.

Non-chat events (StepBegin, request/response/error, unknown default) stay as direct `ws.send` calls **inside the extracted message router**. Only `chat:*` events flow through the bus.

The `wireRegistry` Map (owned by `lib/wire/process-manager.js` after SPEC-01c) is **augmented** to carry a `ws` reference in each entry, enabling the broadcaster to look up the correct client per `threadId`.

**Four files change. Two new, two modified.** server.js drops from 1178 → ~880 lines.

**You are extracting AND consolidating.** Not mechanical. Behavior changes specifically for the bounce path (see Gotcha #4). Every other chat event keeps its external behavior identical — wire shape unchanged, client deserialization unchanged, audit-subscriber still works. The chat round-trip test is the canary.

---

## Context before you touch code

**Read all of these in full before starting.** This spec absorbs two prior specs' contexts and has gotchas that cross-reference all of them.

1. `ai/views/capture-viewer/content/todo/specs/01-server-js-CONTEXT-FORWARD.md` — SPEC-01 resume doc. Read gotchas **#1 Session closure scope**, **#5 checkSettingsBounce**.
2. `ai/views/capture-viewer/content/todo/specs/01-COORDINATION-with-SPEC-23.md` — the coordination doc that mandates this combined extraction.
3. `ai/views/capture-viewer/content/todo/specs/23-CONTEXT-FORWARD.md` — SPEC-23 master orientation. Read "Critical invariants" (sections 3 and 4 especially).
4. `ai/views/capture-viewer/content/todo/specs/23a-bus-consolidation-wire-broadcaster.md` — the SPEC-23 sub-spec this spec absorbs. Read the "Gotchas" section and the "Silent fail risks" table.
5. `ai/views/capture-viewer/content/todo/specs/01a-`, `01b-`, `01c-server-js-extract-*.md` — all three completed specs. Read for the factory-pattern + verification workflow.
6. `ai/views/capture-viewer/content/todo/REFACTOR-LOG.md` — observations across prior extractions. Read the 01c section specifically (`agentWireSessions` surprise, hoisting dependency, per-connection factory pattern).
7. `open-robin-server/lib/audit/audit-subscriber.js` — **the architectural template for `wire-broadcaster.js`**. Same shape: subscribe to bus events at startup, do work on each. Read the whole file (138 lines).
8. `open-robin-server/lib/event-bus.js` — the existing bus. You do not modify this file.
9. `open-robin-server/lib/wire/process-manager.js` — `wireRegistry` lives here after SPEC-01c. This spec augments `registerWire` to accept a `ws` parameter.
10. `open-robin-server/lib/startup.js` — the broadcaster is instantiated here, before `server.listen()` fires.

**Verify line-number drift.** Before you start:

```bash
wc -l open-robin-server/server.js
# Should report 1178. If different, reconcile.

grep -n 'function handleWireMessage\|checkSettingsBounce\|emit.*chat:\|createWireLifecycle' open-robin-server/server.js
```

Expected landmarks as of commit `4ea8ae3`:
- `51:const { checkSettingsBounce } = require('./lib/enforcement');` (or similar — verify the exact path)
- `304:  const { awaitHarnessReady, initializeWire, setupWireHandlers } = createWireLifecycle({`
- `308:    onWireMessage: handleWireMessage,`
- `311:  function handleWireMessage(msg) {`
- `345:          emit('chat:turn_begin', ...)`
- `368:            emit('chat:content', ...)`
- `385:            emit('chat:thinking', ...)`
- `411:          emit('chat:tool_call', ...)`
- `429:          const bounce = checkSettingsBounce(toolNameForBounce, parsedArgs);`
- `474:          emit('chat:tool_result', ...)`
- `504:            emit('chat:turn_end', ...)`
- `536:          emit('chat:status_update', ...)`

If any are off by more than ~5, stop and reconcile.

---

## Source — what you are moving and transforming

### Primary extraction: `handleWireMessage`

Lines **311–580** (inclusive) inside the `wss.on('connection')` callback. 270 lines. 10-case switch on wire event types plus 4 fallthrough branches for non-event wire messages.

Closes over:
- `session` (per-connection state object at line ~259)
- `ws` (the per-connection WebSocket)
- `ThreadWebSocketHandler` (module-level import, used for `addAssistantMessage` in the `TurnEnd` case)
- `emit` (from `./lib/event-bus`, used for the 7 chat emits + `system:tool_bounced`)
- `checkSettingsBounce` (from `./lib/enforcement`, used inside `ToolResult`)
- `generateId` (from `uuid`, used in `TurnBegin`)

Does NOT close over `connectionId`, `wireRegistry`, or anything from process-manager.js. The session state object is the one thing that MUST be injected explicitly — closure capture by the factory parameter.

### Side transformation: the 7 chat emit call sites + 7 parallel ws.send calls

Each of the 7 chat events currently has **both** an `emit` and a `ws.send`:

| Event | emit line | ws.send line | Transformation |
|---|---|---|---|
| `chat:turn_begin` | 345 | 340 | Delete ws.send. Keep emit. |
| `chat:content` (text) | 368 | 363 | Delete ws.send. Keep emit. |
| `chat:thinking` | 385 | 380 | Delete ws.send. Keep emit. |
| `chat:tool_call` | 411 | 405 | Delete ws.send. Keep emit. |
| `chat:tool_result` (normal) | 474 | 465 | Delete ws.send. Keep emit. |
| `chat:tool_result` (bounce) | **(no emit today)** | 438 | **Add new emit (Option (a)).** Delete ws.send. |
| `chat:turn_end` | 504 | 498 | Delete ws.send. Keep emit. |
| `chat:status_update` | 536 | 545 | Delete ws.send. Keep emit. |

After these transformations, every chat event flows through the bus only. The broadcaster subscribes to chat:* and fans out.

### Non-chat ws.send calls — **stay as direct sends inside the extracted router**

These are NOT chat events. Do NOT route them through the bus:

| Line | Case | Wire message type |
|---|---|---|
| 525 | `StepBegin` | `step_begin` |
| 553 | `default:` (unknown event type) | `event` (fallthrough) |
| 559 | `msg.method === 'request'` | `request` |
| 569 | `msg.id !== undefined && msg.result !== undefined` | `response` |
| 574 | `msg.id !== undefined && msg.error !== undefined` | `error` |
| 578 | `else` (fully unknown) | `unknown` |

These six `ws.send` calls move into `lib/wire/message-router.js` and fire directly via the injected `ws`. They are **per-connection direct sends**, not broadcast targets, and the bus-consolidation mandate only covers `chat:*` events (see SPEC-23a Gotcha #5: "There are some other ws.send calls related to wire debug logging, parse errors, and harness install state. These are NOT chat events. Don't extract those.").

### `checkSettingsBounce` — preserve atomically

Lines 427–448 (the bounce block inside `ToolResult`). The full block:

```js
const toolNameForBounce = payload?.function?.name || '';
const bounce = checkSettingsBounce(toolNameForBounce, parsedArgs);
if (bounce) {
  emit('system:tool_bounced', {
    workspace: 'code-viewer',
    threadId: session.currentThreadId,
    toolName: toolNameForBounce,
    filePath: parsedArgs.file_path,
    reason: bounce.message
  });
  ws.send(JSON.stringify({  // ← DELETE this ws.send
    type: 'tool_result',
    toolCallId,
    toolArgs: parsedArgs,
    toolOutput: bounce.message,
    toolDisplay: [],
    isError: true,
    turnId: session.currentTurn?.id
  }));
  break;  // ← KEEP this break — skips normal emit path
}
```

After the transformation:

```js
const toolNameForBounce = payload?.function?.name || '';
const bounce = checkSettingsBounce(toolNameForBounce, parsedArgs);
if (bounce) {
  emit('system:tool_bounced', {
    workspace: 'code-viewer',
    threadId: session.currentThreadId,
    toolName: toolNameForBounce,
    filePath: parsedArgs.file_path,
    reason: bounce.message
  });
  // NEW: emit chat:tool_result so the broadcaster handles bounce delivery uniformly
  emit('chat:tool_result', {
    workspace: 'code-viewer',
    threadId: session.currentThreadId,
    turnId: session.currentTurn?.id,
    toolCallId,
    toolName: toolNameForBounce,
    toolArgs: parsedArgs,
    toolOutput: bounce.message,
    toolDisplay: [],
    isError: true
  });
  break;  // ← STILL KEEP this break
}
```

**The `break` stays.** It prevents the bounce path from continuing into the normal tool_call-part update and normal emit. Load-bearing.

**The `system:tool_bounced` emit stays.** It's a system event, not a chat event. Any subscriber (even if there's none today) continues to work.

---

## Target — two new files

### File 1: `open-robin-server/lib/wire/wire-broadcaster.js`

~80 lines. Module shape:

```js
/**
 * Wire Broadcaster — bus → WebSocket fan-out for chat events.
 *
 * Extracted per SPEC-01d / SPEC-23a. Subscribes to chat:* events on the
 * event bus and routes each to the specific client whose connection
 * owns the thread that produced the event.
 *
 * Routing: uses getClientForThread(threadId), provided at init time.
 * Today that resolves via wireRegistry in lib/wire/process-manager.js
 * (augmented in this spec to carry a ws reference per entry).
 *
 * Architectural template: lib/audit/audit-subscriber.js. Same shape:
 * subscribe to bus events at startup, do work on each, no state.
 *
 * This module owns ONE job: translating bus events to wire messages
 * and delivering them to the right client. It does NOT own:
 *   - Event parsing (that's the wire message router)
 *   - Per-client session state (that's server.js)
 *   - The wire registry (that's lib/wire/process-manager.js)
 */

const { on } = require('../event-bus');

/**
 * Initialize the wire broadcaster. Call once at server startup,
 * BEFORE server.listen() opens the port. The returned object is
 * informational — there's no stop() because the process lifetime
 * owns the subscribers.
 *
 * @param {object} deps
 * @param {(threadId: string) => import('ws').WebSocket|null} deps.getClientForThread
 *        Called on every chat event; returns the ws that owns the thread,
 *        or null if the thread has no live wire.
 * @returns {{ started: boolean }}
 */
function createWireBroadcaster({ getClientForThread }) {

  function sendToThread(threadId, wireMessage) {
    const ws = getClientForThread(threadId);
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify(wireMessage));
  }

  on('chat:turn_begin', (event) => {
    sendToThread(event.threadId, {
      type: 'turn_begin',
      turnId: event.turnId,
      userInput: event.userInput,
    });
  });

  on('chat:content', (event) => {
    sendToThread(event.threadId, {
      type: 'content',
      text: event.text,
      turnId: event.turnId,
    });
  });

  on('chat:thinking', (event) => {
    sendToThread(event.threadId, {
      type: 'thinking',
      text: event.text,
      turnId: event.turnId,
    });
  });

  on('chat:tool_call', (event) => {
    sendToThread(event.threadId, {
      type: 'tool_call',
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      turnId: event.turnId,
    });
  });

  on('chat:tool_result', (event) => {
    sendToThread(event.threadId, {
      type: 'tool_result',
      toolCallId: event.toolCallId,
      toolArgs: event.toolArgs,
      toolOutput: event.toolOutput,
      toolDisplay: event.toolDisplay,
      isError: event.isError,
      turnId: event.turnId,
    });
  });

  on('chat:turn_end', (event) => {
    sendToThread(event.threadId, {
      type: 'turn_end',
      turnId: event.turnId,
      fullText: event.fullText,
      hasToolCalls: event.hasToolCalls,
    });
  });

  on('chat:status_update', (event) => {
    sendToThread(event.threadId, {
      type: 'status_update',
      contextUsage: event.contextUsage,
      tokenUsage: event.tokenUsage,
    });
  });

  console.log('[WireBroadcaster] Started');
  return { started: true };
}

module.exports = { createWireBroadcaster };
```

**Note on wire-message shape.** Each `sendToThread` call constructs the wire-format message that clients expect. **These shapes are EXACTLY what the current `ws.send` calls produce.** Do not change any field name, do not omit any field, do not add fields. Clients deserialize by field name. See the audit in the Source section above for the existing shapes.

### File 2: `open-robin-server/lib/wire/message-router.js`

~260 lines (close to the extracted count — minimal added overhead). Module shape:

```js
/**
 * Wire Message Router — per-connection router for wire protocol messages.
 *
 * Extracted from server.js per SPEC-01d. Handles the 10-case event switch
 * (TurnBegin, ContentPart, ToolCall, ToolCallPart, ToolResult, TurnEnd,
 * StepBegin, StatusUpdate, default), plus the four non-event fallthroughs
 * (request, response result, response error, unknown).
 *
 * Chat events (turn_begin, content, thinking, tool_call, tool_result,
 * turn_end, status_update) are emitted to the event bus only — the
 * wire-broadcaster in lib/wire/wire-broadcaster.js subscribes and handles
 * client fan-out via threadId routing through wireRegistry.
 *
 * Non-chat events (step_begin, request, response, error, unknown) are
 * sent directly to the injected ws. They are per-connection transport
 * messages and do not flow through the bus.
 *
 * Created once per WebSocket connection inside wss.on('connection').
 * Closes over the per-connection session and ws.
 *
 * SECURITY: checkSettingsBounce runs atomically inside the ToolResult
 * case. The bounce path now emits chat:tool_result (with isError: true)
 * so the broadcaster handles bounced tools uniformly — no more inline
 * ws.send in the bounce path.
 */

const { v4: generateId } = require('uuid');

/**
 * Create a per-connection wire message router.
 *
 * @param {object} deps
 * @param {object} deps.session - per-connection session state (mutated)
 * @param {import('ws').WebSocket} deps.ws - for non-chat direct sends
 * @param {object} deps.threadWebSocketHandler - for TurnEnd assistant-message persistence
 * @param {(type: string, payload: object) => void} deps.emit - event bus emit
 * @param {(toolName: string, args: object) => {message: string}|null} deps.checkSettingsBounce
 * @returns {{ handleMessage: (msg: object) => void }}
 */
function createWireMessageRouter({ session, ws, threadWebSocketHandler, emit, checkSettingsBounce }) {

  function handleMessage(msg) {
    console.log('[Wire] Message received:', msg.method, msg.id ? `(id:${msg.id})` : '(event)');

    // Guard: don't process if WebSocket closed
    if (ws.readyState !== 1) {
      console.log('[Wire] WebSocket closed, dropping message');
      return;
    }

    // Event notifications
    if (msg.method === 'event' && msg.params) {
      const { type: eventType, payload } = msg.params;
      console.log('[Wire] Event:', eventType);

      switch (eventType) {
        case 'TurnBegin':
          // Ignore spurious startup turns (Gemini emits one on ACP session creation)
          if (!payload?.user_input && !session.pendingUserInput) {
            console.log('[Wire] Ignoring spurious TurnBegin (no user input)');
            break;
          }
          session.currentTurn = {
            id: generateId(),
            text: '',
            userInput: payload?.user_input || session.pendingUserInput || ''
          };
          session.pendingUserInput = null;
          session.hasToolCalls = false;
          session.assistantParts = [];
          emit('chat:turn_begin', {
            workspace: 'code-viewer',
            threadId: session.currentThreadId,
            turnId: session.currentTurn.id,
            userInput: session.currentTurn.userInput
          });
          break;

        case 'ContentPart':
          if (payload?.type === 'text' && session.currentTurn) {
            session.currentTurn.text += payload.text;

            const lastPart = session.assistantParts[session.assistantParts.length - 1];
            if (lastPart && lastPart.type === 'text') {
              lastPart.content += payload.text;
            } else {
              session.assistantParts.push({
                type: 'text',
                content: payload.text
              });
            }

            emit('chat:content', {
              workspace: 'code-viewer',
              threadId: session.currentThreadId,
              turnId: session.currentTurn.id,
              text: payload.text
            });
          } else if (payload?.type === 'think') {
            const lastPart = session.assistantParts[session.assistantParts.length - 1];
            if (lastPart && lastPart.type === 'think') {
              lastPart.content += payload.think || '';
            } else {
              session.assistantParts.push({
                type: 'think',
                content: payload.think || ''
              });
            }
            emit('chat:thinking', {
              workspace: 'code-viewer',
              threadId: session.currentThreadId,
              turnId: session.currentTurn?.id,
              text: payload.think || ''
            });
          }
          break;

        case 'ToolCall':
          session.hasToolCalls = true;
          session.activeToolId = payload?.id || '';
          session.toolArgs[session.activeToolId] = '';
          session.assistantParts.push({
            type: 'tool_call',
            toolCallId: session.activeToolId,
            name: payload?.function?.name || 'unknown',
            arguments: {},
            result: {
              output: '',
              display: [],
              isError: false
            }
          });
          emit('chat:tool_call', {
            workspace: 'code-viewer',
            threadId: session.currentThreadId,
            turnId: session.currentTurn?.id,
            toolName: payload?.function?.name || 'unknown',
            toolCallId: session.activeToolId
          });
          break;

        case 'ToolCallPart':
          if (session.activeToolId && payload?.arguments_part) {
            session.toolArgs[session.activeToolId] += payload.arguments_part;
          }
          break;

        case 'ToolResult': {
          const toolCallId = payload?.tool_call_id || '';
          const fullArgs = session.toolArgs[toolCallId] || '';
          let parsedArgs = {};
          try { parsedArgs = JSON.parse(fullArgs); } catch (_) {}
          delete session.toolArgs[toolCallId];

          // --- Hardwired enforcement: settings/ folder write-lock ---
          const toolNameForBounce = payload?.function?.name || '';
          const bounce = checkSettingsBounce(toolNameForBounce, parsedArgs);
          if (bounce) {
            emit('system:tool_bounced', {
              workspace: 'code-viewer',
              threadId: session.currentThreadId,
              toolName: toolNameForBounce,
              filePath: parsedArgs.file_path,
              reason: bounce.message
            });
            // Emit chat:tool_result for bounced tools so the broadcaster
            // handles delivery uniformly. Same shape as a normal tool_result
            // but with isError=true and the bounce message as output.
            emit('chat:tool_result', {
              workspace: 'code-viewer',
              threadId: session.currentThreadId,
              turnId: session.currentTurn?.id,
              toolCallId,
              toolName: toolNameForBounce,
              toolArgs: parsedArgs,
              toolOutput: bounce.message,
              toolDisplay: [],
              isError: true
            });
            break;
          }
          // --- End enforcement ---

          const toolCallPart = session.assistantParts.find(
            p => p.type === 'tool_call' && p.name === (payload?.function?.name || '')
          );
          if (toolCallPart) {
            toolCallPart.arguments = parsedArgs;
            toolCallPart.result = {
              output: payload?.return_value?.output || '',
              display: payload?.return_value?.display || [],
              error: payload?.return_value?.is_error ? (payload?.return_value?.output || 'Tool failed') : undefined,
              files: payload?.return_value?.files || []
            };
          }

          emit('chat:tool_result', {
            workspace: 'code-viewer',
            threadId: session.currentThreadId,
            turnId: session.currentTurn?.id,
            toolCallId,
            toolName: payload?.function?.name,
            toolArgs: parsedArgs,
            toolOutput: payload?.return_value?.output || '',
            toolDisplay: payload?.return_value?.display || [],
            isError: payload?.return_value?.is_error || false
          });
          break;
        }

        case 'TurnEnd':
          if (session.currentTurn) {
            const metadata = {
              contextUsage: session.contextUsage,
              tokenUsage: session.tokenUsage,
              messageId: session.messageId,
              planMode: session.planMode,
              capturedAt: Date.now()
            };

            threadWebSocketHandler.addAssistantMessage(
              ws,
              session.currentTurn.text,
              session.hasToolCalls,
              metadata
            );

            emit('chat:turn_end', {
              workspace: 'code-viewer',
              threadId: session.currentThreadId,
              turnId: session.currentTurn.id,
              fullText: session.currentTurn.text,
              hasToolCalls: session.hasToolCalls,
              userInput: session.currentTurn.userInput,
              parts: session.assistantParts
            });

            session.currentTurn = null;
            session.assistantParts = [];
            session.contextUsage = null;
            session.tokenUsage = null;
            session.messageId = null;
            session.planMode = false;
          }
          break;

        case 'StepBegin':
          // Non-chat event — direct ws.send, not routed through the bus
          ws.send(JSON.stringify({ type: 'step_begin', stepNumber: payload?.n }));
          break;

        case 'StatusUpdate':
          session.contextUsage = payload?.context_usage ?? null;
          session.tokenUsage = payload?.token_usage ?? null;
          session.messageId = payload?.message_id ?? null;
          session.planMode = payload?.plan_mode ?? false;

          emit('chat:status_update', {
            workspace: 'code-viewer',
            threadId: session.currentThreadId,
            contextUsage: payload?.context_usage,
            tokenUsage: payload?.token_usage,
            messageId: payload?.message_id,
            planMode: payload?.plan_mode
          });
          break;

        default:
          // Non-chat: unknown event type — forward raw to client
          ws.send(JSON.stringify({ type: 'event', eventType, payload }));
      }
    }

    // Non-chat: requests from agent
    else if (msg.method === 'request' && msg.params) {
      ws.send(JSON.stringify({
        type: 'request',
        requestType: msg.params.type,
        payload: msg.params.payload,
        requestId: msg.id
      }));
    }

    // Non-chat: responses to our requests
    else if (msg.id !== undefined && msg.result !== undefined) {
      ws.send(JSON.stringify({ type: 'response', id: msg.id, result: msg.result }));
    }

    // Non-chat: errors
    else if (msg.id !== undefined && msg.error !== undefined) {
      ws.send(JSON.stringify({ type: 'error', id: msg.id, error: msg.error }));
    }

    // Non-chat: unknown
    else {
      ws.send(JSON.stringify({ type: 'unknown', data: msg }));
    }
  }

  return { handleMessage };
}

module.exports = { createWireMessageRouter };
```

**Transcribe the current handleWireMessage body character-for-character into the switch statement**, with the single exceptions listed above (delete the 7 chat ws.send calls; add the bounce-path emit). Do not "improve" any case. Do not consolidate the `workspace: 'code-viewer'` hardcoding (it's a pre-existing bug; out of scope — see Gotcha #8).

---

## Wiring — what changes in the other files

### 1. `lib/wire/process-manager.js` — augment `registerWire`

**Current signature:**

```js
function registerWire(threadId, wire, projectRoot) {
  wireRegistry.set(threadId, { wire, projectRoot });
  console.log(`[WireRegistry] Registered wire for thread ${threadId.slice(0,8)}, pid: ${wire?.pid}`);
}
```

**New signature:**

```js
function registerWire(threadId, wire, projectRoot, ws) {
  wireRegistry.set(threadId, { wire, projectRoot, ws });
  console.log(`[WireRegistry] Registered wire for thread ${threadId.slice(0,8)}, pid: ${wire?.pid}`);
}
```

Every caller of `registerWire` gets an extra `ws` argument. Find all call sites with:

```bash
grep -rn 'registerWire(' open-robin-server/ --include='*.js'
```

Expected call sites in server.js (post-01c line numbers):
- `server.js:~617` — inside the `thread:create` handler
- `server.js:~755` — inside the `thread:open` handler (or wherever it is now)
- `server.js:~783` — inside the `thread:open-daily` handler
- `server.js:~883` — inside the `thread:open-agent` handler

Each call site becomes `registerWire(threadId, wire, projectRoot, ws)`. The `ws` reference is already available in all four call sites because they're inside `wss.on('connection', (ws) => { ... })`.

**Also add a new export to process-manager.js:** a lookup helper for the broadcaster.

```js
function getClientForThread(threadId) {
  return wireRegistry.get(threadId)?.ws || null;
}
```

And add it to the module exports:

```js
module.exports = {
  getWireForThread,
  getClientForThread,  // ← NEW
  registerWire,
  unregisterWire,
  sendToWire,
  createWireLifecycle,
};
```

**Do not rename `getWireForThread`.** It returns the wire; `getClientForThread` returns the ws. Both live in the same module, both key on threadId, both come from the same `wireRegistry` Map.

### 2. `lib/startup.js` — instantiate the broadcaster before listen

The broadcaster must be initialized BEFORE `server.listen()` opens the port — otherwise early chat events from fast-connecting clients would fire before the bus subscriptions are registered, and those events would go nowhere (silent loss).

Inside `start()`, after `startAuditSubscriber()` and before the `await new Promise((resolve) => server.listen(...))` block:

```js
// 3.5. Wire broadcaster — must subscribe before listen() so chat events
// from the first connection are delivered.
const { createWireBroadcaster } = require('./wire/wire-broadcaster');
const { getClientForThread } = require('./wire/process-manager');
createWireBroadcaster({ getClientForThread });
```

The returned `{ started: true }` is informational; the subscriptions are the side effect. Don't store the return value unless you want to log it.

### 3. `server.js` — replace handleWireMessage with the factory

Inside `wss.on('connection', (ws) => { ... })`, replace the current block:

```js
// Per-connection wire lifecycle helpers. onWireMessage relies on function
// declaration hoisting — handleWireMessage is defined further down...
const { awaitHarnessReady, initializeWire, setupWireHandlers } = createWireLifecycle({
  session,
  ws,
  connectionId,
  onWireMessage: handleWireMessage,
});

function handleWireMessage(msg) {
  // ... 270 lines ...
}
```

With:

```js
// Per-connection wire message router (extracted per SPEC-01d).
// Emits chat:* events to the bus (wire-broadcaster handles client
// delivery); sends non-chat events directly via ws.
const { handleMessage } = createWireMessageRouter({
  session,
  ws,
  threadWebSocketHandler: ThreadWebSocketHandler,
  emit,
  checkSettingsBounce,
});

// Per-connection wire lifecycle helpers.
const { awaitHarnessReady, initializeWire, setupWireHandlers } = createWireLifecycle({
  session,
  ws,
  connectionId,
  onWireMessage: handleMessage,
});
```

Note the reordering: the message router factory is called BEFORE the wire lifecycle factory now. This is required because `createWireLifecycle` wants `handleMessage` as its `onWireMessage` callback, and we no longer rely on function hoisting.

**The hoisting dependency from SPEC-01c is gone.** You can now simplify the comment above the factory calls. Remove the "`onWireMessage` relies on function declaration hoisting" comment — it's no longer accurate.

Delete the entire `function handleWireMessage(msg) { ... }` block at lines 311–580. It's now in `lib/wire/message-router.js`.

### 4. `server.js` — add the new import

Near the existing `lib/wire/process-manager` import (around line 53):

```js
const { createWireMessageRouter } = require('./lib/wire/message-router');
```

### 5. `server.js` — update `registerWire` call sites

Find the 4 call sites (grep for `registerWire(` in server.js) and add `ws` as the fourth argument:

```js
// Before:
registerWire(threadId, wire, projectRoot);

// After:
registerWire(threadId, wire, projectRoot, ws);
```

All four call sites are inside `wss.on('connection', (ws) => { ... })`, so `ws` is in scope.

### 6. Verify all references are gone

After the extraction:

```bash
grep -n 'function handleWireMessage' open-robin-server/server.js
# → zero matches

grep -n "ws\.send(JSON\.stringify({ type: 'turn_begin'\|ws\.send(JSON\.stringify({ type: 'content'\|ws\.send(JSON\.stringify({ type: 'thinking'\|ws\.send(JSON\.stringify({ type: 'tool_call'\|ws\.send(JSON\.stringify({ type: 'tool_result'\|ws\.send(JSON\.stringify({ type: 'turn_end'\|ws\.send(JSON\.stringify({ type: 'status_update'" open-robin-server/server.js
# → zero matches for chat event types in server.js (should only appear in message-router.js if at all, and there NOT for chat events)

grep -n "emit('chat:" open-robin-server/server.js
# → zero matches (all chat emits moved to message-router.js)

grep -n "createWireMessageRouter" open-robin-server/server.js
# → two matches: import + factory call

grep -rn "emit('chat:" open-robin-server/lib/wire/
# → exactly 7 matches in message-router.js (one per chat event type; tool_result appears twice — normal + bounce, but as two separate emits)

grep -rn "wireRegistry" open-robin-server/ --include='*.js'
# → one file: lib/wire/process-manager.js. Declaration + 3 helpers + getClientForThread = 5 lines
```

---

## Gotchas — preserve these exactly

### 1. `checkSettingsBounce` atomicity — THE security-critical gotcha

The bounce block at lines 427–448 **must remain atomic** inside the `ToolResult` case. The sequence is:

1. Parse tool args
2. Check if bounce applies
3. If bounce: emit system:tool_bounced → emit chat:tool_result (NEW) → **break** out of the switch case
4. If no bounce: continue to normal result persistence + normal chat:tool_result emit

**The `break` statement is load-bearing.** If you remove it, bounced tools fall through to the normal path and get saved to history with the real tool output (not the bounce message). That's a security bypass.

Do not:
- Move the bounce check to a separate function (subtle: if extracted, the `break` semantics change to `return` and the enclosing switch may behave differently)
- Wrap the bounce check in a try/catch (hides errors)
- Add middleware between the parse and the check
- Run the bounce check AFTER the assistantParts update (it must run BEFORE)
- Use `continue` instead of `break` (there's no loop; this would be a syntax error but worth noting)

### 2. Session closure scope

The `session` object is mutated inside nearly every case. Each of these mutations must continue to operate on the same per-connection session that `wss.on('connection')` initialized:

- `TurnBegin`: writes `session.currentTurn`, `session.pendingUserInput`, `session.hasToolCalls`, `session.assistantParts`
- `ContentPart`: writes `session.currentTurn.text`, `session.assistantParts`
- `ToolCall`: writes `session.hasToolCalls`, `session.activeToolId`, `session.toolArgs`, `session.assistantParts`
- `ToolCallPart`: writes `session.toolArgs[...]`
- `ToolResult`: reads/deletes `session.toolArgs[toolCallId]`, conditionally writes `session.assistantParts[...].result`
- `TurnEnd`: reads `session.currentTurn`, `session.contextUsage`, `session.tokenUsage`, `session.messageId`, `session.planMode`, `session.assistantParts`, `session.hasToolCalls`. Resets all of those after persistence.
- `StatusUpdate`: writes `session.contextUsage`, `session.tokenUsage`, `session.messageId`, `session.planMode`

**Every one of these must hit the same session object.** The factory takes `session` as a parameter, captures it via closure, and all case bodies reference it directly. Because the factory is called inside `wss.on('connection')` **once per connection**, each connection gets its own `handleMessage` closure over its own session.

**The failure mode to avoid:** if you move the factory call outside `wss.on('connection')` (as a module-level call), all connections share one session reference → state corruption → impossible-to-debug "why is my text appearing in someone else's chat" bugs.

### 3. `handleMessage` hoisting dependency is GONE

SPEC-01c relied on function-declaration hoisting because `onWireMessage: handleWireMessage` appeared before `function handleWireMessage` textually. After SPEC-01d, you create the message router first (getting `handleMessage` from the factory), then pass it to the wire lifecycle factory. No hoisting. Both are `const` destructures.

**Remove the hoisting comment from server.js.** It was added in SPEC-01c; it's no longer accurate.

### 4. The bounce path emits `chat:tool_result` now — behavior change

This is the ONE intentional behavior change in SPEC-01d. Previously, bounced tools did a direct `ws.send` and broke out of the switch without emitting to the bus. After SPEC-01d, the bounce path emits `chat:tool_result` with `isError: true` and the bounce message as the output. The broadcaster picks it up and delivers uniformly.

**Why this matters:**
- Audit subscriber today subscribes to `chat:turn_end` and `chat:status_update`, NOT `chat:tool_result`. So this new emit doesn't affect audit-subscriber's behavior.
- No other subscriber exists for `chat:tool_result` today. Verify with `grep -rn "on\(.chat:tool_result." open-robin-server/`.
- The broadcaster is a NEW subscriber that picks this up and delivers.
- The client sees exactly the same wire message it saw before (same shape, same fields).

**Net: from the client's perspective, nothing changes.** The bounce message still appears in the chat exactly as before. The internal plumbing is just cleaner.

**Out of scope:** the current bounce is REACTIVE (runs after the CLI has already executed the tool). The future architecture will make it PREVENTIVE (intercept before execution + user bypass popup). SPEC-01d does not fix this. The bounce in 01d is still cosmetic. Anyone who reads this spec later and expects the bounce to actually prevent filesystem writes: it doesn't. That's a separate future refactor.

### 5. `system:tool_bounced` emit stays

The `emit('system:tool_bounced', {...})` call in the bounce path stays **unchanged**. It's a system-level event, not a chat event. The broadcaster doesn't subscribe to it. If any subscriber exists elsewhere (audit, logging, future metrics), they continue to receive it. Preserve verbatim.

### 6. Non-chat events do NOT flow through the bus

The 6 non-chat `ws.send` calls (`step_begin`, fallthrough `event`, `request`, `response`, `error`, `unknown`) stay as direct `ws.send` inside the extracted message router. **Do not invent new bus events** for these. SPEC-23a is explicit: only `chat:*` events are in scope.

Why: these are either per-connection transport messages (request/response correlation by `msg.id`) or unknown/fallthrough handling. They don't need cross-client routing because they're inherently per-connection (the request id space is per-connection, the wire lifecycle is per-connection).

### 7. Bus subscription timing

`createWireBroadcaster` MUST be called before `server.listen()`. Otherwise:
- First-connection clients send their initial messages
- Wire spawns, produces chat events
- `emit('chat:*', ...)` fires
- No subscribers exist yet → event goes nowhere
- Client waits for responses that never arrive

The spec places the broadcaster init inside `lib/startup.js` at step 3.5 (between `startAuditSubscriber()` and the `server.listen()` Promise). Don't move it.

### 8. `workspace: 'code-viewer'` hardcoding is a pre-existing bug — DO NOT FIX

Every chat emit in the current handleWireMessage hardcodes `workspace: 'code-viewer'`:

```js
emit('chat:content', { workspace: 'code-viewer', ... });
```

The actual panel/view name depends on the connection's current panel (which can be `capture-viewer`, `agents-viewer`, etc., not always `code-viewer`). This is a latent bug — anything filtering bus events by workspace would incorrectly attribute all events to `code-viewer`.

**Preserve the hardcoding exactly.** Do not "fix" it during this extraction. It's a separate future cleanup. File it in the refactor log.

### 9. `chat:turn_end` has multiple emit sites (per SPEC-23a Gotcha #6)

`chat:turn_end` is emitted from `handleWireMessage` AND from harness modules (kimi, qwen, gemini, codex, claude-code). After this extraction, the broadcaster subscribes once and handles all of them. The harness emits carry slightly different shapes — they may be missing some fields. **Verify the broadcaster handles a partial payload gracefully** (e.g., `event.fullText` may be undefined for harness-originated turn_end; the wire message should still be constructed and delivered, with undefined → undefined in the client message, which clients already handle today).

### 10. `getClientForThread` returns `null` for untracked threads

If a chat event fires for a `threadId` that isn't in wireRegistry, `getClientForThread` returns `null` and `sendToThread` drops the event silently (the early return). This matches current behavior — today, if handleWireMessage fires with `session.currentThreadId = null`, the emit carries `threadId: null`, the broadcaster looks up null, gets null, drops silently.

**Do not add logging or warnings for this case in the broadcaster.** It's normal during startup / thread switching transitions and would be noise.

### 11. `global.__agentWireSessions` still untouched

Per SPEC-01c gotcha #2: `agentWireSessions` and the `global.__agentWireSessions` assignment stay in server.js. This spec does not touch them. Verify after extraction:

```bash
grep -n 'global.__agentWireSessions' open-robin-server/server.js
# → exactly one match
```

If it's zero, you accidentally deleted the assignment. Restore it before continuing.

---

## Verification checklist

After the extraction, run these in order. Stop and report if any step fails.

### Sanity checks (static)

1. `wc -l open-robin-server/server.js` — approximately 880 lines (down from 1178).
2. `wc -l open-robin-server/lib/wire/message-router.js` — approximately 260 lines.
3. `wc -l open-robin-server/lib/wire/wire-broadcaster.js` — approximately 90 lines.
4. `wc -l open-robin-server/lib/wire/process-manager.js` — approximately 165 lines (158 before + ~7 for getClientForThread and the augmented registerWire).
5. `wc -l open-robin-server/lib/startup.js` — approximately 200 lines (197 before + ~3 for the broadcaster init).
6. `node -e "require('./open-robin-server/lib/wire/message-router')"` — loads clean.
7. `node -e "require('./open-robin-server/lib/wire/wire-broadcaster')"` — loads clean.
8. `node -e "require('./open-robin-server/server.js')"` — may throw `EADDRINUSE`; that's fine. Any `SyntaxError` / `ReferenceError` / `TypeError` is a fail.
9. Grep checks from the "Verify all references are gone" section above — all six must pass.

### Runtime checks

Run `./restart-kimi.sh`. If the script exits with an error, stop and report.

10. `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/` → `200`.
11. `tail -60 open-robin-server/server-live.log` — expected sequence:
    ```
    [DB] robin.db initialized
    [AuditSubscriber] Started
    [WireBroadcaster] Started
    [Server] Running on http://localhost:3001
    ...
    ```
    No errors, no stack traces, no unhandled rejections.
12. **Chat round-trip — THE CANARY.** Open the browser, create a new thread, send a message. The full round-trip must succeed:
    - Wire spawns
    - Wire emits turn_begin, content, potentially tool_call/tool_result, turn_end
    - Each chat event fires on the bus
    - Broadcaster routes each to the ws that owns the thread
    - Client receives and renders
    - The response appears in the chat
    If the response doesn't appear or appears in the wrong tab (if you have two tabs), stop and report the symptom precisely. This is the test that proves both the routing and the session closure work.
13. **Multi-tab test.** Open two browser tabs to `http://localhost:3001`. Send a message in tab A. Verify:
    - Tab A receives the response ✓
    - Tab B does NOT receive tab A's response ✗
    This is the cross-client leakage check. If tab B sees tab A's chat, the broadcaster is misrouting (likely the `getClientForThread` is returning the wrong ws).
14. **Settings bounce test.** Ask the AI (in chat) to write to a file inside `ai/views/settings/` or `ai/views/*/settings/`. The bounce should fire — the client should see a `tool_result` with `isError: true` and the bounce message as output. Confirm by watching the chat UI.
15. **Audit still works.** Check that new exchanges are being persisted to the database. Send a message, wait for the response, then query the SQLite `exchanges` table (or whatever the audit-subscriber writes to) to see if the new exchange appears with metadata. If audit breaks, the `chat:turn_end` bus event lost a field the audit-subscriber needs.
16. **Status update still works.** Send a message and watch the client's context-usage indicator. It should update as the wire streams. If it doesn't update, the `chat:status_update` event broke.
17. `grep -c '\[WireBroadcaster\]' open-robin-server/server-live.log` — at least 1 (the startup log). No "[WireBroadcaster] Error" or similar failure messages.
18. **Clean shutdown test:** `lsof -ti:3001 | xargs kill -TERM`. Port freed within a few seconds. No stack trace in the log.

---

## What NOT to do

- **Do not** change `checkSettingsBounce` placement, semantics, or the `break` after it. See Gotcha #1.
- **Do not** move the factory call outside `wss.on('connection')`. See Gotcha #2.
- **Do not** rename `handleWireMessage` to anything else — call the extracted function `handleMessage` inside the module, consistent with the factory pattern.
- **Do not** add new bus events for non-chat wire messages. See Gotcha #6.
- **Do not** fix the `workspace: 'code-viewer'` hardcoding. See Gotcha #8.
- **Do not** move the broadcaster init inside `wss.on('connection')`. It's module-level startup work; each new connection doesn't need its own broadcaster.
- **Do not** merge `lib/wire/message-router.js` and `lib/wire/wire-broadcaster.js`. Two concerns: parsing+routing vs. delivery. Single concern per file.
- **Do not** change `registerWire`'s behavior beyond adding the `ws` parameter. Same logging, same console.log format.
- **Do not** add `getClientForThread` to the module exports of anything other than `lib/wire/process-manager.js`. Only the broadcaster uses it at the moment.
- **Do not** remove or modify the `system:tool_bounced` emit. See Gotcha #5.
- **Do not** touch the harness modules or `lib/harness/compat.js`.
- **Do not** touch the audit-subscriber. The chat:turn_end and chat:status_update shapes are preserved (with the extra fields the broadcaster uses being additive, not replacing).
- **Do not** touch client-side code. SPEC-01d is pure server.
- **Do not** touch `lib/event-bus.js`. No changes needed.
- **Do not** push the commit. Commit locally only.
- **Do not** update this spec doc. The user does that.
- **Do not** start SPEC-01e. Stop after SPEC-01d.
- **Do not** attempt to fix any bug unrelated to this spec. File it in the refactor log or a follow-up spec; do not fix inline.

---

## Commit

One commit. Message:

```
Extract wire message router + consolidate chat event bus

Part 4 of 6 under SPEC-01 (server.js decomposition), combined with
SPEC-23a (bus consolidation + wire broadcaster) per the coordination
doc. This is a single coordinated pass through the fragile wire
message routing region (server.js:311-580) instead of two separate
extractions.

Changes:

- NEW: lib/wire/message-router.js
  Extracts handleWireMessage out of wss.on('connection'). Factory
  pattern: createWireMessageRouter({ session, ws, threadWebSocketHandler,
  emit, checkSettingsBounce }) returns { handleMessage }.
  Chat events (turn_begin, content, thinking, tool_call, tool_result,
  turn_end, status_update) emit to the bus only — no more parallel
  ws.send. Non-chat events (step_begin, request, response, error,
  unknown) stay as direct ws.send via the injected ws.

- NEW: lib/wire/wire-broadcaster.js
  Subscribes to chat:* bus events at startup. For each, routes to the
  client that owns the thread via getClientForThread(threadId) →
  wireRegistry.get(threadId)?.ws. Architectural twin of audit-subscriber.

- MODIFIED: lib/wire/process-manager.js
  - registerWire signature now takes ws: registerWire(threadId, wire,
    projectRoot, ws). wireRegistry entries now carry { wire, projectRoot,
    ws }.
  - New export: getClientForThread(threadId) for the broadcaster.

- MODIFIED: lib/startup.js
  - Initializes the wire broadcaster after audit-subscriber, before
    server.listen() opens the port. Bus subscriptions must be live
    before first connection.

- MODIFIED: server.js
  - Deletes handleWireMessage (270 lines).
  - Adds createWireMessageRouter import + factory call inside
    wss.on('connection'). Replaces the SPEC-01c hoisting dependency
    with explicit factory ordering (message router first, then wire
    lifecycle).
  - Updates 4 registerWire call sites to pass ws.

Behavior change, intentional: bounced tools now emit chat:tool_result
with isError=true and the bounce message, so the broadcaster handles
delivery uniformly. Previously they did a direct ws.send and broke.
From the client's perspective, nothing changes — same wire shape,
same fields. Internal plumbing is just cleaner.

Everything else preserved exactly:
  - checkSettingsBounce atomicity + the break semantics
  - system:tool_bounced emit
  - Non-chat ws.send calls stay inline
  - workspace: 'code-viewer' hardcoding (pre-existing bug, out of scope)
  - global.__agentWireSessions untouched
  - Session closure semantics
  - chat:turn_end shape for audit-subscriber
  - chat:status_update shape for audit-subscriber

server.js: 1178 -> ~880 lines.
```

**Commit only. Do not push.**

---

## Reporting back

When you're done, report:

1. **Actual line counts** — wc -l for all 4 modified + 2 new files.
2. **Verification results** — each of the 18 checks with a one-line result. ✓ or ✗.
3. **Chat round-trip result** — specifically: did the full create-thread → send-message → receive-response loop succeed? If yes, quote the server-live.log lines that prove it (expected: [WireBroadcaster] Started, [WireRegistry] Registered, [Wire] Initializing, [Wire] Message received, and client wire messages flowing). If no, describe the failure mode.
4. **Multi-tab cross-leakage check result** — did tab B receive tab A's chat? (Should be NO.)
5. **Settings bounce test result** — did a bounced tool show `isError: true` with the bounce message in the chat UI?
6. **Audit still persisting?** — did new exchanges land in SQLite with metadata?
7. **Any deviations from the spec** — judgment calls.
8. **Commit hash** — SHA of your commit.
9. **Anything unexpected** — surprising grep hits, subscriber collisions, event ordering issues, session state bleed, per-thread routing edge cases, anything the spec didn't anticipate.

If you encounter a blocker, stop and describe it precisely. Don't attempt a fix unless it's an obvious typo in your own edit. **If the chat round-trip fails, the extraction is not done — stop and report the failure mode.** Most likely causes:
- Session object shared across connections → chat appears in wrong tab (session closure leaked)
- `getClientForThread` returning wrong ws → chat appears in wrong tab (wireRegistry augmentation broke)
- Broadcaster not subscribed → events go nowhere (timing — created inside connect handler instead of startup)
- Missing field in bus event → client receives malformed wire message → console errors
- `handleMessage` closure over stale `session` → content appears in last-connected tab instead of the actual owner

---

## Files you will touch

- `open-robin-server/lib/wire/message-router.js` — **NEW**, ~260 lines
- `open-robin-server/lib/wire/wire-broadcaster.js` — **NEW**, ~90 lines
- `open-robin-server/lib/wire/process-manager.js` — **MODIFIED**, add `ws` param to `registerWire`, add `getClientForThread` helper + export
- `open-robin-server/lib/startup.js` — **MODIFIED**, instantiate broadcaster before listen
- `open-robin-server/server.js` — **MODIFIED**, delete handleWireMessage (270 lines), add factory call, update 4 registerWire call sites, add 1 import
- (no other files)

**Five files total. Two new, three modified. One commit.**

---

## After this SPEC lands

The user and the IDE Claude session verify the work. SPEC-01e (Agent Session Handler extraction) is next — it has the `agentWireSessions` wrinkle flagged in the REFACTOR-LOG. After 01e comes 01f (Client Message Router extraction), which is the last SPEC-01 extraction and depends on everything before it landing cleanly.

Do not start the next one. Stop after SPEC-01d.
