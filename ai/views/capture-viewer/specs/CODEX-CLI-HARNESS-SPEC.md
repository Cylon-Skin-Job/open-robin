# Codex CLI Harness Specification

**Status:** Draft  
**Version:** 1.0  
**Date:** 2026-04-05  
**Prerequisites:** BaseCLIHarness (complete), GeminiHarness (reference ACP impl)

---

## 🚨 CRITICAL: This Spec Follows HARNESS-IMPLEMENTATION-GUIDE.md

This specification includes:
- ✅ Full protocol discovery (Codex has TWO modes)
- ✅ ACP protocol documentation
- ✅ Complete initialization handshake
- ✅ Multi-turn session/prompt flow
- ✅ Event bus bridge (chat:* events)
- ✅ Parts accumulation for SQLite

---

## 1. PROTOCOL DISCOVERY

### 1.1 Does Codex Support ACP?

**YES, via adapter.** Codex doesn't have native `--acp` flag like Gemini/Claude, but Zed created a **codex-acp adapter** that wraps Codex's app-server protocol into ACP.

**Evidence:**
- Zed's October 2025 blog: "Codex is Live in Zed" via ACP adapter
- ACP Registry lists Codex CLI
- Adapter available: `codex app-server` wrapped to ACP

### 1.2 Two Protocol Options

| Mode | Protocol | Use Case |
|------|----------|----------|
| **Direct** | Codex app-server (custom JSON-RPC) | Full control, no adapter needed |
| **ACP** | Via Zed's codex-acp adapter | Standard ACP, easier integration |

**Recommendation:** Use **ACP mode** for consistency with other harnesses. The adapter handles Codex quirks.

### 1.3 How Codex ACP Works

```
Kimi IDE → codex-acp adapter → codex app-server → OpenAI API
                ↑
           (translates between
            ACP and Codex protocol)
```

### 1.4 Comparison to Gemini/Claude ACP

| Aspect | Gemini/Claude | Codex via ACP |
|--------|---------------|---------------|
| Binary | `gemini` / `claude` | `codex-acp` (adapter) |
| Native ACP | ✅ Yes | ❌ Via adapter |
| Protocol | ACP JSON-RPC | ACP JSON-RPC (translated) |
| Thinking | Claude: ✅, Gemini: ❌ | Unknown (test needed) |
| Multi-turn | ✅ Yes | ✅ Yes |

---

## 2. WIRE PROTOCOL

### 2.1 CLI Invocation (ACP Mode)

```bash
# Via Zed's adapter (recommended)
codex-acp \
  --mode full-auto \
  --model gpt-4o

# Or direct app-server (if not using adapter)
codex app-server --listen stdio://
```

**Note:** If codex-acp adapter not available, Codex can be used via direct `app-server` protocol (documented in section 8).

### 2.2 Requests (Client → CLI, stdin)

Same ACP format as Gemini/Claude:

| Message | JSON-RPC Method | Required Params | ID |
|---------|-----------------|-----------------|-----|
| Initialize | `initialize` | `protocolVersion`, `clientInfo` | 1 |
| New Session | `session/new` | `cwd` | 2 |
| Send Prompt | `session/prompt` | `sessionId`, `prompt` | 3+ |

**Initialize Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": 1,
    "clientInfo": {
      "name": "kimi-ide",
      "version": "1.0.0"
    }
  }
}
```

**Session/Prompt Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "session/prompt",
  "params": {
    "sessionId": "sess-uuid-from-session-new",
    "prompt": [
      {"type": "text", "text": "Write a Python function"}
    ]
  }
}
```

### 2.3 Responses (CLI → Client, stdout)

**Session/New Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "sessionId": "sess-019d6038-5a7a-7de1-ae3d-24208d81678b",
    "models": {
      "availableModels": ["gpt-4o", "gpt-4o-mini"],
      "currentModelId": "gpt-4o"
    },
    "modes": {
      "availableModes": ["full-auto", "suggest"],
      "currentModeId": "full-auto"
    }
  }
}
```

**Session/Prompt Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "stopReason": "end_turn",
    "_meta": {
      "usage": {
        "inputTokens": 2034,
        "outputTokens": 156,
        "totalTokens": 2190
      }
    }
  }
}
```

