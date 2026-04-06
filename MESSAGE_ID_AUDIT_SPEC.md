# Message ID & Plan Mode Audit Spec

## Overview

Capture `message_id` and `plan_mode` from wire StatusUpdate events for audit trails, debugging, and API correlation.

---

## Wire Protocol

**StatusUpdate payload from wire:**
```json
{
  "jsonrpc": "2.0",
  "method": "event",
  "params": {
    "type": "StatusUpdate",
    "payload": {
      "context_usage": 0.057373046875,
      "context_tokens": 15040,
      "max_context_tokens": 262144,
      "token_usage": { ... },
      "message_id": "chatcmpl-iVx7h2vVqfKBlnqrq5iaO2TM",
      "plan_mode": false
    }
  }
}
```

**Fields to capture:**
| Field | Type | Example | Purpose |
|-------|------|---------|---------|
| `message_id` | string | `chatcmpl-iVx7h2vVqfKBlnqrq5iaO2TM` | OpenAI completion ID - correlates to API logs |
| `plan_mode` | boolean | `false` | Whether the turn was in plan mode |

---

## Current State (NOT Captured)

**Server handler** (`server.js:941-947`) - currently ignores these fields:
```javascript
case 'StatusUpdate':
  ws.send(JSON.stringify({
    type: 'status_update',
    contextUsage: payload?.context_usage,
    tokenUsage: payload?.token_usage
    // ❌ message_id NOT included
    // ❌ plan_mode NOT included
  }));
  break;
```

---

## Implementation Plan

### Phase 1: Server - Track in Session

**File:** `server.js`

Add session tracking for latest message metadata:

```javascript
// In StatusUpdate handler (around line 941)
case 'StatusUpdate':
  // Track for persistence at turn end
  session.messageId = payload?.message_id;
  session.planMode = payload?.plan_mode;
  session.contextUsage = payload?.context_usage;
  session.tokenUsage = payload?.token_usage;
  
  ws.send(JSON.stringify({
    type: 'status_update',
    contextUsage: payload?.context_usage,
    tokenUsage: payload?.token_usage
  }));
  break;
```

### Phase 2: Server - Pass to Storage

**File:** `server.js` - TurnEnd handler (around line 901-921)

Update the exchange saving to include message metadata:

```javascript
case 'TurnEnd':
  if (session.currentTurn) {
    // Save assistant message to CHAT.md
    ThreadWebSocketHandler.addAssistantMessage(
      ws,
      session.currentTurn.text,
      session.hasToolCalls
    );
    
    // Save rich exchange to SQLite with metadata
    const threadId = session.currentThreadId;
    if (threadId) {
      const historyFile = new HistoryFile(threadId);
      historyFile.addExchange(
        threadId,
        session.currentTurn.userInput,
        session.assistantParts,
        {
          // Audit metadata
          messageId: session.messageId,
          planMode: session.planMode,
          contextUsage: session.contextUsage,
          tokenUsage: session.tokenUsage,
          capturedAt: Date.now()
        }
      ).catch(err => {
        console.error('[History] Failed to save exchange:', err);
      });
    }
    
    // ... rest of TurnEnd handling
  }
  break;
```

### Phase 3: SQLite Storage

**File:** `HistoryFile.js` - Update `addExchange()` method

```javascript
/**
 * Add a complete exchange with audit metadata.
 * @param {string} threadId
 * @param {string} userInput
 * @param {Array} parts - Assistant response parts
 * @param {Object} auditMeta - Message metadata from wire
 * @returns {Promise<object>} Exchange object
 */
async addExchange(threadId, userInput, parts, auditMeta = {}) {
  const db = getDb();
  const seq = (await this.countExchanges()) + 1;
  const ts = Date.now();
  const assistant = JSON.stringify({ parts: parts.map((p) => ({ ...p })) });

  // Build metadata object with audit fields
  const metadata = JSON.stringify({
    // Wire-provided fields
    messageId: auditMeta.messageId || null,
    planMode: auditMeta.planMode || false,
    contextUsage: auditMeta.contextUsage || 0,
    tokenUsage: auditMeta.tokenUsage || null,
    
    // Server-added fields
    capturedAt: auditMeta.capturedAt || ts,
    savedAt: ts
  });

  await db('exchanges').insert({
    thread_id: threadId,
    seq,
    ts,
    user_input: userInput,
    assistant,
    metadata,  // Now contains messageId, planMode, etc.
  });

  return {
    seq,
    ts,
    user: userInput,
    assistant: { parts: parts.map((p) => ({ ...p })) },
    metadata: JSON.parse(metadata),
  };
}
```

