# Harness Implementation Guide — Lessons Learned

> **Written:** 2026-04-05
> **Trigger:** QwenHarness implementation went sideways because the spec documented the wrong protocol entirely. This document captures what must be included in any future harness spec.

---

## 1. PROTOCOL DISCOVERY — Do NOT Assume

### The Mistake

The Qwen spec documented `--output-format stream-json` (one-shot, no multi-turn). Reality: Qwen supports `--acp` (Agent Client Protocol) — the same bidirectional JSON-RPC protocol Gemini uses. The spec was written from superficial CLI output observation, never from researching the CLI's actual capabilities.

### The Rule

**Before writing a harness spec, answer these questions by examining the actual CLI source code, not just running `--help`:**

1. Does this CLI support ACP (`--acp` or `--experimental-acp`)?
2. If not, what bidirectional protocol DOES it support? (custom JSON-RPC? MCP?)
3. Is the documented "streaming" mode one-shot or multi-turn?
4. Can the CLI run as a persistent subprocess, or does it exit after one response?

### How to Research

- Search the CLI's GitHub for: `--acp`, `--experimental-acp`, `agent client protocol`, `jsonrpc`, `session/prompt`, `session/update`, `stdin`, `input-format`
- Search for IDE integrations (Zed, VS Code, IntelliJ) — they always document the real protocol
- Check GitHub issues for "ACP" or "IDE integration" tracking issues
- Read the source, not just the docs

---

## 2. WIRED PROTOCOL — Must Document Every Message Type

### The Mistake

The spec described wire messages as having `type` and `subtype` fields. Reality: the ACP protocol uses JSON-RPC 2.0 with `jsonrpc`, `method`, `id`, `result`/`error`.

### Required Specification Fields

For each protocol direction (stdin → CLI, stdout ← CLI), document:

#### Requests (client → CLI, stdin)
| Message | JSON-RPC method | Required params | Example |
|---------|----------------|-----------------|---------|
| Initialize | `initialize` | `protocolVersion`, `clientInfo` | See section 4 |
| New Session | `session/new` | `cwd`, `mcpServers` | See section 4 |
| Send Prompt | `session/prompt` | `sessionId`, `prompt` | See section 4 |

#### Responses (CLI → client, stdout)
| Message | Classification | Key fields | Purpose |
|---------|---------------|------------|---------|
| `{id: N, result: {...}}` | Response | `sessionId`, `models`, `modes` | Session created |
| `{id: N, result: {stopReason}}` | Response | `stopReason` | Turn ended |
| `{id: N, error: {code, message}}` | Response | error details | Request failed |

#### Notifications (CLI → client, stdout, no id)
| Message | `method` field | `params.update.sessionUpdate` values | Purpose |
|---------|---------------|-------------------------------------|---------|
| Session update | `session/update` | `agent_thought_chunk` | Streaming thinking |
| Session update | `session/update` | `agent_message_chunk` | Streaming response |
| Session update | `session/update` | `tool_call` | Tool invocation |
| Session update | `session/update` | `tool_call_update` | Tool result |
| Session update | `session/update` | `available_commands_update` | Metadata |
| Session update | `session/update` | `session_info_update` | Metadata |

### The Rule

**A harness spec MUST enumerate every message type that flows in both directions. Do not say "similar to X" without proving it byte-for-byte.**

---

## 3. INITIALIZATION HANDSHAKE — Must Document the Full Sequence

### The Mistake

The spec had no initialization sequence. It assumed you spawn with `--prompt` and read output. Reality: ACP requires a 3-step handshake before any prompts can be sent.

### The Required Sequence

```
Step 1 → stdin:  {"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}
Step 2 ← stdout: {"jsonrpc":"2.0","id":1,"result":{protocolVersion,agentInfo,authMethods,agentCapabilities}}

Step 3 → stdin:  {"jsonrpc":"2.0","id":2,"method":"session/new","params":{"cwd":"/path","mcpServers":[]}}
Step 4 ← stdout: {"jsonrpc":"2.0","id":2,"result":{sessionId,models,modes,configOptions}}

Step 5 ← stdout: {"jsonrpc":"2.0","method":"session/update","params":{...available_commands_update...}}

Now ready → stdin:  {"jsonrpc":"2.0","id":3,"method":"session/prompt","params":{"sessionId":"...","prompt":[...]}}
```

### The Rule

**Every harness spec must document the exact initialization sequence: what to send, what to expect back, and when the CLI is ready for prompts.**

