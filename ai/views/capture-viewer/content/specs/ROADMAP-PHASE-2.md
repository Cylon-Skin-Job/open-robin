---
title: Phase 2 — Event Bus Core
created: 2026-03-28
status: active
parent: ROADMAP.md
---

# Phase 2: Event Bus Core

Central event emitter that all modules fire into. Extend trigger-loader for new event types. Add new action types.

**Prerequisites:** None. Can start immediately (builds on existing watcher/trigger infrastructure).
**Parallel with:** Phase 0 and Phase 1 (no dependencies between them).

---

## Context for This Session

### Project Location
`/Users/rccurtrightjr./projects/kimi-claude`

### What This Phase Does
1. Create `lib/event-bus.js` — central pub/sub (~60 lines)
2. Add emit() calls to server.js (6 chat events), dispatch.js (4 ticket events), runner/index.js (4 agent events)
3. Extend trigger-loader.js to handle `type: chat`, `type: ticket`, `type: agent`, `type: system` blocks in TRIGGERS.md
4. Add new action types: `send-message`, `webhook-post`, `drop-file`
5. Loop prevention: chain depth limit + same-event suppression

### Key Architecture Decisions (already made)
- **Event bus is additive** — one emit() line after each existing ws.send() or console.log(). Does not replace direct module calls. The bus is for user-defined automations via TRIGGERS.md.
- **Same TRIGGERS.md syntax** — new event types use the same YAML block format as existing file-change and cron triggers.
- **Same action factory** — `createActionHandlers(deps)` in actions.js. New actions added alongside existing ones.
- **send-message Phase 2 = active sessions only** — if the target chat has no active session, the message is queued. Session spawning for suspended chats comes in Phase 4.
- **Crons are tickets** — repeating crons generate tickets via TRIGGERS.md. One-shot delayed tasks are tickets with `fires-at`. Cron-chat sends gray system messages.

### Existing Infrastructure (already built)
- `lib/watcher/index.js` — fs.watch, debounce, rename detection, pluggable filters
- `lib/watcher/filter-loader.js` — YAML frontmatter parser, glob matching, condition evaluation, template vars
- `lib/watcher/actions.js` — create-ticket, log, notify actions
- `lib/triggers/trigger-parser.js` — parses multi-block TRIGGERS.md
- `lib/triggers/trigger-loader.js` — scans agents, builds filters + cron jobs
- `lib/triggers/cron-scheduler.js` — daily/cron syntax, condition eval, retry
- `lib/triggers/hold-registry.js` — 9-min auto-block batching
- `lib/triggers/script-runner.js` — executes referenced scripts
- `lib/tickets/dispatch.js` — watches issues/, claiming, blocking, GitLab sync
- `lib/runner/index.js` — run execution, heartbeat, completion handling

---

## 2.1 Create Event Bus

New file: `kimi-ide-server/lib/event-bus.js` (~60 lines)

```javascript
const EventEmitter = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(200);

// Chain depth tracking for loop prevention
const MAX_CHAIN_DEPTH = 5;
let currentDepth = 0;

function emit(type, data = {}) {
  if (currentDepth >= MAX_CHAIN_DEPTH) {
    console.warn(`[EventBus] Max chain depth (${MAX_CHAIN_DEPTH}) reached, dropping: ${type}`);
    return;
  }

  const event = { type, timestamp: Date.now(), ...data };
  currentDepth++;
  try {
    bus.emit(type, event);
    bus.emit('*', event);  // wildcard listeners
  } finally {
    currentDepth--;
  }
}

function on(type, handler) {
  bus.on(type, handler);
  return () => bus.off(type, handler);
}

module.exports = { emit, on, bus };
```

### Steps
- [ ] Create `lib/event-bus.js`
- [ ] Export `emit(type, data)` and `on(type, handler)`
- [ ] Chain depth tracking with MAX_CHAIN_DEPTH = 5
- [ ] Wildcard `*` listener support
- [ ] Verify: emit fires, on receives, depth limit works

---

## 2.2 Add Emit Calls to server.js

Wire protocol events emitted from the existing message handler. These are **additive** — one `emit()` line after each existing `ws.send()`.

### Insertion Points

