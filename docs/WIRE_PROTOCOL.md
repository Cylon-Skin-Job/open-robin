# Kimi Wire Protocol Reference

## Overview

The Kimi Wire Protocol is a JSON-RPC 2.0 based protocol for bidirectional communication between Kimi CLI and external programs. It enables building custom UIs, IDE integrations, and automated tooling.

**Current Version:** 1.4  
**Transport:** stdin/stdout (line-delimited JSON)  
**Official Docs:** https://moonshotai.github.io/kimi-cli/en/customization/wire-mode.md

---

## Quick Start

```bash
# Start wire mode
kimi --wire --yolo

# Send a prompt (JSON-RPC format)
echo '{"jsonrpc":"2.0","method":"prompt","id":"1","params":{"user_input":"Hello"}}'
```

---

## Protocol Basics

### Message Format

Every message is a single line of JSON (newline-delimited):

```json
{"jsonrpc":"2.0","method":"...","id":"...","params":{...}}
```

### Message Types

| Direction | Type | Description |
|-----------|------|-------------|
| Client → Agent | Request | Has `id`, expects response |
| Client → Agent | Notification | No `id`, no response needed |
| Agent → Client | Event | Notification during processing |
| Agent → Client | Request | Requires client response |
| Agent → Client | Response | Response to client request |

---

## Client → Agent Messages

### Initialize (Optional but Recommended)

Handshake to negotiate protocol version and capabilities.

```json
{
  "jsonrpc": "2.0",
  "method": "initialize",
  "id": "uuid",
  "params": {
    "protocol_version": "1.4",
    "client": {
      "name": "my-client",
      "version": "1.0.0"
    },
    "capabilities": {
      "supports_question": true
    }
  }
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": "uuid",
  "result": {
    "protocol_version": "1.4",
    "server": {
      "name": "Kimi Code CLI",
      "version": "1.16.0"
    },
    "slash_commands": [...],
    "capabilities": {
      "supports_question": true
    }
  }
}
```

### Prompt (Main Interaction)

Send user input and start an agent turn.

```json
{
  "jsonrpc": "2.0",
  "method": "prompt",
  "id": "uuid",
  "params": {
    "user_input": "Your message here"
  }
}
```

**Response (when turn completes):**
```json
{
  "jsonrpc": "2.0",
  "id": "uuid",
  "result": {
    "status": "finished"
  }
}
```

Status values:
- `"finished"` - Turn completed normally
- `"cancelled"` - Turn was cancelled
- `"max_steps_reached"` - Hit step limit

### Replay

Replay history from session's `wire.jsonl`.

```json
{
  "jsonrpc": "2.0",
  "method": "replay",
  "id": "uuid",
  "params": {}
}
```

### Steer (Wire 1.4+)

Inject message into active turn without starting new turn.

```json
{
  "jsonrpc": "2.0",
  "method": "steer",
  "id": "uuid",
  "params": {
    "user_input": "Additional context"
  }
}
```

---

## Agent → Client Messages

### Events (Notifications)

Sent during turn processing. No response needed.

#### TurnBegin
```json
{
  "jsonrpc": "2.0",
  "method": "event",
  "params": {
    "type": "TurnBegin",
    "payload": {
      "user_input": "Hello"
    }
  }
}
```

#### StepBegin
```json
{
  "jsonrpc": "2.0",
  "method": "event",
  "params": {
    "type": "StepBegin",
    "payload": {
      "n": 1
    }
  }
}
```

#### ContentPart (Streaming Text)

**See [STREAMING_CONTENT.md](./STREAMING_CONTENT.md) for the canonical reference.** Do not guess—that doc has captured wire output and implementation rules.

```json
{
  "jsonrpc": "2.0",
  "method": "event",
  "params": {
    "type": "ContentPart",
    "payload": {
      "type": "text",
      "text": "Hello"
    }
  }
}
```

Content types:
- `text` - Regular response text. Field: `payload.text`
- `think` - Chain-of-thought. Field: `payload.think` (not `text`)
- `image_url` - Image reference
- `audio_url` - Audio reference
- `video_url` - Video reference

**Important:** Both `text` and `think` stream token-level (small chunks). Thought block boundaries = type transitions (`think`→`text` ends block, `text`→`think` starts new block). No embedded `<thought>` tags.

