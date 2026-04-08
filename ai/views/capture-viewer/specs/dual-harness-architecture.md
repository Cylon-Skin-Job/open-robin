# Dual-Harness Architecture Specification

## Overview

This specification defines the architecture for running **KIMI CLI** and **BYOK (Bring Your Own Key)** harnesses side-by-side, with a unified wire input interpreter bus that translates all harness output into a canonical event format.

This enables A/B testing between harnesses while maintaining identical data capture, storage, and audit trails regardless of which AI provider is used.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         WIRE INPUT INTERPRETER BUS                      │
│                    (Unified Canonical Event Pipeline)                   │
└─────────────────────────────────────────────────────────────────────────┘
                                       ▲
           ┌───────────────────────────┼───────────────────────────┐
           │                           │                           │
           ▼                           ▼                           ▼
┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│   KIMI HARNESS      │    │   BYOK HARNESS      │    │  FUTURE: Gemini,    │
│   (Existing)        │    │   (New)             │    │  Codex, etc.        │
├─────────────────────┤    ├─────────────────────┤    ├─────────────────────┤
│ • Spawns kimi CLI   │    │ • Vercel AI SDK     │    │ • Adapter pattern   │
│ • JSON-RPC wire     │    │ • Direct API calls  │    │ • Same bus interface│
│ • interpreter.js    │    │ • interpreter.js    │    │                     │
│ • Tool mapping      │    │ • Same tool mapping │    │                     │
└─────────────────────┘    └─────────────────────┘    └─────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         CANONICAL EVENT FORMAT                          │
│  tool_call, tool_call_args, tool_result, content, thinking,             │
│  turn_begin, turn_end                                                   │
└─────────────────────────────────────────────────────────────────────────┘
                                       │
           ┌───────────────────────────┼───────────────────────────┐
           ▼                           ▼                           ▼
┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│   EVENT BUS         │    │   LEDGER            │    │   STORAGE           │
│   (Universal)       │    │   (Sparse Index)    │    │   (SQLite + MD)     │
└─────────────────────┘    └─────────────────────┘    └─────────────────────┘
```

---

## Current State Analysis

### How Wire Input Is Currently Brought In

The current implementation (as of 2026-04-05) has **inline wire handling** scattered across `kimi-ide-server/server.js`:

#### 1. Wire Process Spawning (lines 604-634)
```javascript
function spawnThreadWire(threadId, projectRoot) {
  const kimiPath = process.env.KIMI_PATH || 'kimi';
  const args = ['--wire', '--yolo', '--session', threadId];
  
  const proc = spawn(kimiPath, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, TERM: 'xterm-256color' }
  });
  // ...
}
```

#### 2. Wire Message Handler (lines 747-1010)
The `handleWireMessage(msg)` function directly parses JSON-RPC 2.0 messages from Kimi CLI:
- `TurnBegin` → Sets up session tracking, emits `chat:turn_begin`
- `ContentPart` (text/think) → Accumulates content, emits `chat:content`/`chat:thinking`
- `ToolCall` → Tracks tool calls, emits `chat:tool_call`
- `ToolCallPart` → Accumulates tool arguments
- `ToolResult` → Processes results, emits `chat:tool_result`
- `TurnEnd` → Persists exchange, emits `chat:turn_end`
- `StatusUpdate` → Tracks token/context usage, emits `chat:status_update`

#### 3. Session State Management (lines 666-680)
```javascript
const session = {
  connectionId,
  wire: null,
  currentTurn: null,
  buffer: '',
  toolArgs: {},
  activeToolId: null,
  hasToolCalls: false,
  currentThreadId: null,
  assistantParts: [],
  contextUsage: null,
  tokenUsage: null,
  messageId: null,
  planMode: false
};
```

#### 4. Current Dependencies on Kimi CLI

| Component | Dependency | Risk Level |
|-----------|-----------|------------|
| `server.js:spawnThreadWire()` | Spawns `kimi --wire --yolo` | HIGH |
| `server.js:handleWireMessage()` | Parses Kimi JSON-RPC format | HIGH |
| `lib/runner/wire-session.js` | Spawns `kimi --wire --yolo` for runners | MEDIUM |
| `lib/thread/ThreadManager.js:generateSummary()` | Spawns `kimi --print` | LOW |
| `session.toolArgs` accumulation | Assumes `ToolCallPart` streaming | MEDIUM |
| Tool name mapping | Kimi uses `ReadFile`, `Bash` vs internal `read`, `shell` | MEDIUM |

---

## Step-by-Step Implementation Plan

### Phase 1: Extract KIMI Wiring Logic (Week 1)

**Goal:** Create a dedicated KIMI harness module without changing any behavior

#### Step 1.1: Create Harness Directory Structure
```
lib/harness/robin/
├── types.ts                    # Interface definitions (AIHarness, CanonicalEvent)
├── manager.ts                  # Harness routing and lifecycle
├── robin/
│   ├── index.ts               # KIMI harness implementation
│   ├── wire-parser.ts         # JSON-RPC parsing and buffering
│   └── tool-mapper.ts         # Kimi tool name → canonical name mapping
└── byok/
    └── (placeholder for Phase 2)
