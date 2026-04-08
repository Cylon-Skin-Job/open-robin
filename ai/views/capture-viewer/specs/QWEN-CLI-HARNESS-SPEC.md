# Qwen CLI Harness Specification

**Status:** Draft  
**Version:** 1.1  
**Date:** 2026-04-05  
**Prerequisites:** BaseCLIHarness (complete), GeminiHarness (parallel development)

---

## 🚨 CRITICAL IMPLEMENTATION NOTES (Updated 2026-04-05)

### ✅ Verified by Live Testing

The Qwen CLI wire protocol behavior documented below has been **verified by actual CLI testing**. Key findings:

1. **Thinking blocks are REAL** - Qwen emits explicit `type: "thinking"` content parts
2. **Content is ALWAYS an array** - Never flat strings like Gemini
3. **Multiple assistant messages** - Thinking and text come in separate messages
4. **Signature field present** - Thinking includes `signature: ""` for verification

### ⚠️ For the Implementation Session

**PAY SPECIAL ATTENTION TO:**
- Section 3.2 (Assistant Message with Thinking)
- Section 5 (Content Array Handling)
- The thinking → canonical mapping examples

**Test command used for verification:**
```bash
echo "What is 2+2?" | qwen --prompt - --output-format stream-json --approval-mode yolo
```

**Output showed:**
```
system/init → assistant/thinking → assistant/text → result/success
```

---

## 1. Executive Summary

This specification defines the **Qwen CLI Harness** - an external CLI harness implementation that wraps Alibaba's Qwen Code CLI (`@qwen-code/qwen-code`) and translates its wire protocol into the **canonical event format** used by the Kimi IDE unified chat interface.

### Relationship to Gemini

**Qwen Code CLI is a FORK of Google Gemini CLI.** This means:
- ✅ Wire protocol is nearly identical (NDJSON streaming)
- ✅ Command-line flags are similar
- ✅ Event structure is comparable
- ⚠️ Differences exist in: tool names, thinking format, auth method

**Strategy:** Build GeminiHarness and QwenHarness in parallel. Shared patterns emerge, differences become clear through comparison.

### Purpose Within the Ecosystem

See GEMINI-CLI-HARNESS-SPEC.md Section 1 for full ecosystem context. Qwen adds:
- **Massive context windows** (1M tokens)
- **Strong code generation** (Qwen3-Coder model)
- **Different tool naming** (needs mapping layer)
- **OAuth authentication** (vs API key for Gemini)

---

## 2. Qwen CLI Reference

### Installation
```bash
npm install -g @qwen-code/qwen-code
```

### Binary Detection
- **Name:** `qwen`
- **Version Check:** `qwen --version` → `0.14.0`
- **Install Command:** `npm install -g @qwen-code/qwen-code`

### Authentication (CRITICAL DIFFERENCE)

Unlike Gemini (API key), Qwen uses **OAuth 2.0**:

```bash
# Credentials stored at:
~/.qwen/oauth_creds.json

# Auto-refresh with 30-second buffer
# Token managed internally by CLI
```

**Implication:** No env var needed if already authenticated. Harness just checks if file exists.

### Invocation for Headless Mode
```bash
qwen \
  --prompt "{user message}" \
  --output-format stream-json \
  --approval-mode yolo \
  [optional: --model qwen3-coder-plus]
```

**Flags:** Identical to Gemini CLI (fork heritage)
- `--prompt, -p`: Non-interactive mode
- `--output-format stream-json`: NDJSON streaming
- `--approval-mode yolo`: Auto-approve tools
- `--model, -m`: Model selection

---

## 3. Wire Protocol Analysis

### Output Format: NDJSON (Same as Gemini)

Each line is a complete JSON object terminated by `\n`.

### Event Types (Compare to Gemini)