**File:** `HistoryFile.js` - Update `_toExchange()` method

```javascript
_toExchange(row) {
  return {
    seq: row.seq,
    ts: row.ts,
    user: row.user_input,
    assistant: JSON.parse(row.assistant),
    metadata: JSON.parse(row.metadata || '{}'),  // Changed from '[]' to '{}'
  };
}
```

### Phase 4: CHAT.md Storage

**File:** `ChatFile.js` - Update `serialize()` method

Add metadata comment after each exchange:

```javascript
serialize(title, messages, metadataMap = {}) {
  const lines = [`# ${title}`, ''];
  let msgIndex = 0;

  for (const msg of messages) {
    lines.push(msg.role === 'user' ? 'User' : 'Assistant');
    lines.push('');
    lines.push(msg.content);
    lines.push('');

    if (msg.hasToolCalls) {
      lines.push(TOOL_CALL_MARKER);
      lines.push('');
    }
    
    // Add audit metadata comment after assistant messages
    if (msg.role === 'assistant' && metadataMap[msgIndex]) {
      const meta = metadataMap[msgIndex];
      const metaComment = `<!-- audit: ${JSON.stringify({
        messageId: meta.messageId,
        planMode: meta.planMode,
        contextUsage: meta.contextUsage,
        capturedAt: meta.capturedAt
      })} -->`;
      lines.push(metaComment);
      lines.push('');
    }
    
    msgIndex++;
  }

  return lines.join('\n');
}
```

### Phase 5: ThreadWebSocketHandler Integration

**File:** `ThreadWebSocketHandler.js` - Update `addAssistantMessage()`

```javascript
async function addAssistantMessage(ws, content, hasToolCalls = false, auditMeta = {}) {
  const state = wsState.get(ws);
  if (!state || !state.threadId) return;
  
  const { threadManager, threadId } = state;
  
  await threadManager.addMessage(threadId, {
    role: 'assistant',
    content,
    hasToolCalls,
    auditMeta  // Pass through for CHAT.md
  });
}
```

---

## Storage Schema

### SQLite `exchanges.metadata` JSON Structure

```json
{
  "messageId": "chatcmpl-iVx7h2vVqfKBlnqrq5iaO2TM",
  "planMode": false,
  "contextUsage": 0.057373046875,
  "tokenUsage": {
    "input_other": 9920,
    "output": 307,
    "input_cache_read": 5120,
    "input_cache_creation": 0
  },
  "capturedAt": 1712345678901,
  "savedAt": 1712345678950
}
```

### CHAT.md Format

```markdown
# Thread Title

User

Hello, I need help with something

Assistant

I'll help you with that...

**TOOL CALL(S)**

<!-- audit: {"messageId":"chatcmpl-abc123","planMode":false,"contextUsage":0.057,"capturedAt":1712345678901} -->

User

Thanks, that's helpful

Assistant

You're welcome!

<!-- audit: {"messageId":"chatcmpl-def456","planMode":false,"contextUsage":0.089,"capturedAt":1712345680200} -->
```

---

## Audit Query Examples

### Find exchanges by OpenAI message ID
```sql
SELECT 
  t.thread_id,
  t.name,
  e.seq,
  json_extract(e.metadata, '$.messageId') as message_id
FROM exchanges e
JOIN threads t ON e.thread_id = t.thread_id
WHERE json_extract(e.metadata, '$.messageId') = 'chatcmpl-iVx7h2vVqfKBlnqrq5iaO2TM';
```

### Find all plan mode exchanges
```sql
SELECT 
  t.thread_id,
  t.name,
  e.seq,
  e.user_input,
  json_extract(e.metadata, '$.messageId') as message_id