```

#### Step 1.2: Define Canonical Event Types
```typescript
// lib/harness/robin/types.ts
interface CanonicalEvent {
  type: 'turn_begin' | 'content' | 'thinking' | 'tool_call' | 
        'tool_call_args' | 'tool_result' | 'turn_end';
  timestamp: number;
  // ... type-specific fields
}

interface AIHarness {
  readonly id: string;
  readonly name: string;
  
  initialize(config: HarnessConfig): Promise<void>;
  startTurn(threadId: string, context: TurnContext): Promise<void>;
  sendMessage(message: string, history: Message[]): AsyncIterable<CanonicalEvent>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
}
```

#### Step 1.3: Extract Wire Parser
Move the JSON-RPC line buffering and parsing from `server.js` to `lib/harness/robin/wire-parser.ts`:

**Current code in server.js (lines 714-734):**
```javascript
wire.stdout.on('data', (data) => {
  session.buffer += data.toString();
  let lines = session.buffer.split('\n');
  session.buffer = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      handleWireMessage(msg);
    } catch (err) {
      // parse error handling
    }
  }
});
```

**New structure:**
```typescript
// lib/harness/robin/wire-parser.ts
class WireParser extends EventEmitter {
  private buffer = '';
  
  feed(data: string): void {
    this.buffer += data;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        this.emit('message', msg);
      } catch (err) {
        this.emit('parse_error', line, err);
      }
    }
  }
}
```

#### Step 1.4: Create RobinInterpreter Class
Extract the message handling logic from `server.js:handleWireMessage()` into a class:

```typescript
// lib/harness/robin/index.ts
class RobinHarness implements AIHarness {
  private parser: WireParser;
  private sessionState: SessionState;
  
  async *sendMessage(message: string): AsyncIterable<CanonicalEvent> {
    // Spawn kimi process
    // Set up parser
    // Yield canonical events as they arrive
  }
  
  private handleKimiEvent(msg: WireMessage): CanonicalEvent {
    // Convert Kimi-specific events to canonical format
    // Tool name mapping: ReadFile → read, Bash → shell, etc.
  }
}
```

#### Step 1.5: Tool Name Mapping Extraction
Current mapping is implicit in `server.js`. Make it explicit:

```typescript
// lib/harness/robin/tool-mapper.ts
const KIMI_TO_CANONICAL_TOOL_MAP: Record<string, string> = {
  'ReadFile': 'read',
  'WriteFile': 'write',
  'EditFile': 'edit',
  'Bash': 'shell',
  'Glob': 'glob',
  'Grep': 'grep',
  'WebSearch': 'web_search',
  'WebFetch': 'fetch',
  'Agent': 'subagent',
  'TodoWrite': 'todo'
};

export function mapKimiToolName(kimiName: string): string {
  return KIMI_TO_CANONICAL_TOOL_MAP[kimiName] || kimiName.toLowerCase();
}
```

### Phase 2: Create Compatibility Layer (Week 1-2)

**Goal:** Ensure existing code continues to work during transition

#### Step 2.1: Compatibility Shim
Create a shim that exports the same interface as current inline code:

```typescript
// lib/harness/robin/compat.ts
// Temporary compatibility layer - removes risk of breaking changes

export function spawnThreadWire(threadId: string, projectRoot: string) {
  // Delegate to new harness but maintain same return type (ChildProcess)
  const harness = getHarnessManager().getRobinHarness();
  return harness.spawnProcess(threadId, projectRoot);
}

export function handleWireMessage(msg: any, session: any, ws: WebSocket) {
  // Delegate to harness but maintain same side effects
  const harness = getHarnessManager().getRobinHarness();
  return harness.handleMessageLegacy(msg, session, ws);
}
```

#### Step 2.2: Feature Flag System
```typescript
// config.ts or lib/harness/robin/feature-flags.ts
const HARNESS_FEATURES = {
  useNewInterpreter: process.env.USE_NEW_HARNESS === 'true',
  enableByokHarness: process.env.ENABLE_BYOK === 'true',
  parallelHarnessMode: process.env.PARALLEL_HARNESS === 'true'
};
```

### Phase 3: Server.js Refactoring (Week 2)

**Goal:** Replace inline wire handling with harness calls

#### Step 3.1: Session State Simplification
Current session state (lines 666-680) has wire-specific fields. Separate harness state:

```typescript
// Before (current)
const session = {
  wire: null,              // ChildProcess
  buffer: '',              // Wire-specific
  toolArgs: {},            // Wire-specific
  activeToolId: null,      // Wire-specific
  // ...
};