### 2.4 Notifications (CLI → Client, NO id)

| Method | `params.update.sessionUpdate` | Purpose |
|--------|------------------------------|---------|
| `session/update` | `agent_message_chunk` | Response text |
| `session/update` | `agent_thought_chunk` | Thinking (verify if present) |
| `session/update` | `tool_call` | Tool invocation |
| `session/update` | `tool_call_update` | Tool result |

**Message Chunk:**
```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "sess-019d6038...",
    "update": {
      "sessionUpdate": "agent_message_chunk",
      "content": {"type": "text", "text": "Here's the function:"}
    }
  }
}
```

**Tool Call:**
```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "sess-019d6038...",
    "update": {
      "sessionUpdate": "tool_call",
      "toolCallId": "call-abc123",
      "toolName": "readFile",
      "rawInput": "{\"file_path\": \"main.py\"}"
    }
  }
}
```

---

## 3. INITIALIZATION HANDSHAKE

### 3.1 Required Sequence

```
Step 1 → stdin:  {"jsonrpc":"2.0","id":1,"method":"initialize",...}
Step 2 ← stdout: {"jsonrpc":"2.0","id":1,"result":{...}}

Step 3 → stdin:  {"jsonrpc":"2.0","id":2,"method":"session/new","params":{"cwd":"/project"}}
Step 4 ← stdout: {"jsonrpc":"2.0","id":2,"result":{"sessionId":"sess-019d6038...",...}}

Step 5 ← stdout: {"jsonrpc":"2.0","method":"session/update",...}  (available_commands)

READY
```

### 3.2 Implementation

```javascript
async initialize(config) {
  await super.initialize(config);
  
  // Initialize
  this.sendJsonRpc(1, 'initialize', {
    protocolVersion: 1,
    clientInfo: { name: 'kimi-ide', version: '1.0.0' }
  });
  await this.waitForResponse(1);
  
  // Create session
  this.sendJsonRpc(2, 'session/new', {
    cwd: this.projectRoot
  });
  const response = await this.waitForResponse(2);
  this.sessionId = response.result.sessionId; // CRITICAL
}
```

---

## 4. MULTI-TURN CONVERSATION

### 4.1 How Follow-Ups Work

Same pattern as Gemini/Claude:

```
Turn 1:
→ session/prompt (id: 3, sessionId: "sess-019d6038...")
← agent_message_chunk, tool_call, tool_call_update...
← {id: 3, result: {stopReason: "end_turn"}}

Turn 2:
→ session/prompt (id: 4, sessionId: "sess-019d6038...")
← ...
```

---

## 5. CANONICAL EVENT MAPPING

### 5.1 ACP → Canonical

| ACP | `sessionUpdate` | Canonical |
|-----|-----------------|-----------|
| `session/new` response | - | `turn_begin` |
| `session/update` | `agent_thought_chunk` | `thinking` (verify exists) |
| `session/update` | `agent_message_chunk` | `content` |
| `session/update` | `tool_call` | `tool_call` + `tool_call_args` |
| `session/update` | `tool_call_update` | `tool_result` |
| `session/prompt` response | - | `turn_end` |

### 5.2 Tool Call Mapping

Codex uses different tool names than Gemini:

| Codex Tool | Canonical |
|------------|-----------|
| `readFile` | `read` |
| `writeFile` | `write` |
| `editFile` | `edit` |
| `runCommand` | `shell` |
| `searchFiles` | `glob` |
| `grepSearch` | `grep` |

---

## 6. EVENT BUS BRIDGE

### 6.1 Required chat:* Events

Same as other ACP harnesses:

```javascript
// At turn end:
emit('chat:turn_end', {
  workspace: 'code-viewer',
  threadId: this.threadId,
  turnId: this.currentTurnId,
  userInput: this.sessionState.userInput,
  parts: this.sessionState.assistantParts,
  fullText: this.sessionState.accumulatedText,
  hasToolCalls: this.sessionState.hasToolCalls,
});

emit('chat:status_update', {
  threadId: this.threadId,
  tokenUsage: {
    input_other: this.sessionState.inputTokens,
    output: this.sessionState.outputTokens,
  },
});
```