FROM exchanges e
JOIN threads t ON e.thread_id = t.thread_id
WHERE json_extract(e.metadata, '$.planMode') = true;
```

### Compare plan mode vs normal mode context usage
```sql
SELECT 
  json_extract(e.metadata, '$.planMode') as plan_mode,
  COUNT(*) as exchange_count,
  ROUND(AVG(json_extract(e.metadata, '$.contextUsage')), 3) as avg_context_usage,
  MAX(json_extract(e.metadata, '$.contextUsage')) as peak_usage
FROM exchanges e
GROUP BY plan_mode;
```

### Find exchanges without message IDs (for debugging)
```sql
SELECT 
  t.thread_id,
  t.name,
  e.seq,
  e.ts
FROM exchanges e
JOIN threads t ON e.thread_id = t.thread_id
WHERE json_extract(e.metadata, '$.messageId') IS NULL;
```

---

## Backwards Compatibility

**Existing exchanges** have `metadata: '[]'` — the code should handle both:

```javascript
_toExchange(row) {
  let metadata = {};
  try {
    const parsed = JSON.parse(row.metadata || '{}');
    // Handle both old array format [] and new object format {}
    metadata = Array.isArray(parsed) ? {} : parsed;
  } catch {
    metadata = {};
  }
  
  return {
    seq: row.seq,
    ts: row.ts,
    user: row.user_input,
    assistant: JSON.parse(row.assistant),
    metadata,
  };
}
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `server.js` | Track messageId, planMode, contextUsage, tokenUsage in session; pass to addExchange |
| `HistoryFile.js` | Update `addExchange()` to accept and store auditMeta; update `_toExchange()` to parse object metadata |
| `ChatFile.js` | Update `serialize()` to include audit metadata comments |
| `ThreadWebSocketHandler.js` | Update `addAssistantMessage()` to accept and pass auditMeta |

---

## Testing

### Verify message_id capture
```sql
-- After running a chat, check the latest exchange
SELECT 
  seq,
  json_extract(metadata, '$.messageId') as message_id,
  json_extract(metadata, '$.planMode') as plan_mode,
  json_extract(metadata, '$.contextUsage') as context_usage
FROM exchanges
ORDER BY seq DESC
LIMIT 1;
```

### Verify CHAT.md format
```bash
cat ai/views/{workspace}/chat/threads/{username}/{thread-name}.md | grep "<!-- audit:"
```

---

## Future Extensions

Other wire fields we could capture in metadata:
- `context_tokens` — Absolute token count
- `max_context_tokens` — Context window size
- `token_usage.input_cache_read` — Cache hit tokens
- `model` — Which model was used (if wire provides it)
- `finish_reason` — Why the turn ended


---

## Appendix: Universal Ledger (Future)

**Status:** Design complete, implementation pending.

The Message ID audit is Phase 1 of a larger system: a **sparse temporal index** that enables tracing file mutations across the entire project history without duplicating content.

### Core Principle

The ledger stores **event references**, not content. Chat history remains in SQLite/CHAT.md. File diffs remain in git. The ledger only answers: *"When did this file change, and where do I find the full story?"*

### Ledger Schema

```sql
CREATE TABLE ledger (
  ts INTEGER NOT NULL,              -- millisecond precision
  msg_id TEXT NOT NULL,             -- OpenAI-style: chatcmpl-XXXXXXXX
  thread_id TEXT NOT NULL,          -- links to exchanges table
  
  -- Context (5-field provenance)
  cli TEXT,                         -- 'kimi', 'gemini', 'codex'
  provider TEXT,                    -- 'moonshot', 'openai', 'anthropic'
  model TEXT,                       -- 'k1.6', 'gpt-4', 'claude-3', etc.
  agent TEXT,                       -- 'robin', 'phoenix'
  workflow TEXT,                    -- 'bug-fix', 'explore', NULL if ad-hoc
  
  -- The mutation (exactly one per wire event)
  mutation_type TEXT CHECK (
    mutation_type IN ('create', 'write', 'edit', 'delete', 'shell')
  ),
  file_path TEXT,                   -- full path
  file_name TEXT,                   -- basename for quick filtering
  file_ext TEXT,                    -- extension (.tsx, .md, .js) for type filtering
  
  PRIMARY KEY (msg_id, mutation_type)  -- one msg can have multiple mutations
);

-- Indexes
CREATE INDEX idx_ledger_file ON ledger(file_path, ts);
CREATE INDEX idx_ledger_name ON ledger(file_name, ts);
CREATE INDEX idx_ledger_ext ON ledger(file_ext, ts);
CREATE INDEX idx_ledger_thread ON ledger(thread_id, ts);
CREATE INDEX idx_ledger_time ON ledger(ts);
```

