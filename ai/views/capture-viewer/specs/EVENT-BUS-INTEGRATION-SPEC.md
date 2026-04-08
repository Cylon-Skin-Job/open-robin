# Event Bus Integration & End-to-End Harness Specification

**Status:** Draft  
**Version:** 1.0  
**Date:** 2026-04-05  
**Context:** Handoff spec for new session

---

## 📋 EXECUTIVE SUMMARY

This specification describes the **final integration layer** needed to connect all CLI harnesses (Gemini, Qwen, Claude Code, Codex) to the Kimi IDE's event system and persistence layer.

### What's Already Built ✅

| Component | Status | Location |
|-----------|--------|----------|
| BaseCLIHarness | ✅ Complete | `lib/harness/clis/base-cli-harness.js` |
| HarnessRegistry | ✅ Complete | `lib/harness/registry.js` |
| GeminiHarness | ✅ Complete | `lib/harness/clis/gemini/` |
| QwenHarness | ✅ Complete | `lib/harness/clis/qwen/` |
| ClaudeCodeHarness | ✅ Complete | `lib/harness/clis/claude-code/` |
| CodexHarness | ✅ Complete | `lib/harness/clis/codex/` |
| `/api/harnesses` endpoint | ✅ Complete | `server.js` (lines ~1470) |
| KimiHarness | ⚠️ Partial | `lib/harness/kimi/` (needs BaseCLIHarness extension) |

### What's Missing ❌ (This Spec Covers)

1. **Event Bus Bridge**: Harnesses emit `event` but not `chat:*` events
2. **Audit Subscriber Integration**: Events don't reach SQLite persistence
3. **Parts Array Accumulation**: Not properly building assistantParts for DB
4. **UI Config Updates**: Frontend doesn't know about new harnesses
5. **End-to-End Testing**: Full flow verification

---

## 1. ARCHITECTURE OVERVIEW

### 1.1 Current State (What's Built)

```
┌─────────────────────────────────────────────────────────────┐
│  CLI Harness (Gemini/Qwen/Claude/Codex)                     │
│  ├── Spawns subprocess (CLI --acp)                          │
│  ├── Parses JSON-RPC (AcpWireParser)                        │
│  ├── Translates to canonical (AcpEventTranslator)           │
│  └── Emits: harness.on('event', ...)                        │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼ EventEmitter (harness internal)
┌─────────────────────────────────────────────────────────────┐
│  ??? GAP: No bridge to shared event bus ???                 │
└─────────────────────────────────────────────────────────────┘
                       │
                       SHOULD BE:
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Shared Event Bus (lib/event-bus.js)                        │
│  ├── chat:turn_begin                                        │
│  ├── chat:content                                           │
│  ├── chat:thinking                                          │
│  ├── chat:tool_call                                         │
│  ├── chat:tool_result                                       │
│  ├── chat:turn_end ← CRITICAL for SQLite                   │
│  └── chat:status_update                                     │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Audit Subscriber (lib/audit/subscriber.js)                 │
│  ├── Listens on chat:* events                               │
│  ├── Accumulates in pendingAuditData Map                    │
│  └── Calls HistoryFile.addExchange() → SQLite               │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Target State (What This Spec Builds)

```
Harness Event ──► Bridge ──► chat:* Event ──► Audit ──► SQLite
     │                           │
     └─── canonical format       └─── app-wide pub/sub