---

## 7. ASSISTANT PARTS ACCUMULATION

### 7.1 Parts Array

```javascript
[
  { type: 'text', content: 'Here is the code:' },
  { type: 'tool_call', toolCallId: 'call-abc', name: 'readFile', ... },
  { type: 'text', content: 'Now let me explain...' }
]
```

### 7.2 Accumulation Logic

Same pattern as Gemini/Claude harnesses:

```javascript
class CodexSessionState {
  constructor() {
    this.assistantParts = [];
    this.accumulatedText = '';
    this.hasToolCalls = false;
  }

  addText(text) {
    this.assistantParts.push({ type: 'text', content: text });
    this.accumulatedText += text;
  }

  startToolCall(id, name, args) {
    this.hasToolCalls = true;
    // ...
  }
}
```

---

## 8. DIRECT APP-SERVER MODE (Alternative)

If ACP adapter unavailable, Codex can be used directly via `app-server`:

### 8.1 Invocation

```bash
codex app-server --listen stdio://
```

### 8.2 Protocol Differences

| Aspect | ACP (via adapter) | Direct app-server |
|--------|-------------------|-------------------|
| Protocol | JSON-RPC 2.0 | JSON-RPC 2.0 (no "jsonrpc" field) |
| Init method | `initialize` | `initialize` |
| Session method | `session/new` | `thread/start` |
| Prompt method | `session/prompt` | `turn/start` |
| Streaming | `session/update` | `item/*` notifications |

### 8.3 Direct Protocol Example

```json
// Request (no "jsonrpc":"2.0" field!)
{"method": "initialize", "id": 1, "params": {...}}

// Response
{"id": 1, "result": {...}}

// Notification
{"method": "item/agentMessage/delta", "params": {...}}
```

**Note:** Direct mode uses **Codex-native protocol**, not ACP. Requires custom translator.

---

## 9. SESSION ID & TOKEN USAGE

### 9.1 Session ID Source

From `session/new` response: `result.sessionId`

### 9.2 Token Usage Location

From `_meta.usage` in final notification or prompt response.

---

## 10. ARCHITECTURE

### 10.1 File Structure

```
lib/harness/clis/codex/
├── index.js                 # CodexHarness class
├── acp-wire-parser.js       # JSON-RPC parser
├── acp-event-translator.js  # ACP → Canonical
├── session-state.js         # Parts accumulation
├── tool-mapper.js           # Codex tool names
└── __tests__/
```

### 10.2 Implementation Approach

**Option A: ACP Mode (Recommended)**
- Requires: `codex-acp` adapter installed
- Pros: Same code pattern as Gemini/Claude
- Cons: Extra dependency

**Option B: Direct Mode**
- Uses: `codex app-server` directly
- Pros: No adapter needed
- Cons: Custom protocol, more code

---

## 11. TESTING

### 11.1 Live Test Checklist

- [ ] Verify codex-acp adapter available OR use direct mode
- [ ] Spawn with ACP flags
- [ ] Send initialize → session/new → session/prompt
- [ ] Verify tool calls work
- [ ] Verify multi-turn works
- [ ] Check if thinking chunks appear (unknown)

### 11.2 Open Questions

1. **Thinking exposure:** Does Codex emit `agent_thought_chunk` via ACP? (Test needed)
2. **Adapter availability:** Is codex-acp packaged with Zed or standalone?
3. **Direct mode viability:** Should we implement direct app-server as fallback?

---

## 12. KEY DIFFERENCES SUMMARY

| Aspect | Gemini | Claude | Codex |
|--------|--------|--------|-------|
| Native ACP | ✅ | ✅ | ❌ (via adapter) |
| Binary | `gemini` | `claude` | `codex-acp` or `codex` |
| Thinking | ❌ | ✅ | ? (test needed) |
| Tool names | `list_directory` | `Bash` | `readFile` |
| Model | `auto-gemini-3` | `claude-sonnet` | `gpt-4o` |

---

**End of Specification**