---

## 4. MULTI-TURN — Must Specify How Follow-Ups Work

### The Mistake

The spec described a one-shot flow: spawn with `--prompt`, read output, done. No multi-turn.

### Reality

Multi-turn ACP works by sending additional `session/prompt` messages to the **same long-running process** with the **same `sessionId`**:

```
→ session/prompt (id:3, sessionId:"abc")  ← Turn 1
← agent_thought_chunk, agent_message_chunk, ...
← {id:3, result:{stopReason:"end_turn"}}

→ session/prompt (id:4, sessionId:"abc")  ← Turn 2, SAME session
← agent_thought_chunk, agent_message_chunk, ...
← {id:4, result:{stopReason:"end_turn"}}
```

### The Rule

**A harness spec must answer: How do you send a second message? Do you respawn the CLI (one-shot) or send another request to the same process (multi-turn)? What happens to conversation context?**

---

## 5. EVENT BUS BRIDGE — Must Document How Canonical Events Reach SQLite

### The Mistake

The spec documented canonical event types (`turn_begin`, `content`, `thinking`, `tool_call`, `turn_end`) but never described how those events flow into the app's persistence layer.

### The Actual Architecture

There are **two event systems** in the codebase:

| System | EventEmitter | Events | Purpose |
|--------|-------------|--------|---------|
| **Harness events** | Per-harness `EventEmitter` | `event`, `error`, `exit`, `parse_error` | Internal harness → translator |
| **Event bus** | Shared singleton (`lib/event-bus.js`) | `chat:turn_begin`, `chat:content`, `chat:thinking`, `chat:tool_call`, `chat:tool_result`, `chat:turn_end`, `chat:status_update` | App-wide pub/sub |

**The harness emits to its own EventEmitter. The audit subscriber listens on the shared event bus. There must be a bridge.**

### The Bridge

When a harness's event translator produces a `turn_end` canonical event, the harness must ALSO emit to the shared event bus:

```js
import { emit } from '../event-bus';

// Inside the harness message handler:
if (event.type === 'turn_end') {
  const state = this.sessionStates.get(threadId);
  emit('chat:turn_end', {
    workspace: 'code-viewer',
    threadId,
    turnId: event.turnId,
    userInput: state.currentTurn?.userInput,
    parts: state.assistantParts,     // CRITICAL — the accumulated parts array
    fullText: event.fullText,
    hasToolCalls: event.hasToolCalls,
  });
}

// Also emit status_update for token usage (picked up by audit subscriber):
emit('chat:status_update', {
  threadId,
  messageId: null,
  planMode: false,
  contextUsage: null,
  tokenUsage: {
    input_other: state.inputTokens,
    output: state.outputTokens,
  },
});
```

### The Persistence Chain

```
chat:status_update → audit subscriber stores in pendingAuditData Map
chat:turn_end      → audit subscriber correlates by threadId,
                     calls HistoryFile.addExchange(threadId, userInput, parts, metadata)
                     → INSERT into exchanges table (SQLite)
```

The `exchanges` row stores:
- `user_input` — the user's message text
- `assistant` — `JSON.stringify({ parts: [...] })` where parts is the accumulated `assistantParts` array
- `metadata` — token usage, message ID, plan mode, timestamps

### The Rule

**A harness spec must document:**
1. **Which shared event bus events the harness must emit** (`chat:turn_end`, `chat:status_update`)
2. **What fields each event must have** (especially `userInput` and `parts` for `chat:turn_end`)
3. **When events are emitted** (timing relative to canonical events)
4. **How the parts array is accumulated** during the turn

---

## 6. ASSISTANT PARTS ACCUMULATION — Must Match the DB Schema

### The Mistake

The spec had no concept of "parts" — it treated each canonical event as independent.

### Reality

The `exchanges` table stores one row per turn, with `assistant` = `{ parts: [...] }`. The parts array must match this shape:

```js
// Text response:
{ type: 'text', content: 'Hello world' }

// Thinking:
{ type: 'think', content: 'Let me analyze this...' }

// Tool call (with full lifecycle):
{
  type: 'tool_call',
  toolCallId: 'tool-abc123',
  name: 'read_file',
  arguments: { file_path: '/test.js' },
  result: {
    output: 'file contents here',
    display: [],
    error: undefined,
    files: []
  }
}
```

The harness session state **accumulates** these parts during the turn. At `turn_end`, the complete array is emitted to the event bus and persisted to SQLite.