// After
const session = {
  harness: null,           // AIHarness interface
  harnessState: {},        // Opaque state from harness
  // ...
};
```

#### Step 3.2: Wire Handler Replacement
Replace `setupWireHandlers()` and `handleWireMessage()` with harness event handling:

```typescript
// Before (current - server.js:713-1010)
function setupWireHandlers(wire, threadId) {
  wire.stdout.on('data', (data) => {
    // 50+ lines of parsing logic
  });
}

// After
function setupHarnessHandlers(harness, threadId) {
  harness.on('event', (event: CanonicalEvent) => {
    // Simple switch on canonical event type
  });
}
```

### Phase 4: Testing & Validation (Week 2-3)

**Goal:** Ensure zero regression in KIMI functionality

#### Step 4.1: Test Scenarios
| Scenario | Validation |
|----------|-----------|
| Basic chat | Text appears, turn ends correctly |
| Tool calls | ReadFile, Bash execute and return |
| Streaming | Content appears progressively |
| Thinking blocks | Think → text transitions handled |
| Multi-step | StepBegin events processed |
| Status updates | Token usage tracked |
| Session restore | `--session` flag works |
| Error handling | Parse errors don't crash |

#### Step 4.2: Rollback Strategy
```typescript
// In server.js - easy rollback capability
const USE_LEGACY_WIRE_HANDLING = process.env.LEGACY_WIRE !== 'false';

