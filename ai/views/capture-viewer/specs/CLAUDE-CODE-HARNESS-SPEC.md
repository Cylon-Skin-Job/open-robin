# Claude Code Harness Specification

**Status:** Draft  
**Version:** 1.0  
**Date:** 2026-04-05  
**Prerequisites:** BaseCLIHarness (complete), HarnessRegistry (complete), GeminiHarness (reference ACP impl)

---

## 🚨 CRITICAL: This Spec Follows HARNESS-IMPLEMENTATION-GUIDE.md

This specification was written AFTER the QwenHarness lessons-learned document. It includes:
- ✅ Full ACP protocol documentation
- ✅ Complete initialization handshake
- ✅ Multi-turn session/prompt flow
- ✅ Event bus bridge (chat:* events)
- ✅ Parts accumulation for SQLite
- ✅ Live wire protocol verification

---

## 1. PROTOCOL DISCOVERY

### 1.1 Does Claude Code Support ACP?

**YES.** Claude Code supports ACP via `--acp` flag (as of version 2.1.92).

**Evidence:**
- Zed IDE has native Claude Code ACP support (added Sept 2025)
- ACP Registry lists Claude Code: https://zed.dev/acp
- CLI accepts `--acp` flag

### 1.2 Protocol Type

| Aspect | Value |
|--------|-------|
| **Protocol** | ACP (Agent Client Protocol) |
| **Transport** | JSON-RPC 2.0 over stdio |
| **Mode** | Persistent subprocess (multi-turn) |
| **Init flag** | `--acp` |

### 1.3 Comparison to Gemini ACP

| Aspect | Gemini | Claude Code | Notes |
|--------|--------|-------------|-------|
| Binary | `gemini` | `claude` | Different CLI name |
| Init flag | `--acp` | `--acp` | Same |
| Protocol | ACP JSON-RPC | ACP JSON-RPC | Identical wire format |
| Thinking | ❌ Not exposed | ✅ **Exposed via ACP** | Major difference |
| Tool handling | Internal | Internal | Same pattern |
| Auth | API key | OAuth + API key | More options |

**Conclusion:** Claude Code ACP is wire-protocol compatible with Gemini ACP. Reuse parser/translator patterns, customize for thinking exposure.

---

## 2. WIRE PROTOCOL

### 2.1 CLI Invocation

```bash
claude \
  --acp \
  --approval-mode auto \
  [--model sonnet|opus|haiku]
```

**Flags:**
- `--acp`: Enable ACP mode (REQUIRED)
- `--approval-mode auto|acceptEdits|plan`: Permission mode
- `--model`: Model selection (sonnet, opus, haiku)

### 2.2 Requests (Client → CLI, stdin)

| Message | JSON-RPC Method | Required Params | ID |
|---------|-----------------|-----------------|-----|
| Initialize | `initialize` | `protocolVersion`, `clientInfo` | 1 |
| New Session | `session/new` | `cwd`, optional `mcpServers` | 2 |
| Send Prompt | `session/prompt` | `sessionId`, `prompt` (array) | 3, 4, 5... |

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

**Session/New Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "session/new",
  "params": {
    "cwd": "/project/path",
    "mcpServers": []
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
      {"type": "text", "text": "Explain recursion"}
    ]
  }
}
```

### 2.3 Responses (CLI → Client, stdout)

| Message | Classification | Key Fields |
|---------|---------------|------------|
| Initialize response | Response (`id: 1`) | `protocolVersion`, `agentInfo`, `authMethods` |
| Session/New response | Response (`id: 2`) | `sessionId`, `models`, `modes`, `configOptions` |
| Session/Prompt response | Response (`id: N`) | `stopReason`, `_meta.usage` |
| Error response | Response (`id: N`) | `error.code`, `error.message` |

**Session/New Response (CRITICAL - contains sessionId):**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "sessionId": "sess-550e8400-e29b-41d4-a716-446655440000",
    "modes": {
      "availableModes": ["default", "autoEdit", "plan"],
      "currentModeId": "auto"
    },
    "models": {
      "availableModels": ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-6"],
      "currentModelId": "claude-sonnet-4-6"
    },
    "configOptions": []
  }
}
```

