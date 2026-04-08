# Gemini CLI Harness Specification

**Status:** Draft  
**Version:** 1.0  
**Date:** 2026-04-05  
**Prerequisites:** BaseCLIHarness (complete), HarnessRegistry (complete)

---

## 1. Executive Summary

This specification defines the **Gemini CLI Harness** - an external CLI harness implementation that wraps Google's Gemini CLI (`@google/gemini-cli`) and translates its wire protocol into the **canonical event format** used by the Kimi IDE unified chat interface.

### Purpose Within the Ecosystem

The harness system enables the Kimi IDE to support multiple AI backends through a modular architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│                     KIMI IDE (Unified UI)                       │
├─────────────────────────────────────────────────────────────────┤
│  Chat Panel ← Event Bus ← Canonical Events ← Harness Layer     │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
   ┌────▼────┐          ┌────▼────┐          ┌────▼────┐
   │  Robin  │          │  KIMI   │          │ Gemini  │
   │(Vercel) │          │  (CLI)  │          │  (CLI)  │
   └─────────┘          └─────────┘          └─────────┘
        │                     │                     │
   ┌────▼────┐          ┌────▼────┐          ┌────▼────┐
   │ Codex   │          │  Qwen   │          │ Claude  │
   │  (CLI)  │          │  (CLI)  │          │  (CLI)  │
   └─────────┘          └─────────┘          └─────────┘
```

Each harness:
1. **Spawns** its respective CLI as a subprocess
2. **Parses** the CLI's native wire protocol
3. **Translates** native events into **canonical events**
4. **Emits** standardized events through the Event Bus
5. **Handles** tool execution (either internally or delegating)

### Why Gemini First?

Gemini CLI was selected as the **second external CLI harness** (after Codex proof-of-concept) because:
- ✅ Cleanest wire protocol (simple NDJSON)
- ✅ No complex handshake required
- ✅ Well-documented output format
- ✅ Handles tool execution internally
- ✅ Consistent event structure

---

## 2. Gemini CLI Reference

### Installation
```bash
npm install -g @google/gemini-cli
```

### Binary Detection
- **Name:** `gemini`
- **Version Check:** `gemini --version` → `0.36.0`
- **Install Command:** `npm install -g @google/gemini-cli`

### Invocation for Headless Mode
```bash
gemini \
  --prompt "{user message}" \
  --output-format stream-json \
  --approval-mode yolo \
  [optional: --model gemini-2.5-flash]
```

**Flags:**
- `--prompt, -p`: Non-interactive mode with prompt text
- `--output-format stream-json`: NDJSON streaming output (REQUIRED)
- `--approval-mode yolo`: Auto-approve all tool calls
- `--model, -m`: Model selection (defaults to `auto-gemini-3`)
- `--yolo`: Alias for `--approval-mode yolo`

---

## 3. Wire Protocol Analysis

### Output Format: NDJSON (Newline-Delimited JSON)

Each line is a complete JSON object terminated by `\n`.

### Event Types

#### 1. Init Event
```json
{
  "type": "init",
  "timestamp": "2026-04-06T00:40:03.556Z",
  "session_id": "d5c83334-48c4-40cb-941e-c6ade6ee8c8a",
  "model": "auto-gemini-3"
}
```

#### 2. User Message Event
```json
{
  "type": "message",
  "timestamp": "2026-04-06T00:40:03.557Z",
  "role": "user",
  "content": "Say hello in exactly one word"
}
```

#### 3. Assistant Message Event (Streaming)
```json
{
  "type": "message",
  "timestamp": "2026-04-06T00:40:06.497Z",
  "role": "assistant",
  "content": "Hello",
  "delta": true
}
```

**Note on `delta`:** When `delta: true`, the `content` field contains only the **new tokens** since the last message. The harness must accumulate these into the full response.

#### 4. Result Event (Completion)
```json
{
  "type": "result",
  "timestamp": "2026-04-06T00:40:06.569Z",
  "status": "success",
  "stats": {
    "total_tokens": 10574,
    "input_tokens": 10364,
    "output_tokens": 33,
    "cached": 0,
    "duration_ms": 3014,
    "tool_calls": 0,
    "models": {
      "gemini-2.5-flash-lite": {
        "total_tokens": 2479,
        "input_tokens": 2296,
        "output_tokens": 32
      },
      "gemini-3-flash-preview": {
        "total_tokens": 8095,
        "input_tokens": 8068,
        "output_tokens": 1
      }
    }
  }
}
```

### Tool Execution Events

Gemini handles tool execution **internally** (similar to Claude Code). When tools are called, you'll see:

1. **Tool Call Indication** (within assistant message):
```json
{
  "type": "message",
  "role": "assistant",
  "content": "",
  "tool_calls": [
    {
      "name": "list_directory",
      "arguments": {"path": "."}
    }
  ]
}
```

2. **Tool Result** (user role with tool result):
```json
{
  "type": "message",
  "role": "user",
  "content": "AGENTS.md\narchive\ncomponents\n...",
  "tool_result": {
    "tool_call_id": "abc123",
    "name": "list_directory"
  }
}
```

**CRITICAL:** The exact tool call format in Gemini's output needs to be verified. The above is extrapolated from documentation - actual CLI testing required.

---

## 4. Canonical Event Mapping

### Design Philosophy

All CLI harnesses **MUST** translate their native events into a **unified canonical format**. This ensures:

1. **UI Consistency:** Chat panel displays all CLIs identically
2. **Feature Parity:** Tool calls, thinking blocks, streaming all work the same
3. **Interoperability:** Switch CLIs mid-conversation seamlessly
4. **Extensibility:** New CLIs integrate without UI changes

### Canonical Event Types

```typescript
// From lib/harness/types.js
type CanonicalEventType = 
  | 'turn_begin'      // Conversation turn started
  | 'content'         // Text content delta
  | 'thinking'        // Model reasoning/thinking
  | 'tool_call'       // Tool invocation started
  | 'tool_call_args'  // Tool arguments streaming
  | 'tool_result'     // Tool execution completed
  | 'turn_end';       // Conversation turn ended