### What Gets Logged

| Wire Event | Logged? | Reason |
|------------|---------|--------|
| `WriteFile` (new file) | ✅ create | File creation |
| `WriteFile` (existing) | ✅ write | File overwrite |
| `EditFile` | ✅ edit | File modification |
| `Delete` | ✅ delete | State mutation |
| `Shell` | ✅ shell | Side effects |
| `ReadFile` | ❌ | Diagnostic, no state change |
| `Glob` | ❌ | Diagnostic |
| `Grep` | ❌ | Diagnostic |
| `WebSearch` | ❌ | External, not project-local |

### Query Patterns

**Find all changes to a file:**
```sql
SELECT ts, msg_id, mutation_type, cli
FROM ledger
WHERE file_path = 'src/components/Button.tsx'
ORDER BY ts DESC;
```

**Find all TypeScript component changes (exclude markdown):**
```sql
SELECT ts, file_path, mutation_type
FROM ledger
WHERE file_ext = '.tsx'
ORDER BY ts DESC;
```

**Find all wiki page changes (by naming convention):**
```sql
SELECT ts, file_path, mutation_type
FROM ledger
WHERE file_name = 'PAGE.md'
ORDER BY ts DESC;
```

**Find all trigger configuration changes:**
```sql
SELECT ts, file_path, mutation_type, cli
FROM ledger
WHERE file_name = 'TRIGGERS.md'
ORDER BY ts DESC;
```

**Find all agent definition updates:**
```sql
SELECT ts, file_path, mutation_type
FROM ledger
WHERE file_name = 'AGENTS.md'
ORDER BY ts DESC;
```

**Find all shell commands that affected Python files:**
```sql
SELECT ts, msg_id, thread_id
FROM ledger
WHERE mutation_type = 'shell'
  AND file_ext = '.py'
ORDER BY ts DESC;
```

**Find context around a change:**
```sql
-- Get 3 events before and after a specific mutation
WITH target AS (
  SELECT ts FROM ledger 
  WHERE msg_id = 'chatcmpl-abc123' AND mutation_type = 'edit'
)
SELECT * FROM ledger
WHERE ts BETWEEN (SELECT ts - 60000 FROM target) 
             AND (SELECT ts + 60000 FROM target)
ORDER BY ts;
```

**Find all shell commands run by a specific agent:**
```sql
SELECT ts, msg_id, thread_id
FROM ledger
WHERE agent = 'phoenix' AND mutation_type = 'shell'
ORDER BY ts DESC;
```

### Scale Expectations

| Metric | Estimate |
|--------|----------|
| Rows per active day | ~50-100 |
| Rows per year | ~20K-40K |
| Rows after 5 years | ~100K-200K |
| Practical limit | 1M rows (~10 years heavy use) |
| Action at 1M | Archive or partition; schema supports it |

### Integration with Event Bus

The manifold (interpreter layer) receives raw wire events and decides what enters the ledger:

```
Kimi CLI ──→ Kimi Interpreter ──→ Canonical Format ──→ Universal Event Bus
Gemini ────→ Gemini Interpreter ──┘                         │
Codex ─────→ Codex Interpreter ───┘                         ├──→ Ledger (mutations only)
                                                            │
                                                            └──→ Chat History (everything)
```

Each interpreter is responsible for:
1. Mapping CLI-specific tool names to canonical mutation types
2. Extracting file paths from arguments
3. Enriching with CLI/provider/model/agent context
4. Emitting canonical events that the ledger subscribes to

### Relationship to This Spec

Phase 1 (this spec) adds `message_id` to the existing `exchanges.metadata` JSON. This enables correlation between chat history and the future ledger.

Phase 2 (ledger) subscribes to the event bus and logs mutations as a separate, queryable timeline.

The message_id is the bridge: `ledger.msg_id` → `exchanges.metadata.messageId` → full chat exchange.