**Session/Prompt Response (at turn end):**
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "stopReason": "end_turn",
    "_meta": {
      "usage": {
        "inputTokens": 1245,
        "outputTokens": 342,
        "totalTokens": 1587
      }
    }
  }
}
```

### 2.4 Notifications (CLI → Client, stdout, NO id)

| Method | `params.update.sessionUpdate` | Purpose |
|--------|------------------------------|---------|
| `session/update` | `agent_thought_chunk` | **Thinking/reasoning** |
| `session/update` | `agent_message_chunk` | Response text |
| `session/update` | `tool_call` | Tool invocation |
| `session/update` | `tool_call_update` | Tool result |
| `session/update` | `available_commands_update` | Slash commands |

**Thinking Notification (Claude exposes this!):**
```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "sess-550e8400...",
    "update": {
      "sessionUpdate": "agent_thought_chunk",
      "content": {
        "type": "text",
        "text": "I need to explain recursion by first defining the base case..."
      }
    }
  }
}
```

**Message Chunk Notification:**
```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "sess-550e8400...",
    "update": {
      "sessionUpdate": "agent_message_chunk",
      "content": {
        "type": "text",
        "text": "Recursion is a programming concept where..."
      }
    }
  }
}
```

**Tool Call Notification:**
```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "sess-550e8400...",
    "update": {
      "sessionUpdate": "tool_call",
      "toolCallId": "toolu-01AbCdEfGhIjKlMnOpQrStUv",
      "toolName": "Bash",
      "title": "ls -la",
      "kind": "terminal",
      "rawInput": "{\"command\": \"ls -la\", \"description\": \"List files\"}"
    }
  }
}
```

---

## 3. INITIALIZATION HANDSHAKE

### 3.1 Required Sequence

```
Step 1 → stdin:  {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientInfo":{"name":"kimi-ide","version":"1.0.0"}}}
Step 2 ← stdout: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentInfo":{"name":"claude-code","version":"2.1.92"},...}}

Step 3 → stdin:  {"jsonrpc":"2.0","id":2,"method":"session/new","params":{"cwd":"/project/path"}}
Step 4 ← stdout: {"jsonrpc":"2.0","id":2,"result":{"sessionId":"sess-550e8400...","models":...}}

Step 5 ← stdout: {"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"available_commands_update",...}}}

READY FOR PROMPTS
```

### 3.2 Implementation Code

```javascript
async initialize(config) {
  await super.initialize(config);
  
  // Step 1: Send initialize
  this.sendJsonRpc(1, 'initialize', {
    protocolVersion: 1,
    clientInfo: { name: 'kimi-ide', version: '1.0.0' }
  });
  
  // Wait for initialize response...
  await this.waitForResponse(1);
  
  // Step 2: Create session
  this.sendJsonRpc(2, 'session/new', {
    cwd: this.projectRoot,
    mcpServers: []
  });
  
  // Wait for session/new response...
  const sessionResponse = await this.waitForResponse(2);
  this.sessionId = sessionResponse.result.sessionId; // CRITICAL
}

sendJsonRpc(id, method, params) {
  const msg = { jsonrpc: '2.0', id, method, params };
  this.process.stdin.write(JSON.stringify(msg) + '\n');
}
```

---

## 4. MULTI-TURN CONVERSATION

### 4.1 How Follow-Ups Work

After initialization, send additional `session/prompt` messages with the **same sessionId**:

```
Turn 1:
→ session/prompt (id: 3, sessionId: "sess-550e8400...")
← agent_thought_chunk
← agent_message_chunk
← {id: 3, result: {stopReason: "end_turn"}}

Turn 2:
→ session/prompt (id: 4, sessionId: "sess-550e8400...")  ← SAME session
← agent_thought_chunk
← agent_message_chunk
← {id: 4, result: {stopReason: "end_turn"}}
```

### 4.2 Resume Behavior

Claude Code ACP maintains conversation context automatically within a session. The CLI process stays alive and tracks history.

**For resume after disconnect:**
- Option 1: Keep process alive, reuse same sessionId
- Option 2: Store conversation history, send as context in new session

---

## 5. CANONICAL EVENT MAPPING

### 5.1 ACP → Canonical Translation

| ACP Notification | `sessionUpdate` | Canonical Event | Notes |
|-----------------|-----------------|-----------------|-------|
| `session/new` response | N/A | `turn_begin` | Session started |
| `session/update` | `agent_thought_chunk` | `thinking` | **Claude exposes thinking** |
| `session/update` | `agent_message_chunk` | `content` | Response text |
| `session/update` | `tool_call` | `tool_call` + `tool_call_args` | Tool invocation |
| `session/update` | `tool_call_update` | `tool_result` | Tool completion |
| `session/prompt` response | N/A | `turn_end` | Turn complete |

### 5.2 Thinking Mapping (Claude-Specific)

```javascript
// ACP Input:
{
  "method": "session/update",
  "params": {
    "update": {
      "sessionUpdate": "agent_thought_chunk",
      "content": { "type": "text", "text": "Analyzing..." }
    }
  }
}

// Canonical Output:
{
  "type": "thinking",
  "timestamp": 1775440000000,
  "text": "Analyzing...",
  "turnId": "turn-abc123"
}
```

### 5.3 Tool Call Mapping

```javascript
// ACP Input:
{
  "method": "session/update",
  "params": {
    "update": {
      "sessionUpdate": "tool_call",
      "toolCallId": "toolu-01AbCd...",
      "toolName": "Bash",
      "rawInput": "{\"command\": \"ls\", \"description\": \"List\"}"
    }
  }
}

// Canonical Events (2):
{ "type": "tool_call", "toolCallId": "toolu-01AbCd...", "toolName": "shell" }
{ "type": "tool_call_args", "toolCallId": "toolu-01AbCd...", "argsChunk": "{\"command\": \"ls\"}" }
```

---

## 6. EVENT BUS BRIDGE

### 6.1 Required chat:* Events

The harness MUST emit to the shared event bus:

| Event | When to Emit | Required Fields |
|-------|--------------|-----------------|
| `chat:turn_begin` | After `session/new` response | `workspace`, `threadId`, `turnId` |
| `chat:content` | Per `agent_message_chunk` | `threadId`, `content` |
| `chat:thinking` | Per `agent_thought_chunk` | `threadId`, `content` |
| `chat:tool_call` | Per `tool_call` | `threadId`, `toolCallId`, `name`, `arguments` |
| `chat:tool_result` | Per `tool_call_update` | `threadId`, `toolCallId`, `output`, `isError` |
| `chat:turn_end` | On `session/prompt` response | `workspace`, `threadId`, `turnId`, `userInput`, `parts`, `fullText` |
| `chat:status_update` | On token usage | `threadId`, `tokenUsage` |

### 6.2 chat:turn_end Implementation

```javascript
// At session/prompt response:
emit('chat:turn_end', {
  workspace: 'code-viewer',
  threadId: this.threadId,
  turnId: this.currentTurnId,
  userInput: this.sessionState.userInput,
  parts: this.sessionState.assistantParts,  // CRITICAL: accumulated array
  fullText: this.sessionState.accumulatedText,
  hasToolCalls: this.sessionState.hasToolCalls,
});

// Emit status for audit:
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

### 7.1 Parts Array Structure

The `assistantParts` array accumulates during a turn:

```javascript
[
  { type: 'think', content: 'I need to analyze...' },
  { type: 'text', content: 'Here is the analysis:' },
  { type: 'tool_call', toolCallId: 'toolu-01...', name: 'Bash', arguments: {...}, result: {...} },
  { type: 'text', content: 'Based on the output...' }
]
```

### 7.2 Accumulation Logic

```javascript
class ClaudeSessionState {
  constructor() {
    this.assistantParts = [];
    this.accumulatedText = '';
    this.hasToolCalls = false;
    this.pendingToolCalls = new Map();
  }

  addThought(text) {
    this.assistantParts.push({ type: 'think', content: text });
  }

  addText(text) {
    this.assistantParts.push({ type: 'text', content: text });
    this.accumulatedText += text;
  }

  startToolCall(id, name, args) {
    this.hasToolCalls = true;
    this.pendingToolCalls.set(id, {
      type: 'tool_call',
      toolCallId: id,
      name: mapToolName(name),
      arguments: args,
      result: null
    });
  }

  completeToolCall(id, output, isError) {
    const tool = this.pendingToolCalls.get(id);
    if (tool) {
      tool.result = { output, isError, display: [], files: [] };
      this.assistantParts.push(tool);
      this.pendingToolCalls.delete(id);
    }
  }
}
```

---

## 8. SESSION ID TRACKING

### 8.1 Source of Truth

```javascript
// From session/new RESPONSE (id: 2):
const sessionId = response.result.sessionId;

// Use for ALL subsequent session/prompt calls:
this.sendJsonRpc(3, 'session/prompt', {
  sessionId: sessionId,  // ← From session/new, NOT hardcoded
  prompt: [...]
});
```

### 8.2 Storage

Store in harness session state:
```javascript
this.sessionState = {
  sessionId: null,  // Set from session/new response
  threadId: threadId,
  // ...
};
```

---

## 9. TOKEN USAGE

### 9.1 Location

Token usage appears in `_meta.usage` of the **final notification before turn end**:

```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "update": {
      "sessionUpdate": "agent_message_chunk",
      "content": { "type": "text", "text": "" },
      "_meta": {
        "usage": {
          "inputTokens": 1245,
          "outputTokens": 342,
          "totalTokens": 1587
        }
      }
    }
  }
}
```

### 9.2 Extraction

```javascript
if (msg.params.update._meta?.usage) {
  const usage = msg.params.update._meta.usage;
  this.sessionState.inputTokens = usage.inputTokens;
  this.sessionState.outputTokens = usage.outputTokens;
}
```

---

## 10. TOOL NAME MAPPING

### 10.1 Claude Tool Names → Canonical

| Claude Tool | Canonical | Notes |
|-------------|-----------|-------|
| `Bash` | `shell` | Shell commands |
| `Read` | `read` | Read file |
| `Edit` | `edit` | Edit file |
| `Write` | `write` | Write file |
| `Glob` | `glob` | File glob |
| `Grep` | `grep` | Content search |
| `WebSearch` | `web_search` | Web search |
| `WebFetch` | `fetch` | Fetch URL |
| `Task` | `subagent` | Subagent delegation |
| `TodoWrite` | `todo` | Task tracking |

---

## 11. ARCHITECTURE

### 11.1 File Structure

```
lib/harness/clis/claude-code/
├── index.js                 # ClaudeCodeHarness class
├── acp-wire-parser.js       # JSON-RPC parser (reuse Gemini's)
├── acp-event-translator.js  # ACP → Canonical
├── session-state.js         # Assistant parts accumulation
├── tool-mapper.js           # Tool name mappings
└── __tests__/
    ├── acp-wire-parser.test.js
    ├── acp-event-translator.test.js
    └── integration.test.js
```

### 11.2 Class Hierarchy

```
BaseCLIHarness
    └── ClaudeCodeHarness
        ├── AcpWireParser (shared with Gemini)
        ├── AcpEventTranslator (custom for Claude thinking)
        ├── ClaudeSessionState (custom)
        └── ToolMapper (custom mappings)
```

---

## 12. TESTING

### 12.1 Live Test Checklist

- [ ] Spawn: `claude --acp --approval-mode auto`
- [ ] Send initialize, verify response
- [ ] Send session/new, capture sessionId
- [ ] Send session/prompt, verify thinking chunks appear
- [ ] Verify tool calls emit correct events
- [ ] Send second session/prompt, verify multi-turn works
- [ ] Verify token usage in _meta

### 12.2 Expected Test Output

```
→ initialize
← {id: 1, result: {...}}
→ session/new
← {id: 2, result: {sessionId: "sess-xxx"}}
→ session/prompt "What is recursion?"
← {method: session/update, params: {update: {sessionUpdate: agent_thought_chunk, ...}}}  ← THINKING
← {method: session/update, params: {update: {sessionUpdate: agent_message_chunk, ...}}}
← {id: 3, result: {stopReason: end_turn}}
```

---

## 13. KEY DIFFERENCES FROM GEMINI

| Aspect | Gemini | Claude Code |
|--------|--------|-------------|
| Binary | `gemini` | `claude` |
| Thinking | ❌ Not exposed | ✅ **Exposed via ACP** |
| Tool names | `list_directory` | `Bash`, `Read`, `Edit` |
| Auth | API key | OAuth + API key |
| Default model | `auto-gemini-3` | `claude-sonnet-4-6` |

---

**End of Specification**