```

### Gemini → Canonical Mapping

| Gemini Event | Canonical Event | Notes |
|--------------|-----------------|-------|
| `init` | `turn_begin` | Map `session_id` to `turnId` |
| `message` (user role) | — | User input confirmation (optional) |
| `message` (assistant, text) | `content` | Accumulate `delta` chunks |
| `message` (assistant, thinking) | `thinking` | **VERIFY:** Does Gemini expose thinking? |
| `message` (assistant, tool_calls) | `tool_call` + `tool_call_args` | Extract tool name & args |
| `message` (user, tool_result) | `tool_result` | Map tool output |
| `result` | `turn_end` | Include stats in `_meta` |

### Detailed Mapping Examples

#### 1. Content Streaming
```javascript
// Gemini input:
{ "type": "message", "role": "assistant", "content": "Hello", "delta": true }

// Canonical output:
{ 
  "type": "content", 
  "timestamp": 1775436000000,
  "text": "Hello",
  "turnId": "d5c83334-48c4-40cb-941e-c6ade6ee8c8a"
}
```

#### 2. Tool Call
```javascript
// Gemini input:
{ 
  "type": "message", 
  "role": "assistant",
  "tool_calls": [{
    "name": "list_directory",
    "arguments": {"path": "/project"}
  }]
}

// Canonical output (2 events):
{ 
  "type": "tool_call",
  "timestamp": 1775436000000,
  "toolCallId": "gemini-call-001",
  "toolName": "list",  // Mapped from list_directory
  "turnId": "d5c83334-48c4-40cb-941e-c6ade6ee8c8a"
}
{ 
  "type": "tool_call_args",
  "timestamp": 1775436000000,
  "toolCallId": "gemini-call-001",
  "argsChunk": "{\"path\":\"/project\"}",
  "turnId": "d5c83334-48c4-40cb-941e-c6ade6ee8c8a"
}
```

#### 3. Tool Result
```javascript
// Gemini input:
{
  "type": "message",
  "role": "user",
  "content": "file1.js\nfile2.js",
  "tool_result": {
    "tool_call_id": "gemini-call-001",
    "name": "list_directory"
  }
}

// Canonical output:
{
  "type": "tool_result",
  "timestamp": 1775436001000,
  "toolCallId": "gemini-call-001",
  "toolName": "list",
  "output": "file1.js\nfile2.js",
  "display": [{"type": "file", "path": "file1.js"}, {"type": "file", "path": "file2.js"}],
  "isError": false,
  "turnId": "d5c83334-48c4-40cb-941e-c6ade6ee8c8a"
}
```

#### 4. Turn End
```javascript
// Gemini input:
{
  "type": "result",
  "status": "success",
  "stats": {
    "total_tokens": 10574,
    "input_tokens": 10364,
    "output_tokens": 33,
    "duration_ms": 3014
  }
}