---

## Implementation Roadmap

### Current State Audit

| Component | Status | Notes |
|-----------|--------|-------|
| `StatusUpdate` handler | 🟡 Partial | Tracks `contextUsage`, `tokenUsage` — **missing `messageId`, `planMode`** |
| `TurnEnd` handler | 🟡 Partial | Passes metadata to `addExchange` — **missing `messageId`, `planMode`** |
| `HistoryFile.addExchange()` | ✅ Done | Accepts and stores metadata JSON |
| `_toExchange()` | ✅ Done | Handles legacy array + new object format |
| `ledger` table | ❌ Missing | Not implemented |

---

### Phase 1: Capture message_id and plan_mode (Small, Safe)

**Goal:** Add the missing fields to session tracking and metadata.

**Files to touch:**
1. `kimi-ide-server/server.js` — Add 2 lines to StatusUpdate handler (line ~954)
2. `kimi-ide-server/server.js` — Add 2 fields to TurnEnd metadata (line ~903)

**Changes:**

```javascript
// StatusUpdate handler (~line 954)
case 'StatusUpdate':
  session.contextUsage = payload?.context_usage ?? null;
  session.tokenUsage = payload?.token_usage ?? null;
  session.messageId = payload?.message_id ?? null;      // ADD
  session.planMode = payload?.plan_mode ?? false;       // ADD
  // ... rest
```

```javascript
// TurnEnd handler (~line 903)
case 'TurnEnd':
  if (session.currentTurn) {
    const metadata = {
      contextUsage: session.contextUsage,
      tokenUsage: session.tokenUsage,
      messageId: session.messageId,      // ADD
      planMode: session.planMode,        // ADD
      capturedAt: Date.now()
    };
    // ... rest
```

**Checkpoint 1 — Sanity Check:**
```sql
-- After running a chat, verify:
SELECT seq, json_extract(metadata, '$.messageId') as msg_id
FROM exchanges 
ORDER BY seq DESC LIMIT 1;
-- Expected: chatcmpl-XXXXXXXX
```

---

### Phase 2: Ledger Migration (Medium, New Table)

**Goal:** Create the `ledger` table for the universal event index.

**Files:**
- `kimi-ide-server/lib/db/migrations/006_ledger.js` — New migration
- `kimi-ide-server/lib/ledger.js` — New query module (optional for v1)

**Migration:**

```javascript
// 006_ledger.js
exports.up = function(knex) {
  return knex.schema.createTable('ledger', (t) => {
    t.integer('ts').notNullable();
    t.text('msg_id').notNullable();
    t.text('thread_id').notNullable();
    t.text('cli');                    // 'kimi', 'claude', 'qwen', etc.
    t.text('provider');               // 'moonshot', 'openai', 'anthropic'
    t.text('model');                  // 'k1.6', 'gpt-4', etc.
    t.text('agent');                  // 'robin', 'phoenix'
    t.text('workflow');               // 'bug-fix', null if ad-hoc
    t.text('mutation_type').checkIn(['create', 'write', 'edit', 'delete', 'shell']);
    t.text('file_path');              // full path
    t.text('file_name');              // basename for filtering
    t.text('file_ext');               // .tsx, .md, .js
    t.primary(['msg_id', 'mutation_type']);
    t.index(['file_path', 'ts']);
    t.index(['file_name', 'ts']);
    t.index(['file_ext', 'ts']);
    t.index(['thread_id', 'ts']);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('ledger');
};
```

**Checkpoint 2 — Table Exists:**
```bash
sqlite3 ai/system/robin.db ".schema ledger"
# Expected: shows table and index definitions
```

---

### Phase 3: Ledger Event Bus Subscriber (Medium, New Logic)

**Goal:** Write mutation events to the ledger as they flow through the event bus.

**Files:**
- `kimi-ide-server/lib/ledger.js` — Query module
- `kimi-ide-server/server.js` — Wire tool results to ledger

**Query Module Pattern:**