if (USE_LEGACY_WIRE_HANDLING) {
  setupWireHandlersLegacy(wire, threadId);
} else {
  setupHarnessHandlers(harness, threadId);
}
```

---

## Risk Analysis: What Could Break

### HIGH RISK Areas

#### 1. Tool Argument Accumulation
**Current behavior:** `ToolCallPart` events stream JSON fragments into `session.toolArgs[toolCallId]`

**Risk:** If the new parser doesn't buffer exactly the same way, tool arguments get corrupted

**Mitigation:**
- Unit test with recorded wire output samples
- Compare accumulated args byte-for-byte
- Maintain `toolArgs` buffer in compatibility shim

#### 2. Event Ordering
**Current behavior:** Events are processed synchronously in the order received

**Risk:** Async iterator or EventEmitter could reorder events

**Mitigation:**
- Use single-threaded processing
- Queue events if needed
- Validate order in integration tests

#### 3. Session State Coupling
**Current behavior:** `handleWireMessage` directly mutates `session.assistantParts`, `session.currentTurn`

**Risk:** Missing state updates cause UI issues or data loss

**Mitigation:**
- Create state mutation wrapper functions
- Audit all state touches
- Add state validation assertions

### MEDIUM RISK Areas

#### 4. Tool Name Mapping
**Current behavior:** Tool names passed through to UI (Kimi uses `ReadFile`, UI expects `read`)

**Risk:** UI doesn't recognize tool names, icons/menus break

**Mitigation:**
- Map at harness boundary
- Add tool name validation
- Test all 10 tool types

#### 5. Process Lifecycle
**Current behavior:** Process killed on disconnect, thread switch

**Risk:** Harness doesn't replicate kill timing

**Mitigation:**
- Mirror current kill() calls exactly
- Add process cleanup tests

### LOW RISK Areas

#### 6. Error Message Format
**Risk:** Error handling paths have slightly different messages

**Mitigation:** Log comparison testing

---

## Data Capture Requirements

Every harness MUST capture and emit:

| Field | KIMI Source | BYOK Source | Purpose |
|-------|-------------|-------------|---------|
| `thread_id` | Session UUID | Same UUID | Thread identification |
| `messageId` | StatusUpdate wire event | Response header `x-message-id` | Cross-session correlation |
| `user_input` | TurnBegin payload | Passed to sendMessage() | What user typed |
| `assistant.parts` | Accumulated wire events | Accumulated stream chunks | Full response structure |
| `tool_call` | ToolCall wire event | `tool-call` stream chunk | Tool invocation start |
| `tool_result` | ToolResult wire event | `tool-result` stream chunk | Tool completion |
| `tokenUsage` | StatusUpdate payload | `finish` chunk usage | Cost tracking |
| `contextUsage` | StatusUpdate payload | Calculated usage/maxTokens | Context window monitoring |
| `planMode` | StatusUpdate payload | User setting | Plan vs act mode |
| `harness_id` | 'kimi' | 'byok-{provider}' | Source identification |
| `provider` | 'kimi' | 'openai', 'anthropic', 'ollama' | Provider name |
| `model` | 'k1.6' | 'gpt-4o', 'claude-3-sonnet' | Model identifier |

---

## SQLite Schema (Unified)

### threads table
```sql
CREATE TABLE threads (
  thread_id TEXT PRIMARY KEY,
  panel_id TEXT,
  name TEXT,
  created_at TEXT,
  resumed_at TEXT,
  message_count INTEGER DEFAULT 0,
  status TEXT CHECK(status IN ('active', 'suspended')),
  date TEXT,
  updated_at INTEGER
);
```

### exchanges table
```sql
CREATE TABLE exchanges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  user_input TEXT,
  assistant TEXT,        -- JSON: { parts: [...], harness: {...} }
  metadata TEXT,         -- JSON: full audit trail
  FOREIGN KEY (thread_id) REFERENCES threads(thread_id) ON DELETE CASCADE
);
```

### assistant column structure
```json
{
  "parts": [
    { "type": "text", "text": "..." },
    { "type": "thinking", "text": "..." },
    { "type": "tool_call", "toolCallId": "tc-1", "toolName": "read", "args": {...} },
    { "type": "tool_result", "toolCallId": "tc-1", "toolName": "read", "output": "...", "isError": false }
  ],
  "harness": {
    "id": "byok-openai",
    "provider": "openai",
    "model": "gpt-4o"
  }
}
```

### metadata column structure
```json
{
  "messageId": "chatcmpl-abc123",
  "tokenUsage": {
    "input_tokens": 2575,
    "output_tokens": 358,
    "total_tokens": 2933,
    "input_cache_read": 55552,
    "input_cache_creation": 0
  },
  "contextUsage": {
    "used_tokens": 2933,
    "max_tokens": 128000,
    "percentage": 0.0229
  },
  "planMode": false,
  "capturedAt": 1705334399000,
  "savedAt": 1705334400000,
  "durationMs": 8432,
  "source": {
    "harnessId": "byok-openai",
    "provider": "openai",
    "model": "gpt-4o-2024-08-06"
  }
}
```

---

## KIMI Harness (Refactored)

**Location**: `lib/harness/robin/index.ts`

**Key Responsibilities**:
1. Spawn `kimi --wire --yolo` process
2. Parse JSON-RPC 2.0 messages from stdout
3. Translate to canonical events
4. Map tool names: `ReadFile` → `read`, `Bash` → `shell`
5. Accumulate streaming `ToolCallPart` into complete args
6. Emit `turn_end` with metadata from `StatusUpdate`

**Wire Events → Canonical Events Mapping:**

| Kimi Wire Event | Canonical Event | Notes |
|-----------------|-----------------|-------|
| `TurnBegin` | `turn_begin` | Includes user_input |
| `ContentPart` (text) | `content` | Accumulates text |
| `ContentPart` (think) | `thinking` | Separate stream |
| `ToolCall` | `tool_call` | Tool name mapped |
| `ToolCallPart` | `tool_call_args` | Accumulates JSON |
| `ToolResult` | `tool_result` | Includes output, display |
| `TurnEnd` | `turn_end` | Final metadata |
| `StatusUpdate` | `_meta` on turn_end | Token/context usage |

---

## BYOK Harness (Future - Phase 3+)

**Location**: `lib/harness/robin/byok/index.ts`

**Supported Providers**:
- OpenAI (via `@ai-sdk/openai`)
- Anthropic (via `@ai-sdk/anthropic`)
- Ollama (via `ollama-ai-provider`)
- MLX (custom fetch wrapper)

**Key Responsibilities**:
1. Initialize model with user-provided API key or local endpoint
2. Stream responses via Vercel AI SDK
3. Translate stream chunks to canonical events
4. Capture messageId from response headers
5. Accumulate tool args from `tool-call-delta` chunks
6. Emit identical event sequence as KIMI harness

---

## Harness Manager

**Location**: `lib/harness/robin/manager.ts`

**Responsibilities**:
- Register available harnesses
- Route threads to active harness
- Handle per-chat harness selection
- Support mid-thread harness switching (for testing)

**API**:
```typescript
class HarnessManager {
  register(harness: AIHarness): void;
  initializeAll(): Promise<void>;
  startThread(threadId: string, harnessId: string, config: any): Promise<void>;
  sendMessage(threadId: string, message: string): AsyncIterable<CanonicalEvent>;
  switchHarness(threadId: string, newHarnessId: string): Promise<void>;
  getAvailableHarnesses(): HarnessInfo[];
}
```

---

## Audit Subscriber Integration

**Location**: `lib/audit/audit-subscriber.js` (existing, enhanced)

**Flow**:
1. Accumulate metadata throughout turn (via `status_update` or `_meta`)
2. On `turn_end`, extract full audit data
3. Persist to SQLite via `HistoryFile.addExchange()`
4. Log to ledger for cross-thread queries

**Data Accumulation**:
```javascript
const pendingAuditData = new Map(); // threadId -> audit