#### StatusUpdate
```json
{
  "jsonrpc": "2.0",
  "method": "event",
  "params": {
    "type": "StatusUpdate",
    "payload": {
      "context_usage": 0.049,
      "token_usage": {
        "input_other": 7526,
        "output": 14,
        "input_cache_read": 5376,
        "input_cache_creation": 0
      },
      "message_id": "chatcmpl-..."
    }
  }
}
```

#### TurnEnd
```json
{
  "jsonrpc": "2.0",
  "method": "event",
  "params": {
    "type": "TurnEnd",
    "payload": {}
  }
}
```

### Requests (Require Response)

Agent sends these via `request` method. Client must respond.

#### ApprovalRequest

Tool execution needs approval (unless --yolo mode).

```json
{
  "jsonrpc": "2.0",
  "method": "request",
  "id": "req-uuid",
  "params": {
    "type": "ApprovalRequest",
    "payload": {
      "id": "approval-1",
      "tool_call_id": "tc-1",
      "sender": "Bash",
      "action": "Run command",
      "description": "ls -la",
      "display": [...]
    }
  }
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": "req-uuid",
  "result": {
    "request_id": "approval-1",
    "response": "approve"
  }
}
```

Response options: `"approve"`, `"approve_for_session"`, `"reject"`

#### ToolCallRequest

External tool call (registered via initialize).

```json
{
  "jsonrpc": "2.0",
  "method": "request",
  "id": "req-uuid",
  "params": {
    "type": "ToolCallRequest",
    "payload": {
      "id": "tc-1",
      "name": "my_custom_tool",
      "arguments": "{\"param\":\"value\"}"
    }
  }
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": "req-uuid",
  "result": {
    "tool_call_id": "tc-1",
    "return_value": {
      "is_error": false,
      "output": "Tool result",
      "message": "Success",
      "display": []
    }
  }
}
```

#### QuestionRequest (Wire 1.4+)

Structured question for user (requires `supports_question: true` in initialize).

```json
{
  "jsonrpc": "2.0",
  "method": "request",
  "id": "req-uuid",
  "params": {
    "type": "QuestionRequest",
    "payload": {
      "id": "q-1",
      "tool_call_id": "tc-1",
      "questions": [
        {
          "question": "Which language?",
          "header": "Lang",
          "options": [
            {"label": "Python", "description": "Widely used"},
            {"label": "Rust", "description": "Fast"}
          ],
          "multi_select": false
        }
      ]
    }
  }
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": "req-uuid",
  "result": {
    "request_id": "q-1",
    "answers": {
      "Which language?": "Python"
    }
  }
}
```

---

## Error Codes

| Code | Description |
|------|-------------|
| `-32601` | Method not found (e.g., initialize not supported) |
| `-32000` | Turn already in progress |
| `-32001` | LLM not configured |
| `-32002` | LLM not supported |
| `-32003` | LLM service error |

---

## Display Blocks

Used in tool results and approval requests for rich UI rendering.

### BriefDisplayBlock
```json
{"type": "brief", "text": "Summary text"}
```

### DiffDisplayBlock
```json
{
  "type": "diff",
  "path": "src/file.ts",
  "old_text": "old content",
  "new_text": "new content"
}
```

### TodoDisplayBlock
```json
{
  "type": "todo",
  "items": [
    {"title": "Task 1", "status": "done"},
    {"title": "Task 2", "status": "in_progress"},
    {"title": "Task 3", "status": "pending"}
  ]
}
```

### ShellDisplayBlock
```json
{
  "type": "shell",
  "language": "sh",
  "command": "npm install"
}
```

---

## Implementation Notes

### Line Buffering

Messages are newline-delimited. Implementations must:
1. Read lines until newline
2. Parse each line as JSON
3. Buffer incomplete lines until next read

### ID Generation

Use UUID v4 for message IDs:
```javascript
const id = crypto.randomUUID();
```

### Process Management

- Spawn: `kimi --wire --yolo`
- Stdio: stdin for input, stdout for output, stderr for logs
- Kill: Send SIGTERM, process exits cleanly
- Exit code: 0 = normal, non-zero = error

### Session Persistence

Kimi automatically saves to `wire.jsonl` in session directory. Use `replay` to restore.