```javascript
// lib/ledger.js
const { getDb } = require('./db');

class Ledger {
  async insert(event) {
    const db = getDb();
    await db('ledger').insert({
      ts: event.ts,
      msg_id: event.msg_id,
      thread_id: event.thread_id,
      cli: event.cli,
      provider: event.provider,
      model: event.model,
      agent: event.agent,
      workflow: event.workflow,
      mutation_type: event.mutation_type,
      file_path: event.file_path,
      file_name: event.file_name,
      file_ext: event.file_ext
    }).catch(err => {
      console.error('[Ledger] Failed to insert:', err);
      // Fire-and-forget: don't block the bus
    });
  }

  async queryByFile(filePath, limit = 20) {
    const db = getDb();
    return db('ledger')
      .where('file_path', filePath)
      .orderBy('ts', 'desc')
      .limit(limit);
  }

  async queryAroundTimestamp(ts, windowMs = 60000) {
    const db = getDb();
    return db('ledger')
      .whereBetween('ts', [ts - windowMs, ts + windowMs])
      .orderBy('ts', 'asc');
  }
}

module.exports = { Ledger };
```

**Integration in Tool Result Handler:**

```javascript
// In server.js tool result handling
// After correlating tool_call with tool_result:

const toolName = canonicalToolName;  // 'write', 'edit', 'delete', 'shell'
const isMutation = ['write', 'edit', 'delete', 'shell'].includes(toolName);

if (isMutation && session.messageId) {
  const filePath = extractFilePath(toolArgs);  // null for shell
  ledger.insert({
    ts: Date.now(),
    msg_id: session.messageId,
    thread_id: session.currentThreadId,
    cli: session.cli || 'kimi',        // From session config
    provider: session.provider,
    model: session.model,
    agent: session.agent,
    workflow: session.workflow,
    mutation_type: mapToolToMutation(toolName),  // 'write' -> 'write' or 'create'
    file_path: filePath,
    file_name: filePath ? path.basename(filePath) : null,
    file_ext: filePath ? path.extname(filePath) : null
  });
}
```

**Tool-to-Mutation Mapping:**

| Wire Tool | Mutation Type | File Path? |
|-----------|---------------|------------|
| `WriteFile` (new) | `create` | Yes |
| `WriteFile` (existing) | `write` | Yes |
| `EditFile` | `edit` | Yes |
| `Delete` | `delete` | Yes |
| `Bash` | `shell` | No |
| `ReadFile`, `Glob`, `Grep` | — | Not logged |

**Checkpoint 3 — Events Flowing:**
```sql
-- After a file edit:
SELECT ts, msg_id, mutation_type, file_name
FROM ledger 
WHERE file_name = 'PAGE.md'
ORDER BY ts DESC LIMIT 5;
-- Expected: rows with msg_id, mutation_type, etc.
```

---

### Phase 4: /fork Skill Integration (Large, AI Feature)

**Goal:** Enable cross-session conversation forking via message ID.

**Files:**
- `ai/skills/fork.js` — New skill
- `kimi-ide-client/src/components/chat/MessageActions.tsx` — UI for copy msg ID
- `AGENTS.md` — Document `/fork` command

**Skill Interface:**

```javascript
// ai/skills/fork.js
module.exports = {
  name: 'fork',
  description: 'Explore conversation history from a message ID for forking',
  args: {
    message_id: 'The message ID to fork from (chatcmpl-xxx)',
    lookback: 'Number of prior exchanges to load (default: 6)',
    lookahead: 'Number of subsequent exchanges to peek (default: 2)'
  },
  async run({ message_id, lookback = 6, lookahead = 2 }) {
    // 1. Find the exchange by message_id
    // 2. Load lookback exchanges from same thread
    // 3. Load ledger mutations around that timeframe
    // 4. Present summary to AI for fork decision
  }
};
```

**UI Addition:**
- Add 📋 icon under assistant messages (behind ellipsis)
- Click copies: `/fork chatcmpl-XXXXXXXX`
- User pastes into new chat

**Depends on:** Phases 1-3 complete and stable

---

## Dependency Graph

```
Phase 1 (message_id capture)
    │
    ▼
Phase 2 (ledger table)
    │
    ▼
Phase 3 (event subscriber)
    │
    ▼
Phase 4 (/fork skill) ──→ Future feature
```