// Accumulate from events
pendingAuditData.set(threadId, {
  messageId: event._meta?.messageId,
  tokenUsage: event._meta?.tokenUsage,
  contextUsage: event._meta?.contextUsage,
  planMode: event._meta?.planMode,
  harness: {
    id: event._meta?.harnessId,
    provider: event._meta?.provider,
    model: event._meta?.model
  }
});

// Persist on turn_end
await HistoryFile.addExchange(threadId, userInput, assistant, metadata);
```

---

## File Structure (Target)

```
lib/
├── harness/
│   ├── types.ts                    # Interface definitions
│   ├── manager.ts                  # Harness routing
│   ├── compat.ts                   # Compatibility shim (temp)
│   ├── robin/
│   │   ├── index.ts               # KIMI harness implementation
│   │   ├── wire-parser.ts         # JSON-RPC parsing
│   │   └── tool-mapper.ts         # Tool name mapping
│   └── byok/
│       ├── index.ts               # Vercel AI SDK wrapper
│       └── providers/
│           ├── openai.ts
│           ├── anthropic.ts
│           ├── ollama.ts
│           └── mlx.ts
├── profiles/
│   ├── loader.ts                   # YAML profile loading
│   └── validator.ts                # Profile validation
└── audit/
    └── audit-subscriber.js         # Enhanced for dual-harness
```

---

## Migration Path

| Phase | Duration | Work | Risk |
|-------|----------|------|------|
| **1. Extract** | Week 1 | Create harness structure, extract KIMI logic | Low |
| **2. Compatibility** | Week 1-2 | Shim layer, feature flags, parallel testing | Low |
| **3. Cutover** | Week 2 | Switch server.js to use harness | Medium |
| **4. Validate** | Week 2-3 | Full regression testing, bug fixes | Medium |
| **5. Cleanup** | Week 3 | Remove legacy code, remove shims | Low |
| **6. BYOK** | Week 4+ | Implement BYOK harness | Medium |

---

## Key Assumptions

1. **Vercel AI SDK bundles fully** for offline use (pure JS, no runtime fetches)
2. **Tool registry is shared** between harnesses (identical tool definitions)
3. **Event bus is unchanged** (same subscribers, same emit patterns)
4. **SQLite schema is extended** (new columns, backward compatible)
5. **Ledger schema is extended** (provider/model fields added)

---

## Open Questions

1. Do we need to capture `finish_reason` (stop, length, tool_calls) from BYOK?
2. Should we log raw API errors differently than tool errors?
3. How do we handle rate limiting UI differently for BYOK vs KIMI?
4. Do we want to capture full HTTP response times separate from durationMs?

---

## Success Criteria

- [ ] KIMI harness refactored, all existing tests pass
- [ ] Zero regression in KIMI CLI functionality
- [ ] Same SQLite row structure regardless of harness
- [ ] Ledger queries return correct provider/model info
- [ ] UI shows harness selector on new chat
- [ ] Can switch harness mid-thread for testing
- [ ] 30-day A/B test shows quality parity or improvement

---

## Appendix: Current Code References

### Wire Spawning
- `server.js:604-634` - `spawnThreadWire()`
- `lib/runner/wire-session.js:41-67` - Runner wire spawning

### Wire Message Handling
- `server.js:747-1010` - `handleWireMessage()`
- `server.js:713-745` - `setupWireHandlers()`

### Session State
- `server.js:666-680` - Session object structure
- `server.js:761-982` - Event type switch statement

### Tool Handling
- `server.js:819-905` - ToolCall, ToolCallPart, ToolResult handling
- `server.js:851-854` - Tool args parsing

### Audit/Data Capture
- `lib/audit/audit-subscriber.js:48-103` - StatusUpdate and TurnEnd handling
- `server.js:908-951` - TurnEnd metadata building

---

*Spec Version: 1.1*
*Created: 2026-01-12*
*Last Updated: 2026-04-05*
*Status: Ready for Implementation - Phase 1*
