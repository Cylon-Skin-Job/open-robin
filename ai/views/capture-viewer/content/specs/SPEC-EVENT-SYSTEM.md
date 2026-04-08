---
title: Event System Spec — Universal Trigger Bus
created: 2026-03-28
updated: 2026-03-28
status: active
parent: MASTER_SYSTEM_SPEC.md
---

# Event System — Universal Trigger Bus

A markdown-defined event bus that replaces N8N, Zapier, and IFTTT. Built on top of the existing watcher/trigger/cron infrastructure.

---

## What Already Exists

The foundation is built. The event system extends it — it does not replace it.

### Existing Modules

| Module | Path | What it does |
|--------|------|-------------|
| **Watcher** | `lib/watcher/index.js` | Core `fs.watch` with recursive watching, debounce (500ms), rename detection (2s window), pluggable filter chain via `addFilter()` |
| **Filter Loader** | `lib/watcher/filter-loader.js` | Parses YAML frontmatter `.md` files into watcher filters. Glob matching, condition evaluation (`fileStats.tokens > 500`), `{{template}}` variable substitution |
| **Actions** | `lib/watcher/actions.js` | Built-in action handlers: `create-ticket`, `log`, `notify`. Factory pattern via `createActionHandlers(deps)` |
| **Trigger Parser** | `lib/triggers/trigger-parser.js` | Parses TRIGGERS.md files containing multiple `---` delimited YAML blocks |
| **Trigger Loader** | `lib/triggers/trigger-loader.js` | Scans agent folders for TRIGGERS.md, converts blocks to watcher filters (file-change) or cron jobs |
| **Cron Scheduler** | `lib/triggers/cron-scheduler.js` | `daily HH:MM` and 5-field cron syntax. Minute-level checking, condition evaluation, retry with duration (`30m`), double-fire prevention |
| **Script Runner** | `lib/triggers/script-runner.js` | Executes JS scripts referenced in triggers. Clears require cache for hot reload. Return value available as `{{result}}` in templates |
| **Hold Registry** | `lib/triggers/hold-registry.js` | Auto-blocks trigger-created tickets for 9 minutes. Resets timer when same trigger fires again. `onRelease` callback for persona wire notification |
| **Ticket Dispatch** | `lib/tickets/dispatch.js` | Watches issues folder, `shouldDispatch()` with blocking logic, GitLab sync, atomic claim |
| **Wiki Hooks** | `lib/wiki/hooks.js` | Watches wiki tree, rebuilds topics.json, appends to LOG.md, `setOnIndexRebuilt()` callback |
| **Runner** | `lib/runner/index.js` | Run execution, heartbeat monitoring, persona wire notification on completion |

### Existing Patterns (reuse, don't reinvent)

- **YAML frontmatter** for all trigger/filter definitions
- **`{{template_var}}`** and **`{{nested.key}}`** substitution (in `filter-loader.js`)
- **`addFilter()`** pluggable filter chain on the watcher
- **`createActionHandlers(deps)`** factory for injecting dependencies into actions
- **Debounce maps** (500ms rename, 500ms modify)
- **Rename detection** (delete + create within 2s = rename)
- **Context object**: `{ parentDir, type, ext, basename, delta, parentStats, fileStats }`
- **Condition evaluation**: `evaluateCondition(expr, vars)` supports `>`, `<`, `>=`, `<=`, `===`, `!==`
- **Hold registry**: batches rapid-fire triggers, releases after cooldown

### Existing TRIGGERS.md Syntax

Two block types are already supported:

```yaml
---
name: source-file-change
type: file-change
events: [modify, create, delete]
match: "kimi-ide-server/lib/**/*.js"
exclude: ["ai/views/capture-viewer/**"]
condition: "fileStats.tokens > 500"
prompt: WORKFLOW.md
script: ai/scripts/check-sources.js
function: checkSources
message: |
  Source file changed: {{filePath}} ({{event}})
---

---
name: daily-freshness
type: cron
schedule: "daily 09:00"
prompt: PROMPT_02.md
retry: "30m"
condition: "result.staleCount > 0"
message: |
  Scheduled freshness check.
---
```

---

## What Needs to Be Added