```

---

## 2. RELATED DOCUMENTATION

### 2.1 Harness Specs (Reference These!)

| Spec | Path | Purpose |
|------|------|---------|
| **Gemini** | `specs/GEMINI-CLI-HARNESS-SPEC.md` | ACP protocol, event translation |
| **Qwen** | `specs/QWEN-CLI-HARNESS-SPEC.md` | ACP + thinking blocks + content array |
| **Claude Code** | `specs/CLAUDE-CODE-HARNESS-SPEC.md` | ACP + thinking exposure |
| **Codex** | `specs/CODEX-CLI-HARNESS-SPEC.md` | ACP via adapter |
| **Implementation Guide** | `specs/HARNESS-IMPLEMENTATION-GUIDE.md` | Lessons learned |

### 2.2 Key Files to Study

```
lib/harness/clis/gemini/index.js          ← Reference ACP harness
lib/harness/clis/gemini/acp-event-translator.js  ← Event translation
lib/harness/clis/gemini/session-state.js  ← Parts accumulation
lib/event-bus.js                          ← Shared event bus
lib/audit/subscriber.js                   ← SQLite persistence
lib/db/history.js                         ← HistoryFile.addExchange()
```

### 2.3 What Each Harness Currently Does

**Current flow in Gemini/Qwen/Claude/Codex:**
1. Spawn CLI subprocess with `--acp`
2. Send `initialize` → `session/new` handshake
3. Send `session/prompt` for user message
4. Receive streaming `session/update` notifications
5. **Translate to canonical events:**
   - `agent_thought_chunk` → `{type: 'thinking', ...}`
   - `agent_message_chunk` → `{type: 'content', ...}`
   - `tool_call` → `{type: 'tool_call', ...}`
   - `tool_call_update` → `{type: 'tool_result', ...}`
   - `session/prompt` response → `{type: 'turn_end', ...}`
6. **Emit via:** `this.emit('event', {threadId, event})`

**What's missing:** Bridge from `harness.emit('event')` to shared `chat:*` events.

---

## 3. EVENT BUS BRIDGE (CORE REQUIREMENT)

### 3.1 The Problem

Each harness has this code:
```javascript
// In acp-event-translator.js:
this.emit('event', { threadId, event: { type: 'turn_end', ... } });
```

But the audit subscriber expects:
```javascript
// In lib/audit/subscriber.js:
emit('chat:turn_end', {
  workspace: 'code-viewer',
  threadId,
  turnId,
  userInput,
  parts,  // CRITICAL: assistantParts array
  fullText,
  hasToolCalls
});
```

### 3.2 The Solution

Add bridge code to each harness's `startThread()` method:

```javascript
// In each harness (gemini/index.js, qwen/index.js, etc.)
const { emit } = require('../../event-bus');  // SHARED event bus

async startThread(threadId, projectRoot) {
  // ... existing spawn and init code ...
  
  const sessionState = new SessionState();  // Per-thread state
  
  // Bridge: Listen to translator events, emit to shared bus
  translator.on('event', ({ event }) => {
    // 1. Accumulate parts in session state
    if (event.type === 'thinking') {
      sessionState.addThought(event.text);
    } else if (event.type === 'content') {
      sessionState.addText(event.text);
    } else if (event.type === 'tool_call') {
      sessionState.startToolCall(event.toolCallId, event.toolName, {});
    } else if (event.type === 'tool_result') {
      sessionState.completeToolCall(event.toolCallId, event.output, event.isError);
    }
    
    // 2. Emit to shared event bus for UI
    if (event.type === 'turn_begin') {
      emit('chat:turn_begin', {
        workspace: 'code-viewer',
        threadId,
        turnId: event.turnId
      });
    } else if (event.type === 'content') {
      emit('chat:content', {
        threadId,
        content: event.text
      });
    } else if (event.type === 'thinking') {
      emit('chat:thinking', {
        threadId,
        content: event.text
      });
    } else if (event.type === 'turn_end') {
      // CRITICAL: This triggers SQLite persistence
      emit('chat:turn_end', {
        workspace: 'code-viewer',
        threadId,
        turnId: event.turnId,
        userInput: sessionState.userInput,
        parts: sessionState.assistantParts,  // ACCUMULATED ARRAY
        fullText: event.fullText,
        hasToolCalls: event.hasToolCalls
      });
      
      // Also emit status for token tracking
      emit('chat:status_update', {
        threadId,
        tokenUsage: event._meta?.tokenUsage
      });
    }
  });
  
  // ... rest of startThread ...
}
```

### 3.3 Required Changes Per Harness

Update these files:

| Harness | File to Modify | What to Add |
|---------|---------------|-------------|
| Gemini | `lib/harness/clis/gemini/index.js` | Event bus bridge in startThread() |
| Qwen | `lib/harness/clis/qwen/index.js` | Event bus bridge in startThread() |
| Claude Code | `lib/harness/clis/claude-code/index.js` | Event bus bridge in startThread() |
| Codex | `lib/harness/clis/codex/index.js` | Event bus bridge in startThread() |

---

## 4. PARTS ARRAY ACCUMULATION (CRITICAL FOR SQLITE)

### 4.1 What is assistantParts?

The SQLite `exchanges` table stores:
```sql
user_input TEXT,      -- User's message
assistant TEXT,       -- JSON: { parts: [...] }
metadata TEXT         -- Token usage, etc.
```

The `parts` array must look like:
```javascript
[
  { type: 'think', content: 'Let me analyze...' },
  { type: 'text', content: 'Here is the answer:' },
  { type: 'tool_call', toolCallId: 'abc', name: 'shell', arguments: {...}, result: {...} },
  { type: 'text', content: 'Based on the output...' }
]
```

### 4.2 SessionState Classes

Each harness should have a `session-state.js`:

```javascript
// lib/harness/clis/gemini/session-state.js (exists - verify it works)
class GeminiSessionState {
  constructor() {
    this.assistantParts = [];
    this.accumulatedText = '';
    this.hasToolCalls = false;
    this.pendingToolCalls = new Map();
    this.userInput = '';
  }
  