#### 1. System Init Event
```json
{
  "type": "system",
  "subtype": "init",
  "uuid": "e11f0a0c-6bcb-4ca2-83dd-6323763bf952",
  "session_id": "e11f0a0c-6bcb-4ca2-83dd-6323763bf952",
  "cwd": "/project/path",
  "tools": ["agent", "skill", "list_directory", "read_file", "grep_search", "edit", ...],
  "model": "coder-model",
  "permission_mode": "yolo",
  "qwen_code_version": "0.14.0",
  "agents": ["general-purpose", "Explore"]
}
```

**DIFFERENCES from Gemini:**
- `type: "system"` vs `type: "init"`
- Has `subtype: "init"`
- Includes `tools` array (Gemini doesn't expose this)
- Includes `agents` array
- `qwen_code_version` vs `gemini` version

#### 2. Assistant Message with Thinking (⚠️ CRITICAL - VERIFIED BY TESTING)

**⚠️ IMPLEMENTATION NOTE:** This behavior was verified by actual CLI testing on 2026-04-05. See test output below.

Qwen emits **TWO SEPARATE ASSISTANT MESSAGES** for thinking + response:

**Message 1: Thinking Block**
```json
{
  "type": "assistant",
  "uuid": "8cf8ca0c-01b9-4d22-8413-aa0113e9952a",
  "session_id": "04d6922a-9da6-4e56-992e-7c0549491af7",
  "message": {
    "id": "8cf8ca0c-01b9-4d22-8413-aa0113e9952a",
    "type": "message",
    "role": "assistant",
    "model": "coder-model",
    "content": [{
      "type": "thinking",
      "thinking": "The user is asking a simple math question that doesn't require any tools or context lookup.",
      "signature": ""
    }],
    "stop_reason": null,
    "usage": {"input_tokens": 0, "output_tokens": 0}
  }
}
```

**Message 2: Text Response**
```json
{
  "type": "assistant",
  "uuid": "61895387-b0d0-4d16-b0d2-603a911f8188",
  "session_id": "04d6922a-9da6-4e56-992e-7c0549491af7",
  "message": {
    "id": "61895387-b0d0-4d16-b0d2-603a911f8188",
    "type": "message",
    "role": "assistant",
    "model": "coder-model",
    "content": [{"type": "text", "text": "4"}],
    "stop_reason": null,
    "usage": {"input_tokens": 23029, "output_tokens": 24, "cache_read_input_tokens": 0, "total_tokens": 23053}
  }
}
```

**⚠️ CRITICAL DIFFERENCES from Gemini:**

| Aspect | Gemini | Qwen |
|--------|--------|------|
| **Thinking** | ❌ Not exposed | ✅ **Explicit `thinking` type** |
| **Content format** | Flat string with `delta: true` | **Array of parts** |
| **Messages** | Single streaming message | **Multiple separate messages** |
| **Signature** | N/A | ✅ Has `signature` field |

**🎯 KEY IMPLEMENTATION RULE:**

The `content` field is **ALWAYS an array** in Qwen, never a flat string:

```javascript
// Qwen content structure:
{
  "content": [
    { "type": "thinking", "thinking": "...", "signature": "" },
    { "type": "text", "text": "..." }
  ]
}
```

**Your event translator MUST:**
1. Check `msg.message.content` is an array
2. Iterate through `content` array
3. Handle each `type`: `"thinking"`, `"text"`, `"tool_use"`
4. Emit separate canonical events for each part

**DO NOT assume flat content like Gemini!**

---

## 5. Content Array Handling (⚠️ CRITICAL SECTION)

### The Golden Rule

**Qwen's `message.content` is ALWAYS an array. Never a string.**

### Content Part Types

| Part Type | Fields | Canonical Mapping |
|-----------|--------|-------------------|
| `thinking` | `thinking` (string), `signature` (string) | `type: "thinking"` |
| `text` | `text` (string) | `type: "content"` |
| `tool_use` | `name`, `arguments`, `id` | `type: "tool_call"` |

### Example: Iterating Content Array

```javascript
// CORRECT implementation:
function translateAssistantMessage(msg) {
  const content = msg.message?.content;
  
  // CRITICAL: Always check it's an array
  if (!Array.isArray(content)) {
    console.warn('Qwen content is not an array:', content);
    return null;
  }
  
  const events = [];
  
  for (const part of content) {
    switch (part.type) {
      case 'thinking':
        events.push({
          type: 'thinking',
          timestamp: Date.now(),
          text: part.thinking,  // The reasoning text
          turnId: msg.session_id
        });
        break;
        
      case 'text':
        events.push({
          type: 'content',
          timestamp: Date.now(),
          text: part.text,  // The response text
          turnId: msg.session_id
        });
        break;
        
      case 'tool_use':
        events.push({
          type: 'tool_call',
          timestamp: Date.now(),
          toolCallId: part.id,
          toolName: mapToolName(part.name),
          turnId: msg.session_id
        });
        // Also emit tool_call_args if arguments present
        if (part.arguments) {
          events.push({
            type: 'tool_call_args',
            timestamp: Date.now(),
            toolCallId: part.id,
            argsChunk: JSON.stringify(part.arguments),
            turnId: msg.session_id
          });
        }
        break;
    }
  }
  
  return events;
}
```

### Common Pitfall

```javascript
// ❌ WRONG - Gemini-style flat content:
const text = msg.message.content;  // This will be undefined or [object Object]

// ✅ CORRECT - Qwen-style array content:
for (const part of msg.message.content) {
  if (part.type === 'text') {
    const text = part.text;  // This works!
  }
}
```

---

#### 3. Result Event
```json
{
  "type": "result",
  "subtype": "success",
  "uuid": "4b2d84c3-8a9e-4e51-8847-04f610dfb270",
  "session_id": "e11f0a0c-6bcb-4ca2-83dd-6323763bf952",
  "is_error": false,
  "duration_ms": 3447,
  "duration_api_ms": 3393,
  "num_turns": 1,
  "result": "Hello",
  "usage": {
    "input_tokens": 23028,
    "output_tokens": 22,
    "cache_read_input_tokens": 0,
    "total_tokens": 23050
  },
  "permission_denials": []
}
```

**DIFFERENCES from Gemini:**
- Has `subtype: "success"`
- Has `result` field with final text
- Has `permission_denials` array
- Different stats structure

---

## 6. Critical Differences: Qwen vs Gemini

| Aspect | Gemini | Qwen | Impact |
|--------|--------|------|--------|
| **Init event** | `type: "init"` | `type: "system", subtype: "init"` | Parser must handle both |
| **Thinking** | Unknown (verify) | `content[].type: "thinking"` | Explicit thinking blocks |
| **Content format** | Flat string | Array of parts | Must iterate content[] |
| **Result event** | `type: "result"` | `type: "result", subtype: "success"` | Check subtype field |
| **Tool list** | Not exposed | Exposed in `tools` array | Can validate tool names |
| **Auth** | API key | OAuth | Different setup flow |
| **Session ID** | `session_id` | `session_id` + `uuid` | Map both to turnId |

---

## 7. Canonical Event Mapping

### Design Philosophy

Same as Gemini spec: All events translate to **canonical format** for unified display.

### Qwen → Canonical Mapping

| Qwen Event | Canonical Event | Notes |
|------------|-----------------|-------|
| `system` + `subtype: init` | `turn_begin` | Map `session_id` to `turnId` |
| `assistant` with thinking part | `thinking` | Extract from `content[]` |
| `assistant` with text part | `content` | Extract from `content[]` |
| `assistant` with tool calls | `tool_call` + `tool_call_args` | Map tool names |
| Tool result (user role) | `tool_result` | Standard mapping |
| `result` + `subtype: success` | `turn_end` | Include usage stats |

### Detailed Mapping Examples

#### 1. Thinking Block (Qwen Feature)
```javascript
// Qwen input:
{
  "type": "assistant",
  "message": {
    "content": [{
      "type": "thinking",
      "thinking": "The user wants a greeting...",
      "signature": ""
    }]
  }
}

// Canonical output:
{
  "type": "thinking",
  "timestamp": 1775436000000,
  "text": "The user wants a greeting...",
  "turnId": "e11f0a0c-6bcb-4ca2-83dd-6323763bf952"
}
```

#### 2. Text Content
```javascript
// Qwen input:
{
  "type": "assistant",
  "message": {
    "content": [{"type": "text", "text": "Hello"}],
    "usage": {"input_tokens": 23028, "output_tokens": 22}
  }
}

// Canonical output:
{
  "type": "content",
  "timestamp": 1775436000000,
  "text": "Hello",
  "turnId": "e11f0a0c-6bcb-4ca2-83dd-6323763bf952"
}
```

#### 3. Turn End
```javascript
// Qwen input:
{
  "type": "result",
  "subtype": "success",
  "result": "Hello",
  "usage": {
    "input_tokens": 23028,
    "output_tokens": 22,
    "total_tokens": 23050
  }
}

// Canonical output:
{
  "type": "turn_end",
  "timestamp": 1775436002000,
  "turnId": "e11f0a0c-6bcb-4ca2-83dd-6323763bf952",
  "fullText": "Hello",
  "hasToolCalls": false,
  "_meta": {
    "tokenUsage": {
      "input_other": 23028,
      "output": 22
    },
    "harnessId": "qwen",
    "provider": "alibaba",
    "model": "qwen3-coder-plus"
  }
}
```

---

## 8. Tool Name Mapping

Qwen tool names → Canonical tool names:

| Qwen Tool | Canonical | Notes |
|-----------|-----------|-------|
| `list_directory` | `list` | Same as Gemini |
| `read_file` | `read` | Same as Gemini |
| `write_file` | `write` | Same as Gemini |
| `edit` | `edit` | Same as Gemini |
| `run_shell_command` | `shell` | Same as Gemini |
| `grep_search` | `grep` | Same as Gemini |
| `glob` | `glob` | Same as Gemini |
| `web_fetch` | `fetch` | Same as Gemini |
| `web_search` | `web_search` | Same as Gemini |
| `ask_user_question` | `ask` | Same as Gemini |
| `save_memory` | — | Qwen-specific (ignore or map) |
| `todo_write` | `todo` | Qwen-specific |
| `exit_plan_mode` | — | Qwen-specific |

**Note:** Tool names are mostly identical to Gemini (fork heritage), but verify during implementation.

---

## 9. Architecture & Implementation

### New Files to Create

```
lib/harness/clis/qwen/
├── index.js              # QwenHarness class
├── wire-parser.js        # NDJSON parser (nearly identical to Gemini)
├── event-translator.js   # Qwen → Canonical (DIFFERENT from Gemini)
├── tool-mapper.js        # Tool name mappings
└── __tests__/
    ├── wire-parser.test.js
    ├── event-translator.test.js
    └── tool-mapper.test.js
```

### Shared Components with Gemini

**CAN REUSE:**
- `QwenWireParser` ≈ `GeminiWireParser` (both NDJSON)
- `QwenToolMapper` ≈ `GeminiToolMapper` (similar tool names)

**MUST BE DIFFERENT:**
- `QwenEventTranslator` ≠ `GeminiEventTranslator`
  - Different event structures
  - Thinking block handling
  - Array-based content vs flat strings
  - Subtype fields

### Class Definition

```javascript
class QwenHarness extends BaseCLIHarness {
  constructor() {
    super({
      id: 'qwen',
      name: 'Qwen (Alibaba)',
      cliName: 'qwen',
      provider: 'alibaba'
    });
    this.defaultModel = 'qwen3-coder-plus';
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
    // Nearly identical to Gemini
    return new QwenWireParser();
  }

  translateMessage(msg) {
    // DIFFERENT from Gemini
    return this.translator.translate(msg);
  }
}
```

---

## 10. Testing & Validation

### Parallel Development Strategy

Since you're building GeminiHarness simultaneously:

1. **Share the wire parser** if identical
2. **Compare event translators** side-by-side
3. **Test both CLIs** with same prompts
4. **Validate canonical output** is identical for same input

### Test Matrix

| Test Case | Gemini | Qwen | Notes |
|-----------|--------|------|-------|
| Simple greeting | ✅ | ✅ | Should produce identical canonical events |
| Tool call | ✅ | ✅ | Verify tool name mapping |
| Thinking blocks | ? | ✅ | Qwen has explicit thinking |
| Multi-turn | ? | ? | Verify state handling |
| Error handling | ? | ? | Compare error formats |

### Verification Script

```javascript
// Run both harnesses, compare canonical output
async function compareHarnesses(prompt) {
  const gemini = registry.get('gemini');
  const qwen = registry.get('qwen');
  
  const gEvents = [];
  const qEvents = [];
  
  for await (const e of gemini.startThread('t1', '.').sendMessage(prompt)) {
    gEvents.push(e);
  }
  
  for await (const e of qwen.startThread('t2', '.').sendMessage(prompt)) {
    qEvents.push(e);
  }
  
  // Compare canonical event types
  console.log('Gemini:', gEvents.map(e => e.type));
  console.log('Qwen:', qEvents.map(e => e.type));
}
```

---

## 11. Open Questions & Research

### Critical Unknowns

1. **Tool call format:** Exact structure in Qwen assistant messages needs verification
2. **Error events:** What does failure look like? (auth error, rate limit)
3. **Multi-turn:** Does Qwen maintain session via stdin, or stateless?
4. **Agent delegation:** How are `agents` used in the protocol?

### Research Commands

```bash
# Basic test
qwen --prompt "Hello" --output-format stream-json --approval-mode yolo

# Test with tool
qwen --prompt "List files" --output-format stream-json --approval-mode yolo

# Test thinking (Qwen should show thinking)
qwen --prompt "Explain recursion" --output-format stream-json

# Check auth status
ls ~/.qwen/oauth_creds.json

# Error case (no auth)
mv ~/.qwen/oauth_creds.json ~/.qwen/oauth_creds.json.bak
qwen --prompt "Hello" --output-format stream-json
```

---

## 12. Success Criteria

- [ ] `QwenHarness` extends `BaseCLIHarness`
- [ ] Spawns `qwen` CLI with correct arguments
- [ ] Parses NDJSON (shares pattern with Gemini)
- [ ] Emits **thinking** events (Qwen-specific feature)
- [ ] Handles array-based `content` parts
- [ ] Maps tools to canonical names
- [ ] Extracts usage from `result` event
- [ ] Handles `subtype` fields correctly
- [ ] Appears in `/api/harnesses` with OAuth status check
- [ ] End-to-end chat flow works

---

## 13. Comparison Summary: Qwen vs Gemini

| Feature | Gemini | Qwen | Winner for UX |
|---------|--------|------|---------------|
| Protocol | NDJSON | NDJSON | Tie |
| Thinking | Unknown | Explicit ✅ | Qwen |
| Tool list | Hidden | Exposed ✅ | Qwen |
| Auth | API key | OAuth | Gemini |
| Context | Standard | 1M tokens ✅ | Qwen |
| Setup | Easy | OAuth flow | Gemini |

---

## 14. Related Specifications

- **BaseCLIHarness:** `lib/harness/clis/base-cli-harness.js`
- **GeminiHarness:** `lib/harness/clis/gemini/` (build in parallel!)
- **Canonical Events:** `lib/harness/types.js`
- **Tool Mapping Pattern:** See `lib/harness/kimi/tool-mapper.js`

---

## 15. Key Insight for Parallel Development

**Qwen and Gemini are 80% identical, 20% different.**

**The 80% (share/reuse):**
- NDJSON wire format
- Command-line interface
- Most tool names
- General event flow

**The 20% (must customize):**
- Event structure (flat vs array content)
- Thinking block format
- Subtype fields
- Authentication method

**Strategy:** Build Gemini first (simpler), then Qwen (adds thinking complexity).

---

*This specification ensures Qwen CLI integrates seamlessly while leveraging the shared patterns from Gemini CLI harness development.*