The existing system handles **filesystem events** and **cron schedules**. To become a universal event bus, we add new event sources and new action types. The architecture stays the same — TRIGGERS.md blocks, YAML frontmatter, template variables, action handlers.

### New Event Types (add to trigger-parser + trigger-loader)

| Type | Block syntax | Source | New code needed |
|------|-------------|--------|----------------|
| `chat` | `type: chat` | Wire protocol events in server.js | Emit calls in server.js message handler |
| `ticket` | `type: ticket` | Ticket dispatch/close in dispatch.js | Emit calls in dispatch.js |
| `agent` | `type: agent` | Runner lifecycle in runner/index.js | Emit calls in runner |
| `system` | `type: system` | App lifecycle (project switch, session create/evict) | Emit calls in session manager |
| `git` | `type: git` | Git hooks (.git/hooks/) | Shell scripts that call a local endpoint or write to a trigger file |
| `inbound` | `type: inbound` | Signal/Telegram/email/webhook | Robin gateway (future) |
| `os` | `type: os` | AppleScript hooks for Calendar/Reminders | OS bridge module (future) |
| `monitor` | `type: monitor` | HTTP health checks, disk usage | Health monitor module (future) |

### New Action Types (add to actions.js)

| Action | What it does | Dependencies |
|--------|-------------|-------------|
| `send-message` | Auto-send a message to a chat/thread | Wire protocol, session manager |
| `send-signal` | Send Signal message via Robin | Robin gateway |
| `send-telegram` | Send Telegram message via Robin | Robin gateway |
| `send-email` | Send email | Email bridge (AppleScript or SMTP) |
| `webhook-post` | HTTP POST to a URL | `fetch` |
| `drop-file` | Write content to a file path | `fs.writeFile` |
| `pause-workspace` | Suspend all sessions in a workspace | Session manager |
| `resume-workspace` | Resume suspended sessions | Session manager |
| `queue-notification` | Queue a notification for Robin's chat | Robin chat |

### Central Event Emitter

Currently, each module (watcher, dispatch, wiki hooks, runner) handles its own events internally. To support cross-cutting triggers (e.g., "when an agent completes, send a Signal message"), we need a lightweight central emitter that all modules can fire into.

**New file: `lib/event-bus.js`** (~80 lines)