  setUserInput(text) { this.userInput = text; }
  addThought(text) { this.assistantParts.push({ type: 'think', content: text }); }
  addText(text) { this.assistantParts.push({ type: 'text', content: text }); this.accumulatedText += text; }
  startToolCall(id, name, args) { /* ... */ }
  completeToolCall(id, output, isError) { /* ... */ }
}
```

**Verify each harness has this!** If not, copy from Gemini and customize.

---

## 5. UI CONFIGURATION

### 5.1 Update Frontend Config

File: `kimi-ide-client/src/config/harness.ts`

Add all harnesses to HARNESS_OPTIONS:

```typescript
export const HARNESS_OPTIONS: HarnessOption[] = [
  {
    id: 'robin',
    name: 'Robin',
    description: 'Built-in Vercel AI SDK',
    icon: '🔷',
    details: { provider: 'vercel', model: 'k1.6', features: ['tools', 'streaming'] },
    enabled: true,
    recommended: true
  },
  {
    id: 'gemini',
    name: 'Gemini',
    description: 'Google Gemini CLI',
    icon: '💎',
    details: { provider: 'google', model: 'gemini-2.5', features: ['tools', 'streaming'] },
    enabled: false
  },
  {
    id: 'qwen',
    name: 'Qwen',
    description: 'Alibaba Qwen Code CLI with thinking',
    icon: '🔶',
    details: { provider: 'alibaba', model: 'qwen3-coder', features: ['tools', 'streaming', 'thinking'] },
    enabled: false
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    description: 'Anthropic Claude Code CLI',
    icon: '🟣',
    details: { provider: 'anthropic', model: 'claude-sonnet-4-6', features: ['tools', 'streaming', 'thinking'] },
    enabled: false
  },
  {
    id: 'codex',
    name: 'Codex',
    description: 'OpenAI Codex CLI',
    icon: '⚡',
    details: { provider: 'openai', model: 'gpt-4o', features: ['tools', 'streaming'] },
    enabled: false
  },
  {
    id: 'kimi',
    name: 'KIMI',
    description: 'Moonshot AI KIMI CLI',
    icon: '🌙',
    details: { provider: 'kimi', model: 'k1.6', features: ['tools', 'streaming'] },
    enabled: false
  }
];
```

### 5.2 Update HarnessSelector Component

File: `kimi-ide-client/src/components/HarnessSelector/index.tsx`

Should already fetch from `/api/harnesses` and show installation status.

**Verify it handles:**
- ✅ Installed harnesses (selectable)
- ✅ Not installed harnesses (show install command)
- ✅ Built-in vs external distinction

---

## 6. END-TO-END TESTING

### 6.1 Test Checklist

```bash
# 1. Verify all harnesses registered
curl http://localhost:3000/api/harnesses | jq '.'