| Event | server.js Lines | After | Emit Call |
|-------|----------------|-------|-----------|
| `chat:turn_begin` | 628-631 | `ws.send(turn_begin)` | `emit('chat:turn_begin', { workspace: panelId, threadId, turnId, userInput })` |
| `chat:content` | 649-653 | `ws.send(content)` | `emit('chat:content', { workspace: panelId, threadId, turnId, text })` |
| `chat:thinking` | 665-669 | `ws.send(thinking)` | `emit('chat:thinking', { workspace: panelId, threadId, turnId, text })` |
| `chat:tool_call` | 689-694 | `ws.send(tool_call)` | `emit('chat:tool_call', { workspace: panelId, threadId, turnId, toolName, toolCallId })` |
| `chat:tool_result` | 724-732 | `ws.send(tool_result)` | `emit('chat:tool_result', { workspace: panelId, threadId, turnId, toolCallId, toolName, isError })` |
| `chat:turn_end` | 759-764 | `ws.send(turn_end)` | `emit('chat:turn_end', { workspace: panelId, threadId, turnId, fullText, hasToolCalls })` |

### Implementation

Add one line at the top of server.js:
```javascript
const { emit } = require('./lib/event-bus');
```

Then after each `ws.send()` block, add the corresponding `emit()` call. Example:

```javascript
// Existing code (line 759-764):
ws.send(JSON.stringify({
  type: 'turn_end',
  turnId: session.currentTurn.id,
  fullText: session.currentTurn.text,
  hasToolCalls: session.hasToolCalls
}));

// Add after:
emit('chat:turn_end', {
  workspace: wsState.get(ws)?.panelId,
  threadId: wsState.get(ws)?.threadId,
  turnId: session.currentTurn.id,
  fullText: session.currentTurn.text,
  hasToolCalls: session.hasToolCalls
});
```

### Steps
- [ ] Add `require('./lib/event-bus')` to server.js
- [ ] Add emit call after each of 6 wire event handlers
- [ ] Include workspace (panelId) and threadId in all emits for scoping
- [ ] Verify: events fire during a normal chat turn (console.log listener)

---

## 2.3 Add Emit Calls to dispatch.js

Ticket lifecycle events.

### Insertion Points

| Event | dispatch.js Lines | After | Emit Call |
|-------|-------------------|-------|-----------|
| `ticket:claimed` | 54 | `console.log('Claimed')` | `emit('ticket:claimed', { ticketId, assignee, state: 'claimed' })` |
| `ticket:dispatched` | 148 | `console.log('Agent:')` | `emit('ticket:dispatched', { ticketId, assignee, agentFolder })` |
| `ticket:released` | 79 | `console.log('Released')` | `emit('ticket:released', { ticketId, state: 'open' })` |

### Ticket Closed Detection

Ticket closing happens in two places:
1. **Runner completes** → updates ticket file → dispatch watcher sees change → but state is 'closed' so it skips
2. **sync/pull.js** pulls closed state from GitLab → updates local file

Add emit in both paths:
- [ ] In runner completion handler (runner/index.js line ~95): `emit('ticket:closed', { ticketId, outcome })`
- [ ] In pull.js when a ticket transitions to closed: `emit('ticket:closed', { ticketId, source: 'gitlab' })`

### Steps
- [ ] Add `require('../event-bus')` to dispatch.js
- [ ] Add 3 emit calls (claimed, dispatched, released)
- [ ] Add `require('../event-bus')` to runner/index.js
- [ ] Add emit calls for run lifecycle (started, completed, failed, stalled)
- [ ] Add `require('../event-bus')` to sync/pull.js
- [ ] Add emit for ticket closed from GitLab sync
- [ ] Verify: dispatch a test ticket, see events fire

---

## 2.4 Add Emit Calls to runner/index.js

Agent run lifecycle events.

### Insertion Points