// Canonical output:
{
  "type": "turn_end",
  "timestamp": 1775436002000,
  "turnId": "d5c83334-48c4-40cb-941e-c6ade6ee8c8a",
  "fullText": "Hello",
  "hasToolCalls": false,
  "_meta": {
    "messageId": null,
    "tokenUsage": {
      "input_other": 10364,
      "output": 33
    },
    "contextUsage": null,
    "harnessId": "gemini",
    "provider": "google",
    "model": "auto-gemini-3",
    "duration_ms": 3014
  }
}
```

---

## 5. Tool Name Mapping

Gemini CLI tool names → Canonical tool names:

| Gemini Tool | Canonical | Notes |
|-------------|-----------|-------|
| `list_directory` | `list` | List files in directory |
| `read_file` | `read` | Read file contents |
| `write_file` | `write` | Write/create file |
| `edit_file` | `edit` | Edit existing file |
| `run_shell_command` | `shell` | Execute shell command |
| `search_files` | `glob` | File glob search |
| `grep_search` | `grep` | Content search |
| `web_search` | `web_search` | Web search |
| `web_fetch` | `fetch` | Fetch URL content |
| `ask_user_question` | `ask` | Ask user for input |

**Implementation:** Create `lib/harness/clis/gemini/tool-mapper.js` similar to existing tool mappers.

---

## 6. Architecture & File Structure

### New Files to Create

```
lib/harness/clis/gemini/
├── index.js              # GeminiHarness class
├── wire-parser.js        # NDJSON line parser
├── event-translator.js   # Gemini → Canonical mapping
├── tool-mapper.js        # Tool name mappings
└── __tests__/
    ├── wire-parser.test.js
    ├── event-translator.test.js
    └── tool-mapper.test.js
```

### Class Hierarchy

```
BaseCLIHarness (from ../base-cli-harness.js)
    │
    └── GeminiHarness (index.js)
        ├── WireParser (wire-parser.js)
        ├── EventTranslator (event-translator.js)
        └── ToolMapper (tool-mapper.js)
```

### Integration Points

1. **Registry Registration** (`lib/harness/registry.js`):
```javascript
const { GeminiHarness } = require('./clis/gemini');
this.register('gemini', new GeminiHarness(), {
  builtIn: false,
  description: 'Google Gemini CLI',
  installCommand: 'npm install -g @google/gemini-cli'
});
```

2. **UI Config** (`kimi-ide-client/src/config/harness.ts`):
```typescript
{
  id: 'gemini',
  name: 'Gemini',
  description: 'Google Gemini CLI with agentic capabilities',
  icon: '💎',
  details: {
    provider: 'google',
    model: 'gemini-2.5-flash',
    features: ['tools', 'streaming']
  },
  enabled: false
}
```

---

## 7. Implementation Details

### GeminiHarness Class

```javascript
class GeminiHarness extends BaseCLIHarness {
  constructor() {
    super({
      id: 'gemini',
      name: 'Gemini (Google)',
      cliName: 'gemini',
      provider: 'google'
    });
    this.defaultModel = 'gemini-2.5-flash';
  }

  getSpawnArgs(threadId, projectRoot) {
    return [
      '--prompt', this.pendingPrompt || 'Hello',
      '--output-format', 'stream-json',
      '--approval-mode', 'yolo',
      '--model', this.config.model || this.defaultModel
    ];
  }

  createWireParser() {
    return new GeminiWireParser();
  }

  translateMessage(msg) {
    // Delegate to EventTranslator
  }
}
```

### Handling Multi-Model Output

Gemini CLI may use multiple models (e.g., `gemini-2.5-flash-lite` + `gemini-3-flash-preview`). The `stats.models` field contains per-model breakdowns.

**Strategy:** Aggregate all model usage into single `tokenUsage` for canonical format, but preserve detailed breakdown in `_meta.models`.

### Session Management

Gemini CLI does NOT maintain persistent sessions via the wire protocol. Each invocation is **stateless**.

**Implication:** The harness must:
1. Spawn new process for each message
2. Maintain conversation history internally
3. Pass full history via `--prompt` or stdin (if supported)

**Research Needed:** Does Gemini CLI support multi-turn conversation via stdin streaming, or is it strictly single-prompt?

---

## 8. Testing Strategy

### Unit Tests

1. **Wire Parser:** Test NDJSON line splitting
2. **Event Translator:** Test each event type mapping
3. **Tool Mapper:** Test name conversions

### Integration Tests

```javascript
// Test script
const { registry } = require('./lib/harness');