# 2. Test Gemini (should work end-to-end)
# - Select Gemini in UI
# - Send message
# - Verify response appears
# - Verify SQLite has exchange row

# 3. Test Qwen
# - Same flow, verify thinking blocks appear

# 4. Test Claude Code
# - Same flow, verify thinking appears

# 5. Test Codex
# - Same flow after installing Codex CLI
```

### 6.2 Verification Queries

```sql
-- Check SQLite persistence:
SELECT id, user_input, assistant FROM exchanges ORDER BY id DESC LIMIT 5;

-- Verify assistant JSON has parts array:
-- {"parts": [{"type": "text", "content": "..."}, ...]}
```

---

## 7. FILE REFERENCE

### 7.1 Files to Modify (This Session)

```
lib/harness/clis/gemini/index.js         ← Add event bus bridge
lib/harness/clis/qwen/index.js           ← Add event bus bridge
lib/harness/clis/claude-code/index.js    ← Add event bus bridge
lib/harness/clis/codex/index.js          ← Add event bus bridge
kimi-ide-client/src/config/harness.ts    ← Add all harness options
```

### 7.2 Files to Reference (Read-Only)

```
lib/harness/clis/gemini/acp-event-translator.js    ← See how events are emitted
lib/harness/clis/gemini/session-state.js          ← See parts accumulation
lib/event-bus.js                                   ← Shared event bus API
lib/audit/subscriber.js                            ← See what it expects
specs/HARNESS-IMPLEMENTATION-GUIDE.md              ← Lessons learned
```

---

## 8. COMMON PITFALLS

### 8.1 Don't Forget the Import

```javascript
// REQUIRED in each harness index.js:
const { emit } = require('../../event-bus');
```

### 8.2 Parts Array Shape

Must match exactly:
```javascript
// For text:
{ type: 'text', content: 'string' }

// For thinking:
{ type: 'think', content: 'string' }

// For tool calls:
{ type: 'tool_call', toolCallId: 'string', name: 'string', arguments: {...}, result: {...} }
```

### 8.3 Timing

Emit `chat:turn_end` ONLY when you have the full `assistantParts` array accumulated from the entire turn.

---

## 9. SUCCESS CRITERIA

- [ ] All 6 harnesses appear in `/api/harnesses`
- [ ] Gemini sends message → appears in UI → persists to SQLite
- [ ] Qwen sends message → thinking blocks appear → persists to SQLite
- [ ] Claude Code sends message → thinking appears → persists to SQLite
- [ ] UI shows all harness options with installation status
- [ ] User can select any harness and start conversation

---

## 10. CONTEXT SUMMARY

### What We've Built
1. ✅ BaseCLIHarness - Foundation for all CLI harnesses
2. ✅ 4 ACP harnesses (Gemini, Qwen, Claude, Codex) with JSON-RPC parsing
3. ✅ Registry with installation checking
4. ✅ `/api/harnesses` endpoint

### What This Spec Adds
1. ❌ Event bus bridge (harness internal → shared chat:* events)
2. ❌ Parts array accumulation for SQLite
3. ❌ UI config for all harnesses
4. ❌ End-to-end verification

### The Gap
Harnesses emit `event` internally but don't bridge to `chat:*` events that the audit subscriber listens for.

**Fix:** Add bridge code in each harness's `startThread()` method.

---

**Next Action:** Implement event bus bridge in `lib/harness/clis/gemini/index.js` first (reference implementation), then copy pattern to Qwen, Claude, and Codex.