| Event | runner/index.js Lines | After | Emit Call |
|-------|----------------------|-------|-----------|
| `agent:run_started` | 210-214 | `console.log('Run started')` | `emit('agent:run_started', { runId, agentId, ticketId, botName })` |
| `agent:run_completed` | 80 | `console.log('Run finished')` when code === 0 | `emit('agent:run_completed', { runId, agentId, ticketId, status: 'completed', outcome: 'success' })` |
| `agent:run_failed` | 80 | `console.log('Run finished')` when code !== 0 | `emit('agent:run_failed', { runId, agentId, ticketId, status: 'stopped', error })` |
| `agent:run_stalled` | 243 | `console.log('Killed stalled')` | `emit('agent:run_stalled', { runId, agentId, stallCount })` |
| `agent:run_nudged` | 233 | `console.log('Nudging')` | `emit('agent:run_nudged', { runId, agentId, stallCount })` (optional) |

### Steps
- [ ] Add `require('../event-bus')` to runner/index.js
- [ ] Add 4-5 emit calls at the identified insertion points
- [ ] Verify: mock a run lifecycle, see events fire

---

## 2.5 Extend Trigger Loader for New Event Types

Currently `trigger-loader.js` handles `type: file-change` (converts to watcher filter) and `type: cron` (registers with cron-scheduler). Extend to handle `type: chat`, `type: ticket`, `type: agent`.

### New Function: registerBusListener()

Add to `trigger-loader.js`:

```javascript
const { on } = require('../event-bus');

function registerBusListener(eventType, block, assignee, actionHandlers) {
  on(eventType, (event) => {
    // Workspace filter
    if (block.workspace && event.workspace !== block.workspace) return;

    // Condition check
    if (block.condition && !evaluateCondition(block.condition, event)) return;

    // Build template vars from event data
    const vars = {
      ...event,
      assignee,
      filePath: event.filePath || '',
      basename: event.basename || '',
    };

    // Execute action
    const action = block.action || 'create-ticket';
    const handler = actionHandlers[action];
    if (handler) {
      handler(block, vars);
    } else {
      console.warn(`[TriggerLoader] Unknown action: ${action}`);
    }
  });

  console.log(`[TriggerLoader] Bus listener: ${block.name} on ${eventType} → ${assignee}`);
}
```

### Extend loadTriggers()

In the existing loop over trigger blocks, add cases:

```javascript
for (const block of blocks) {
  if (block.type === 'cron') {
    cronTriggers.push({ trigger: block, assignee: botName });
  } else if (block.type === 'chat') {
    registerBusListener(`chat:${block.event}`, block, botName, actionHandlers);
  } else if (block.type === 'ticket') {
    registerBusListener(`ticket:${block.event}`, block, botName, actionHandlers);
  } else if (block.type === 'agent') {
    registerBusListener(`agent:${block.event}`, block, botName, actionHandlers);
  } else if (block.type === 'system') {
    registerBusListener(`system:${block.event}`, block, botName, actionHandlers);
  } else {
    // Default: file-change trigger
    const filter = buildTriggerFilter(block, botName, projectRoot, actionHandlers);
    if (filter) filters.push(filter);
  }
}
```

### Steps
- [ ] Add `registerBusListener()` to trigger-loader.js
- [ ] Add chat/ticket/agent/system cases in the loadTriggers loop
- [ ] Verify: add a `type: chat, event: turn_end` block to wiki-manager TRIGGERS.md
- [ ] Verify: send a chat message, see the trigger fire and create a ticket

---

## 2.6 New Action Types

Extend `createActionHandlers()` in `lib/watcher/actions.js` with new actions.

### send-message

Auto-send a message to a chat. This is the foundation for crons-on-chat.

```javascript
'send-message'(def, vars) {
  // Requires: target chat workspace + thread resolution
  // For now: emit a WebSocket message to the target panel's active thread
  const target = def.target || vars.workspace;
  const message = applyTemplate(def.message || '', vars);
  const role = def.role || 'system';  // gray system message

  // Find the WebSocket connection for this panel
  // Send: { type: 'system_message', content: message, role }
  console.log(`[Action:send-message] → ${target}: ${message}`);

  if (deps.sendChatMessage) {
    deps.sendChatMessage(target, message, role);
  }
}
```

### webhook-post

HTTP POST to an external URL.

```javascript
'webhook-post'(def, vars) {
  const url = applyTemplate(def.url || '', vars);
  const body = applyTemplate(def.body || JSON.stringify(vars), vars);

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  }).then(res => {
    console.log(`[Action:webhook-post] ${url} → ${res.status}`);
  }).catch(err => {
    console.error(`[Action:webhook-post] ${url} failed: ${err.message}`);
  });
}
```