**Phase 1 can ship independently.** Phases 2-3 deploy together.

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Migration fails | Use `createTableIfNotExists` pattern |
| Metadata format mismatch | `_toExchange()` already handles `[]` and `{}` |
| Event bus performance | Fire-and-forget: `catch()` swallows errors, never blocks |
| File path normalization | Store all three: absolute, basename, extension |
| Session field missing | Use nullish coalescing: `session.messageId ?? null` |

---

## Cleanup: What's Being Replaced

| Old | New | Action |
|-----|-----|--------|
| `metadata: '[]'` in old exchanges | `metadata: '{}'` with audit fields | None — `_toExchange()` handles both |
| Nothing (ledger is new) | `ledger` table | Pure addition, no replacement |

**No breaking changes.** All existing code continues working.

---

## Sanity Check Strategy

**After each phase:**

1. **Restart server** — `npm run build && node server.js` (migrations auto-run)
2. **Run one chat turn** — Verify no crashes in `server-live.log`
3. **Query the DB** — `sqlite3 ai/system/robin.db "SELECT ..."`
4. **Check CHAT.md** — Verify human-readable format preserved
5. **Hard refresh browser** — `Cmd+Shift+R`, verify UI functional

**Rollback:** Each phase is small enough to `git revert`. Ledger is additive — removing it doesn't break existing features.

---

## Context for Handoff

### Key Files and Their Roles

| File | Purpose | Line Numbers (approx) |
|------|---------|----------------------|
| `server.js` | Wire protocol handler, session state | StatusUpdate: ~954, TurnEnd: ~903 |
| `lib/thread/HistoryFile.js` | Exchange CRUD with metadata | addExchange(): ~68, _toExchange(): ~135 |
| `lib/db/migrations/` | Schema evolution | 001_initial.js, add 006_ledger.js |
| `lib/event-bus.js` | Internal pub/sub | For Phase 3 subscriber |
| `ai/system/robin.db` | SQLite database | Auto-created at `ai/system/robin.db` |

### Session State Structure (server.js)

```javascript
session = {
  currentTurn: { id, text, userInput },
  assistantParts: [],
  hasToolCalls: boolean,
  contextUsage: number,      // Already tracked
  tokenUsage: object,        // Already tracked
  messageId: string,         // ADD in Phase 1
  planMode: boolean,         // ADD in Phase 1
  currentThreadId: string,
  cli: string,               // For Phase 3
  provider: string,          // For Phase 3
  model: string,             // For Phase 3
  // ...
}
```

### Database Schema Context

**exchanges table** (exists):
- `id`, `thread_id`, `seq`, `ts`, `user_input`, `assistant`, `metadata`
- `metadata` is JSON text, defaults to `'[]'`

**ledger table** (to create):
- All fields nullable except `ts`, `msg_id`, `thread_id`
- Composite PK: `(msg_id, mutation_type)` — one msg can have multiple mutations

### Wire Event Types

Events that flow through the handler switch:
- `TurnBegin`, `TurnEnd` — Turn lifecycle
- `ContentPart` — Streaming tokens
- `ToolCall`, `ToolCallPart`, `ToolResult` — Tool execution
- `StatusUpdate` — Context/token metrics (includes message_id, plan_mode)
- `StepBegin` — Sub-step notification

### Testing Query Examples

```sql
-- Phase 1: Verify message_id capture
SELECT 
  seq,
  json_extract(metadata, '$.messageId') as msg_id,
  json_extract(metadata, '$.planMode') as plan_mode
FROM exchanges
ORDER BY seq DESC LIMIT 1;

-- Phase 3: Verify ledger population
SELECT 
  datetime(ts/1000, 'unixepoch') as time,
  mutation_type,
  file_name,
  cli
FROM ledger
WHERE file_name = 'PAGE.md'
ORDER BY ts DESC LIMIT 10;

-- Full context reconstruction
SELECT 
  l.ts,
  l.mutation_type,
  l.file_path,
  json_extract(e.metadata, '$.messageId') as exchange_msg_id
FROM ledger l
JOIN exchanges e ON l.msg_id = json_extract(e.metadata, '$.messageId')
WHERE l.file_path = 'src/components/Button.tsx'
ORDER BY l.ts DESC;
```

---

*Implementation spec complete. Ready for Phase 1.*