```javascript
const EventEmitter = require('events');
const crypto = require('crypto');

const bus = new EventEmitter();
bus.setMaxListeners(200);

// Chain tracking — links cause to effect across events
let currentChainId = null;
const MAX_CHAIN_DEPTH = 5;
let currentDepth = 0;

// Event ID counter
let eventCounter = 0;

function generateEventId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `evt-${date}-${String(++eventCounter).padStart(4, '0')}`;
}

function generateChainId() {
  return `chain-${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Emit an event with context.
 * chain_id propagates automatically — if this emit was caused by
 * a trigger that was caused by another event, they share the same chain.
 */
function emit(type, data = {}) {
  if (currentDepth >= MAX_CHAIN_DEPTH) {
    console.warn(`[EventBus] Max chain depth (${MAX_CHAIN_DEPTH}), dropping: ${type}`);
    return;
  }

  const event = {
    id: generateEventId(),
    type,
    chain_id: data.chain_id || currentChainId || generateChainId(),
    timestamp: Date.now(),
    ...data,
  };

  const prevChain = currentChainId;
  currentChainId = event.chain_id;  // propagate to downstream emits
  currentDepth++;
  try {
    bus.emit(type, event);
    bus.emit('*', event);
  } finally {
    currentDepth--;
    currentChainId = prevChain;
  }
}

function on(type, handler) {
  bus.on(type, handler);
  return () => bus.off(type, handler);
}

module.exports = { emit, on, bus };
```

### Chain IDs

Every event gets a `chain_id`. When a trigger fires and creates a ticket, the ticket:created event carries the same `chain_id` as the trigger:fired event. When dispatch claims that ticket, same chain. When the runner starts, same chain.

```
chain-a1b2c3:
  trigger:fired       → source-file-change matched secrets.js
  ticket:created      → KIMI-0045 assigned to kimi-wiki
  ticket:claimed      → KIMI-0045 claimed
  agent:run_started   → wiki-manager run began
  agent:run_completed → wiki-manager run succeeded
```

A nightly audit script can trace the full causal chain from a file edit to the final evidence card. Robin's dashboard can show chains visually.

### Integration Points (emit calls to add)

**server.js** (wire protocol handler):
```javascript
const { emit } = require('./lib/event-bus');

// In the wire event handler:
case 'turn_begin':
  emit('chat:turn_begin', { workspace, threadId, turnId });
  break;
case 'turn_end':
  emit('chat:turn_end', { workspace, threadId, turnId, fullText });
  break;
case 'tool_call':
  emit('chat:tool_call', { workspace, threadId, toolName, toolCallId });
  break;
```

**dispatch.js** (ticket lifecycle):
```javascript
const { emit } = require('../event-bus');

// After ticket creation:
emit('ticket:created', { ticketId, title, assignee });

// After dispatch:
emit('ticket:dispatched', { ticketId, agentId });

// After close:
emit('ticket:closed', { ticketId, outcome });
```

**runner/index.js** (agent lifecycle):
```javascript
const { emit } = require('../event-bus');

// Run started:
emit('agent:run_started', { agentId, ticketId, runPath });

// Run completed:
emit('agent:run_completed', { agentId, ticketId, manifest });

// Run failed:
emit('agent:run_failed', { agentId, ticketId, error });
```

**Session manager** (when built):
```javascript
emit('system:session_created', { sessionId, workspace, threadId });
emit('system:session_evicted', { sessionId, reason });
emit('system:project_switched', { from, to });
emit('system:workspace_switched', { from, to });
```

**Trigger lifecycle** (in trigger-loader and event bus):
```javascript
// When trigger-loader registers a trigger from TRIGGERS.md
emit('trigger:registered', { name, type, source_file, agent, workflow });

// When a TRIGGERS.md is deleted or changed (re-registration)
emit('trigger:unregistered', { name, source_file });

// When a trigger's condition matches and it fires
emit('trigger:fired', {
  chain_id,              // links this trigger fire to all downstream effects
  trigger_name,
  trigger_file,
  matched_condition,     // what matched (e.g., "file_modified: secrets.js")
  action,                // what it did (e.g., "create-ticket")
  result,                // outcome (e.g., { ticket_id: "KIMI-0045" })
});
```

### Extended Trigger Loader

The trigger-loader currently only handles `file-change` and `cron` types. Extend it to register listeners on the event bus for new types:

```javascript
// In loadTriggers(), after the existing file-change/cron handling:

if (block.type === 'chat') {
  const eventType = `chat:${block.event}`; // e.g., 'chat:turn_end'
  registerBusListener(eventType, block, botName, actionHandlers);
}

if (block.type === 'ticket') {
  const eventType = `ticket:${block.event}`;
  registerBusListener(eventType, block, botName, actionHandlers);
}

if (block.type === 'agent') {
  const eventType = `agent:${block.event}`;
  registerBusListener(eventType, block, botName, actionHandlers);
}

// etc.
```

Where `registerBusListener` subscribes to the event bus and executes actions when the event matches filters:

```javascript
function registerBusListener(eventType, block, assignee, actionHandlers) {
  const { on } = require('../event-bus');

  on(eventType, (event) => {
    // Check workspace filter
    if (block.workspace && event.workspace !== block.workspace) return;

    // Check condition
    if (block.condition && !evaluateCondition(block.condition, event)) return;

    // Build vars from event data
    const vars = { ...event, assignee };

    // Execute action
    const action = block.action || 'create-ticket';
    const handler = actionHandlers[action];
    if (handler) handler(block, vars);
  });
}
```

---

## Extended TRIGGERS.md Syntax

All existing syntax remains valid. New block types follow the same pattern:

### Chat Triggers

```yaml
---
name: review-on-turn-end
type: chat
event: turn_end
workspace: code
action: create-ticket
ticket:
  title: "Review: {{thread.name}}"
  assignee: kimi-review
  body: "Auto-review triggered after chat turn in code workspace."
---
```

### Ticket Triggers

```yaml
---
name: notify-on-ticket-close
type: ticket
event: closed
action: send-signal
message: "Ticket closed: {{ticket.title}} ({{ticket.id}})"
---
```

### Agent Triggers

```yaml
---
name: report-on-run-complete
type: agent
event: run_completed
action: send-email
email:
  to: team@company.com
  subject: "Agent completed: {{agent.name}}"
  body: "{{agent.name}} finished ticket {{ticket.title}}."
---

---
name: alert-on-run-failure
type: agent
event: run_failed
action: send-signal
message: "Agent failed: {{agent.name}} on {{ticket.title}}"
---
```

### System Triggers

```yaml
---
name: pause-on-project-switch
type: system
event: project_switched
action: log
message: "Switched from {{from}} to {{to}}"
---
```

### Chained Actions (trigger produces event)

```yaml
---
name: wiki-update-chain
type: file-change
events: [modify]
match: "kimi-ide-server/lib/**/*.js"
action: create-ticket
ticket:
  title: "Verify wiki: {{basename}}"
  assignee: kimi-wiki
  body: "Source file {{filePath}} was modified."
---
```

When this creates a ticket, dispatch.js emits `ticket:created`, which can trigger another TRIGGERS.md block listening for `type: ticket, event: created`.

### External Triggers (future — Robin gateway)

```yaml
---
name: github-email-to-ticket
type: inbound
event: email_received
filter:
  from: "*@github.com"
action: create-ticket
ticket:
  title: "GitHub: {{subject}}"
  assignee: human
  body: "{{body}}"
---

---
name: signal-status-check
type: inbound
event: signal_message
filter:
  contains: "status"
action: send-message
target: robin
message: "Checking project status..."
---
```

### OS Triggers (future — AppleScript bridge)

```yaml
---
name: meeting-reminder
type: os
event: calendar_event
filter:
  offset: 15min-before
action: send-signal
message: "Meeting in 15: {{event.title}}"
---
```

### Monitoring Triggers (future — health checks)

```yaml
---
name: site-down-alert
type: monitor
event: endpoint_health
filter:
  url: "https://myapp.com"
  status: "!200"
action: send-signal
message: "Site down: {{url}} returned {{status}}"
---
```

### Conditional Triggers

```yaml
---
name: smart-flush
type: system
event: workspace_switched
condition: "idle_time > 7200"
action: log
message: "Workspace {{from}} idle for 2h+, consider flushing"
---
```

---

## Template Variables

All existing variables from filter-loader remain. New variables added per event type:

### Filesystem (existing)
`{{filePath}}`, `{{basename}}`, `{{ext}}`, `{{parentDir}}`, `{{delta}}`, `{{event}}`, `{{parentStats.files}}`, `{{parentStats.folders}}`, `{{fileStats.tokens}}`, `{{fileStats.lines}}`, `{{fileStats.words}}`, `{{fileStats.size}}`, `{{newPath}}`, `{{oldPath}}`

### Chat (new)
`{{workspace}}`, `{{threadId}}`, `{{thread.name}}`, `{{turnId}}`, `{{fullText}}`, `{{toolName}}`, `{{toolCallId}}`

### Ticket (new)
`{{ticket.id}}`, `{{ticket.title}}`, `{{ticket.assignee}}`, `{{ticket.state}}`, `{{outcome}}`

### Agent (new)
`{{agent.name}}`, `{{agent.id}}`, `{{ticket.id}}`, `{{ticket.title}}`, `{{runPath}}`, `{{error}}`

### System (new)
`{{from}}`, `{{to}}`, `{{sessionId}}`, `{{workspace}}`, `{{reason}}`

### Inbound (future)
`{{sender}}`, `{{subject}}`, `{{body}}`, `{{endpoint}}`, `{{method}}`

### OS (future)
`{{event.title}}`, `{{event.time}}`, `{{reminder.title}}`

### Monitor (future)
`{{url}}`, `{{status}}`, `{{response_time}}`, `{{domain}}`, `{{days_remaining}}`, `{{metric}}`, `{{value}}`, `{{threshold}}`

### Script Results (existing)
`{{result}}`, `{{result.fieldName}}` — from script-runner.js return values

---

## Session Idle Timer (resolves Thread #1)

The idle timer resets on any of these events scoped to the session:
- `chat:message_send` (user typed something)
- `chat:message_end` (agent finished responding)
- `chat:turn_end` (full turn completed)

A cron-triggered `send-message` action counts as a `chat:message_send`, which resets the idle timer. This is intentional — if you set up a cron, you want that session warm. RAM pressure valve overrides if needed.

---

## Loop Prevention

Actions can produce events, and events can trigger actions. To prevent infinite loops:

1. **Max chain depth**: 5 (configurable). If an event was triggered by an action that was triggered by an event... and we're 5 deep, stop.
2. **Cooldown per trigger**: A trigger that fired cannot fire again within its hold period (existing hold-registry handles this for file-change triggers; extend to all types).
3. **Same-event suppression**: If an action produces the exact same event type + data that triggered it, suppress.

---

## Implementation Order

### Phase 1: Event Bus Core (minimal)
1. Create `lib/event-bus.js` (emit, on, bus)
2. Add emit calls to server.js wire handler (`chat:turn_begin`, `chat:turn_end`, `chat:tool_call`)
3. Extend trigger-loader to register `type: chat` blocks on the event bus
4. Test: TRIGGERS.md with `type: chat, event: turn_end` creates a ticket

### Phase 2: Ticket + Agent Events
1. Add emit calls to dispatch.js (`ticket:created`, `ticket:closed`)
2. Add emit calls to runner (`agent:run_started`, `agent:run_completed`, `agent:run_failed`)
3. Extend trigger-loader for `type: ticket` and `type: agent` blocks
4. Test: agent completing a run fires a trigger that creates a follow-up ticket

### Phase 3: New Action Types
1. Add `send-message` action (auto-send to a chat — this enables crons on any chat)
2. Add `webhook-post` action
3. Add `drop-file` action
4. Extend `createActionHandlers(deps)` factory to accept new dependencies

### Phase 4: System Events
1. Build session manager events (`session_created`, `session_evicted`, `project_switched`)
2. Add `pause-workspace` and `resume-workspace` actions
3. Wire into resource management policy

### Phase 5: External Bridges (future)
1. Robin gateway: Signal/Telegram inbound -> emit `inbound:signal_message`
2. Email bridge: AppleScript or SMTP -> emit `inbound:email_received`
3. Webhook receiver: HTTP endpoint -> emit `inbound:webhook_received`
4. OS hooks: AppleScript bridge for Calendar/Reminders

---

## System Event Log

The event bus fires events in-memory. The system event log **persists** them to disk so nightly audits and background agents can query "what happened since X."

### Location

`ai/system/event-log.json` — append-only, rotated nightly.

```json
{
  "events": [
    {
      "id": "evt-20260328-001",
      "type": "agent:run_completed",
      "timestamp": "2026-03-28T14:35:42Z",
      "data": { "runId": "...", "agentId": "wiki-manager", "ticketId": "KIMI-0042", "outcome": "success" }
    },
    {
      "id": "evt-20260328-002",
      "type": "ticket:closed",
      "timestamp": "2026-03-28T14:35:43Z",
      "data": { "ticketId": "KIMI-0042" }
    }
  ]
}
```

### How It's Written

The event bus has a built-in listener that appends every event to the log:

```javascript
on('*', (event) => {
  appendToEventLog(event);
});
```

Not every event needs logging. Filter by domain — log `agent:*`, `ticket:*`, `chat:turn_end`, file changes. Skip high-frequency noise like `chat:content` (individual token streams).

### How Agents Use It

Agents never read the event log directly. **Triggers + scripts do the diffing.** The agent just sees a clean list of what's new.

```
TRIGGERS.md fires (cron at 2am)
    ↓
Script: compare last_checked in workflow ledger vs event log
    ↓
Script returns: array of new events since last check
    ↓
Agent receives: "5 new events: 2 file changes, 1 run, 2 tickets"
    ↓
Agent reasons about it (summarize, flag issues, propagate to ticket)
    ↓
Script updates last_checked
```

The agent never queries the DB. The agent never parses the event log. The script does the index comparison. The agent does the thinking.

### Rotation

Nightly audit agent archives the event log after processing:
- Rename `event-log.json` → `event-log-2026-03-28.json`
- Start fresh `event-log.json`
- Old logs can be archived to SQLite if they grow large

---

## Run Ledger System

Every agent run is tracked in layered ledgers for audit trail and nightly analysis.

### Ledger Cascade

```
agents/{agentName}/
  runs/
    ledger.json                          ← ALL runs for this agent
    {Workflow Name}/
      ledger.json                        ← runs for this workflow only
      {timestamp}/
        SESSION.md                       ← duped from workflow, created_at stamped
        ticket.md                        ← frozen ticket
        WORKFLOW.md                      ← frozen workflow instructions
        LESSONS.md                       ← frozen lessons
        manifest.json                    ← status machine
        evidence/
          00-validate.md                 ← certificate cards (proof of work)
          01-gather.md
          02-propose.md
```

### Agent Ledger (`runs/ledger.json`)

All runs across all workflows:

```json
{
  "last_checked": "2026-03-28T02:00:00Z",
  "runs": [
    {
      "run_id": "2026-03-28T14-32-15",
      "workflow": "Wiki Update",
      "ticket_id": "KIMI-0042",
      "status": "completed",
      "outcome": "success",
      "started": "2026-03-28T14:32:16Z",
      "completed": "2026-03-28T14:35:42Z",
      "evidence_count": 4
    }
  ]
}
```

### Workflow Ledger (`runs/{Workflow Name}/ledger.json`)

Same shape, filtered to one workflow. `last_checked` is per-workflow so nightly audits can track "what's new for this workflow since last audit."

### SESSION.md in Run Folder

When a run starts, SESSION.md is duped from the workflow and stamped with `created_at`:

```yaml
---
thread-model: single-persistent
system-context: ["PROMPT.md", "MEMORY.md"]
created_at: 2026-03-28T14:32:15Z
cli: kimi
profile: default
---
```

The next run can check its own `created_at` to know when it was born. The nightly audit checks `ledger.json` entries against `last_checked`.

### Nightly Audit Pattern

```yaml
# In agent's TRIGGERS.md
---
name: nightly-audit
type: cron
schedule: "daily 02:00"
script: ai/system/skills/audit-diff.js
function: getNewEvents
prompt: PROMPT_AUDIT.md
message: |
  Nightly audit. New events since last check:
  {{result.summary}}

  Details:
  {{result.events}}
---
```

The `audit-diff.js` script:
1. Reads `runs/ledger.json` → gets `last_checked`
2. Reads `ai/system/event-log.json` → filters events since `last_checked`
3. Returns structured summary to the agent
4. Updates `last_checked` after the agent processes it

The agent receives a clean list. It decides: summarize, flag anomalies, propagate findings to open tickets as comments (which sync to GitLab). **Scripts do plumbing. Agents do thinking.**

### Propagating to Tickets

The agent can include ticket updates in its output. The runner parses these signals:

```
TICKET_COMMENT: KIMI-0042 "Nightly audit: 3 wiki pages updated, all sources verified."
```

The runner creates the comment locally, sync pushes it to GitLab. Collaborators see audit results right on the ticket.

---

## Design Principles

1. **Build on what exists.** The watcher, filter-loader, trigger-parser, cron-scheduler, and actions are the foundation. Extend, don't replace.
2. **Same syntax everywhere.** New event types use the same TRIGGERS.md YAML block format.
3. **Same template system.** `{{var}}` and `{{nested.var}}` — already implemented in filter-loader.
4. **Same action factory.** `createActionHandlers(deps)` — add new actions alongside existing ones.
5. **TRIGGERS.md is the interface.** Robin helps you write them. No GUI automation builder.
6. **Local-first.** Everything runs on your machine. External actions are explicit opt-in.

---

## Open Questions (tracked in THREADS.md #26-32)

- Event object schema standardization across all types
- Which actions ship built-in vs require a user script
- Rate limiting and loop prevention details
- Conditional logic depth in TRIGGERS.md
- Error handling for failed actions
- OS hook discovery mechanism
- Privacy boundary for external actions