### drop-file

Write content to a file path.

```javascript
'drop-file'(def, vars) {
  const filePath = applyTemplate(def.path || '', vars);
  const content = applyTemplate(def.content || '', vars);

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`[Action:drop-file] ${filePath}`);
}
```

### Steps
- [ ] Add `send-message` action to actions.js
- [ ] Add `sendChatMessage` dependency to `createActionHandlers(deps)`
- [ ] Implement `sendChatMessage` in server.js (find WS for panel, send system_message)
- [ ] Add `webhook-post` action
- [ ] Add `drop-file` action
- [ ] Verify: TRIGGERS.md with `action: send-message` sends a gray message to a chat
- [ ] Verify: TRIGGERS.md with `action: webhook-post` makes an HTTP call

---

## 2.7 Loop Prevention

### Already Built
- Hold registry batches rapid-fire file-change triggers (9-minute cooldown)
- Same trigger won't create duplicate tickets within the hold window

### New: Chain Depth
- Event bus tracks `currentDepth` (implemented in 2.1)
- Max depth 5: if an action's emit triggers another action which triggers another... stops at 5

### New: Same-Event Suppression
- If an action produces an event with the same type AND same key data (e.g., same ticketId) as the event that triggered it, suppress

```javascript
// Track last N events for suppression
const recentEvents = [];
const MAX_RECENT = 50;

function isDuplicate(type, data, triggerEvent) {
  if (!triggerEvent) return false;
  if (type !== triggerEvent.type) return false;
  // Compare key fields (ticketId, threadId, etc.)
  const key = data.ticketId || data.threadId || data.runId;
  const triggerKey = triggerEvent.ticketId || triggerEvent.threadId || triggerEvent.runId;
  return key && key === triggerKey;
}
```

### Steps
- [ ] Chain depth tracking in event-bus.js (done in 2.1)
- [ ] Same-event suppression check before emit
- [ ] Extend hold-registry pattern: all event types, not just file-change
- [ ] Verify: create a trigger chain, confirm it stops at depth 5
- [ ] Verify: a trigger that would create the same event that triggered it gets suppressed

---

## Issues / Discussion Points

### send-message and Session Management
`send-message` needs to send to a chat that may not have an active session. Options:
1. **If session is active**: send directly via WebSocket
2. **If session is suspended**: spawn a new wire process, send the message, let it respond, then idle-timeout as normal
3. **If no session exists**: create a thread, spawn wire, send message

Option 2 is the most useful — crons should be able to wake up a sleeping agent. But it adds complexity. For Phase 2, implement option 1 only (send to active sessions). Phase 4 can add session spawning.

### Event Payload Size
Chat events include `fullText` on `turn_end`. For long conversations this could be large. The event bus is in-memory only (no persistence), so this is fine — events are ephemeral. But keep payloads reasonable. Don't include full tool results in `tool_result` events — just the metadata.

### Event Bus vs Direct Calls
Some modules already call each other directly (dispatch calls runner, runner calls sync). The event bus doesn't replace these calls — it adds a parallel notification channel for TRIGGERS.md-defined reactions. The direct calls remain for core flow. The event bus is for user-defined automations.

### Testing Strategy
The event bus is hard to test in isolation because it depends on the full server running. Approach:
1. Unit test event-bus.js (emit, on, depth limit, suppression)
2. Integration test: add a test TRIGGERS.md, start server, trigger an event, verify action fires
3. Manual test: watch console.log output during normal chat usage

---

## Completion Criteria

- [ ] `lib/event-bus.js` created with emit, on, chain depth, suppression
- [ ] server.js emits 6 chat events on every turn
- [ ] dispatch.js emits ticket lifecycle events (claimed, dispatched, released, closed)
- [ ] runner/index.js emits agent run events (started, completed, failed, stalled)
- [ ] trigger-loader.js handles `type: chat`, `type: ticket`, `type: agent`, `type: system`
- [ ] `send-message`, `webhook-post`, `drop-file` actions available
- [ ] Loop prevention: chain depth limit + same-event suppression
- [ ] End-to-end: a TRIGGERS.md `type: chat, event: turn_end` block creates a ticket on chat completion