---

## Finding More Information

### Official Sources

1. **Primary Documentation**
   - URL: https://moonshotai.github.io/kimi-cli/en/customization/wire-mode.md
   - LLM-friendly index: https://moonshotai.github.io/kimi-cli/llms.txt

2. **GitHub Repository**
   - https://github.com/MoonshotAI/kimi-cli
   - Check `/docs` directory for source documentation
   - Look for wire-related issues and PRs

3. **Kimi Agent (Rust Implementation)**
   - https://github.com/MoonshotAI/kimi-agent-rs
   - Alternative implementation, same protocol
   - Good for reference when behavior differs

### Local Sources

1. **Kimi CLI Help**
   ```bash
   kimi --help
   kimi --wire --help
   ```

2. **Installed Package**
   ```bash
   # Python package location
   ~/.local/share/uv/tools/kimi-cli/lib/python*/site-packages/kimi_cli/
   
   # Look for wire-related modules
   find ~/.local/share/uv/tools/kimi-cli -name "*wire*" -o -name "*protocol*"
   ```

3. **Session Files**
   ```bash
   # Session directory
   ~/.kimi/sessions/
   
   # Wire log (replay source)
   wire.jsonl
   ```

### Reverse Engineering

If documentation is incomplete:

1. **Capture Real Traffic**
   ```bash
   kimi --wire --yolo 2>&1 | tee wire-log.txt
   ```

2. **Use Debug Mode**
   ```bash
   kimi --wire --yolo --debug
   ```

3. **Read Source Code**
   - Kimi CLI is Python-based
   - Look for `wire` module in source
   - Search for `jsonrpc`, `stdin`, `stdout` handling

### Community

1. **GitHub Issues**
   - https://github.com/MoonshotAI/kimi-cli/issues
   - Search for "wire", "protocol", "jsonrpc"

2. **Changelog**
   - https://moonshotai.github.io/kimi-cli/en/release-notes/changelog.md
   - Track protocol version changes

---

## Version History

| Version | Changes |
|---------|---------|
| 1.0 | Initial release |
| 1.1 | Added `initialize`, `ApprovalResponse` renamed |
| 1.2 | Added `TurnEnd` event |
| 1.3 | Added `replay` method |
| 1.4 | Added `steer`, `QuestionRequest`, `supports_question` capability |

---

## Common Patterns

### Simple Echo Client
```javascript
const wire = spawn('kimi', ['--wire', '--yolo']);

// Send prompt
wire.stdin.write(JSON.stringify({
  jsonrpc: '2.0',
  method: 'prompt',
  id: '1',
  params: { user_input: 'Hello' }
}) + '\n');

// Read events
wire.stdout.on('data', (data) => {
  console.log(data.toString());
});
```

### Handling Streaming Content
```javascript
let currentText = '';

function handleEvent(event) {
  if (event.type === 'ContentPart' && event.payload.type === 'text') {
    currentText += event.payload.text;
    updateUI(currentText);
  }
}
```

### Approval Handler
```javascript
if (request.type === 'ApprovalRequest') {
  const approved = await showApprovalDialog(request.payload);
  sendResponse(request.id, {
    request_id: request.payload.id,
    response: approved ? 'approve' : 'reject'
  });
}
```

---

## Debugging Tips

1. **Enable Debug Mode**: `kimi --wire --yolo --debug`
2. **Log All Traffic**: Tee stdout to file
3. **Check Stderr**: Error messages go to stderr
4. **Validate JSON**: Use jq to pretty-print: `| jq .`
5. **Test Incrementally**: Start with simple prompts
6. **Check Version**: Different versions have different features

---

## Related Documentation

- **[STREAMING_CONTENT.md](./STREAMING_CONTENT.md)** - ContentPart structure, think vs text, chunk granularity, thought block boundaries. **Read this before implementing streaming UI.**
- [ACP Protocol](./ACP_PROTOCOL.md) - Alternative protocol (deprecated)
- [Print Mode](./PRINT_MODE.md) - Non-interactive mode
- [Sessions](./SESSIONS.md) - Session management
- [MCP](./MCP.md) - Model Context Protocol integration

---

*Last Updated: 2026-03-01*  
*Protocol Version: 1.4*  
*Kimi CLI Version: 1.16.0*