async function testGemini() {
  const harness = registry.get('gemini');
  
  // Test installation check
  const installed = await harness.isInstalled();
  console.log('Installed:', installed);
  
  // Test version
  const version = await harness.getVersion();
  console.log('Version:', version);
  
  // Test single message
  const session = await harness.startThread('test-123', '/project');
  const events = [];
  
  for await (const event of session.sendMessage('Say hello')) {
    events.push(event);
    console.log('Event:', event.type);
  }
  
  // Verify canonical format
  assert(events.some(e => e.type === 'turn_begin'));
  assert(events.some(e => e.type === 'content'));
  assert(events.some(e => e.type === 'turn_end'));
}
```

### Manual Testing Checklist

- [ ] `isInstalled()` returns true when Gemini CLI installed
- [ ] `isInstalled()` returns false when not installed
- [ ] `getVersion()` returns correct version string
- [ ] Simple prompt returns `content` events
- [ ] Tool use triggers `tool_call` events
- [ ] Tool results trigger `tool_result` events
- [ ] `turn_end` includes usage stats
- [ ] UI shows Gemini as option
- [ ] Selecting Gemini spawns correct process
- [ ] Chat displays Gemini responses correctly

---

## 9. Open Questions & Research

### Critical Unknowns

1. **Multi-turn Support:** Does Gemini CLI support conversation history via stdin, or is it single-prompt only?

2. **Thinking Blocks:** Does Gemini expose thinking/reasoning content in stream-json mode?

3. **Tool Call Format:** Exact structure of `tool_calls` in assistant messages needs verification.

4. **Error Handling:** What does error output look like? (e.g., rate limits, auth failures)

### Research Commands

```bash
# Test basic streaming
gemini -p "Hello" --output-format stream-json

# Test with tools
gemini -p "List files in current directory" --output-format stream-json --approval-mode yolo

# Test error case (no auth)
unset GEMINI_API_KEY
gemini -p "Hello" --output-format stream-json

# Check if multi-turn supported
echo -e "Hello\nHow are you?" | gemini --output-format stream-json
```

---

## 10. Success Criteria

- [ ] `GeminiHarness` extends `BaseCLIHarness`
- [ ] Spawns `gemini` CLI with correct arguments
- [ ] Parses NDJSON output without errors
- [ ] Emits all canonical event types correctly
- [ ] Tool calls map to canonical names
- [ ] Token usage extracted from `result.stats`
- [ ] Appears in `/api/harnesses` with installation status
- [ ] UI displays Gemini option with install command
- [ ] End-to-end chat flow works

---

## 11. Related Specifications

- **BaseCLIHarness:** `lib/harness/clis/base-cli-harness.js`
- **HarnessRegistry:** `lib/harness/registry.js`
- **Canonical Events:** `lib/harness/types.js`
- **UI Config:** `kimi-ide-client/src/config/harness.ts`
- **Codex Harness:** `lib/harness/clis/codex/` (reference implementation)
- **KIMI Harness:** `lib/harness/kimi/` (reference for event translation)

---

## 12. Appendices

### Appendix A: Sample Full Conversation

```jsonl
{"type":"init","timestamp":"2026-04-06T00:40:03.556Z","session_id":"d5c83334-48c4-40cb-941e-c6ade6ee8c8a","model":"auto-gemini-3"}
{"type":"message","timestamp":"2026-04-06T00:40:03.557Z","role":"user","content":"Say hello in exactly one word"}
{"type":"message","timestamp":"2026-04-06T00:40:06.497Z","role":"assistant","content":"Hello","delta":true}
{"type":"result","timestamp":"2026-04-06T00:40:06.569Z","status":"success","stats":{"total_tokens":10574,"input_tokens":10364,"output_tokens":33,"duration_ms":3014}}
```

### Appendix B: Comparison with Other CLIs

| Feature | Gemini | Codex | Claude | Qwen |
|---------|--------|-------|--------|------|
| Protocol | NDJSON | JSON-RPC | NDJSON | NDJSON |
| Handshake | No | Yes | No | No |
| Tool Handling | Internal | Internal | Internal | Internal |
| Thinking Blocks | ? | No | Yes | Yes |
| Multi-model | Yes | No | No | No |

---

*This specification ensures Gemini CLI integrates seamlessly into the unified harness ecosystem while maintaining consistent user experience across all AI backends.*