### The Rule

**A harness spec must document the exact shape of the `assistantParts` array and how it maps from the CLI's wire protocol to the DB schema.**

---

## 7. SESSION ID TRACKING — Must Document Where It Comes From

### The Mistake

The spec said `session_id` comes from wire messages generally.

### Reality

In ACP, the `sessionId` comes from the `session/new` **response** (`msg.result.sessionId`), NOT from the `session/prompt` response. This is a critical detail — grabbing it from the wrong place breaks multi-turn.

### The Rule

**Document exactly which message and which field contains the session ID.**

---

## 8. TOKEN USAGE — Must Document Where It Appears

### The Mistake

The spec showed token usage on the `result` event.

### Reality

In ACP mode, token usage appears on the `_meta.usage` field of the **final `agent_message_chunk`** notification, NOT on the `session/prompt` response result:

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
          "inputTokens": 14374,
          "outputTokens": 32,
          "totalTokens": 14406,
          "thoughtTokens": 25,
          "cachedReadTokens": 14347
        },
        "durationMs": 2570
      }
    }
  }
}
```

### The Rule

**Document where token usage appears in the actual wire stream. It may be on a notification, not on the response result.**

---

## 9. WHAT "SIMILAR TO GEMINI" ACTUALLY MEANS

### The Mistake

The spec said "Qwen is a fork of Gemini, so the protocol is similar" without verifying.

### Reality

For ACP mode, **Qwen and Gemini use the identical protocol**. The only differences are:

| Aspect | Gemini | Qwen | Action needed |
|--------|--------|------|---------------|
| CLI binary | `gemini` | `qwen` | Spawn arg |
| Default model | `auto-gemini-3` | `qwen3-coder-plus` | Spawn arg |
| Auth | API key | OAuth (`~/.qwen/oauth_creds.json`) | Install check |
| Tool names | `list_directory`, `read_file`, ... | Same (fork) | Shared mapper works |
| Model name in metadata | `gemini-3` | `coder-model(qwen-oauth)` | Metadata field |
| Provider string | `google` | `alibaba` | Metadata field |

The wire parser, event translator, session state, and tool mapper are **95% reusable patterns**. The harness class structure is **identical**.

### The Rule

**When claiming "similar to X", attach a side-by-side table proving it with actual wire examples from both CLIs.**

---

## 10. LIVE TESTING — Must Verify Before Writing the Spec

### The Mistake

The spec's "test commands" section ran:
```bash
echo "What is 2+2?" | qwen --prompt - --output-format stream-json --approval-mode yolo
```

And documented that output. But this is the **one-shot** mode. The spec never tested ACP mode:
```bash
qwen --acp --approval-mode yolo
```

### The Rule

**A harness spec must test the ACTUAL protocol the harness will use. If the harness uses ACP, test ACP. If it uses stream-json, test stream-json. Do not test one and spec the other.**

### Minimum Live Test Checklist

- [ ] Spawn the CLI as a subprocess with the flags the harness will use
- [ ] Send the full initialization sequence via stdin
- [ ] Send at least one prompt via stdin
- [ ] Capture and document ALL stdout messages
- [ ] Send a second prompt to verify multi-turn
- [ ] Document the exact JSON structure of every message type observed
- [ ] Verify the process stays alive for follow-up messages (or exits if one-shot)

---

## 11. SUMMARY — Checklist for Any Future Harness Spec

Before writing a harness spec for any CLI (Codex, Claude Code, etc.), verify:

- [ ] **Protocol type**: ACP? Custom JSON-RPC? MCP? Stream-JSON?
- [ ] **Multi-turn or one-shot**: Does the process persist or exit?
- [ ] **Initialization sequence**: Exact messages for handshake
- [ ] **All message types**: Both directions, every type, with examples
- [ ] **Session ID source**: Which message and field contains it
- [ ] **Token usage location**: Which message carries usage data
- [ ] **Thinking/reasoning format**: How is it streamed? (chunks? block?)
- [ ] **Tool call format**: How are tools invoked? (streaming args? result events?)
- [ ] **Error handling**: What does auth failure / rate limit / crash look like?
- [ ] **Event bus bridge**: What `chat:` events must be emitted, with what fields
- [ ] **Parts accumulation**: How do wire events map to `assistantParts`
- [ ] **Side-by-side with existing harnesses**: Prove similarity with actual data
- [ ] **Live wire capture**: Run the actual protocol, capture all I/O, document it
