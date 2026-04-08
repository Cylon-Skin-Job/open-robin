# Streaming Render Specification

## Overview

The streaming render system provides real-time communication between the Kimi CLI (backend) and a web-based IDE client (frontend). It uses a WebSocket connection paired with a spawned Kimi wire process to stream AI-generated content, tool calls, and status updates to the client as they happen.

## Architecture

```
┌─────────────────┐      WebSocket       ┌─────────────────┐      STDIO       ┌─────────────────┐
│                 │ ◄──────────────────► │                 │ ◄───────────────►│                 │
│   Web Client    │                      │   Node Server   │                  │  Kimi CLI Wire  │
│   (React)       │                      │   (server.js)   │                  │  (--wire)       │
│                 │ ◄──────────────────► │                 │                  │                 │
└─────────────────┘                      └─────────────────┘                  └─────────────────┘
```

### Components

| Component | Purpose |
|-----------|---------|
| **Web Client** | React-based UI that receives and renders streaming content |
| **Node Server** | Express + WebSocket server that bridges client and Kimi CLI |
| **Kimi Wire** | Kimi CLI spawned in wire mode (`kimi --wire --yolo`) |

## Protocol

### Wire Protocol (Server ↔ Kimi CLI)

The Kimi wire process communicates via JSON-RPC 2.0 over STDIO:

```json
// Server → Kimi (Request)
{
  "jsonrpc": "2.0",
  "method": "prompt",
  "params": { "user_input": "Hello" },
  "id": "uuid-v4"
}

// Kimi → Server (Event notification)
{
  "jsonrpc": "2.0",
  "method": "event",
  "params": {
    "type": "ContentPart",
    "payload": { "type": "text", "text": "Hello" }
  }
}
```

### WebSocket Protocol (Client ↔ Server)

Messages are JSON-encoded and bidirectional:

**Client → Server:**
- `prompt` - Send user input to Kimi
- `response` - Respond to an agent request
- `initialize` - Initial handshake

**Server → Client:**
- `connected` - Session established
- `turn_begin` - New AI response starting
- `content` - Streaming text content
- `thinking` - Streaming reasoning/thinking content
- `tool_call` - Tool execution started
- `tool_result` - Tool execution completed
- `turn_end` - AI response complete
- `step_begin` - New reasoning step
- `status_update` - Token/context usage stats

## Streaming Flow

### 1. Session Initialization

```
Client connects via WebSocket
    ↓
Server spawns `kimi --wire --yolo` process
    ↓
Server sends `connected` message with sessionId
    ↓
Client sends `initialize` handshake
```

### 2. Turn Lifecycle

A "turn" represents one complete AI response from start to finish:

```
User submits prompt
    ↓
Server sends JSON-RPC `prompt` request to Kimi
    ↓
Kimi streams events:
    • TurnBegin → Server forwards as `turn_begin`
    • ContentPart (text) → Server forwards as `content`
    • ContentPart (think) → Server forwards as `thinking`
    • ToolCall → Server forwards as `tool_call`
    • ToolCallPart → Accumulated in session.toolArgs
    • ToolResult → Server forwards as `tool_result`
    • TurnEnd → Server forwards as `turn_end`
```

### 3. Event Types Reference

| Event | Direction | Description |
|-------|-----------|-------------|
| `TurnBegin` | Kimi → Server → Client | Marks start of AI response |
| `ContentPart` (text) | Kimi → Server → Client | Streaming text delta |
| `ContentPart` (think) | Kimi → Server → Client | Streaming reasoning/thought |
| `ToolCall` | Kimi → Server → Client | Tool invocation started |
| `ToolCallPart` | Kimi → Server | Partial tool arguments (accumulated) |
| `ToolResult` | Kimi → Server → Client | Tool completed with output |
| `TurnEnd` | Kimi → Server → Client | AI response complete |
| `StepBegin` | Kimi → Server → Client | New reasoning step |
| `StatusUpdate` | Kimi → Server → Client | Token/context usage |

## State Management

### Session State (per WebSocket connection)

```javascript
{
  wire: ChildProcess,          // Reference to Kimi process
  sessionId: string,           // UUID for this session
  currentTurn: {               // Current turn state
    id: string,
    text: string,              // Accumulated text content
    status: 'streaming' | 'complete'
  },
  buffer: string,              // Incomplete line buffer from stdout
  toolArgs: Map<string, string>, // Accumulated args per tool_call_id
  activeToolId: string | null  // Currently streaming tool
}
```

### Tool Call Accumulation

Tool arguments stream in chunks via `ToolCallPart` events. The server accumulates them:

```javascript
// ToolCall arrives
session.activeToolId = payload.id;
session.toolArgs[toolCallId] = '';

// ToolCallPart chunks arrive
session.toolArgs[session.activeToolId] += payload.arguments_part;

// ToolResult arrives - parse accumulated JSON
const fullArgs = session.toolArgs[toolCallId];
const parsedArgs = JSON.parse(fullArgs);
delete session.toolArgs[toolCallId];
```

## Message Formats

### Client → Server

**Prompt:**
```json
{
  "type": "prompt",
  "user_input": "What is 2 + 2?"
}
```

**Response (to agent request):**
```json
{
  "type": "response",
  "payload": { "answer": "yes" },
  "requestId": "uuid-v4"
}
```

**Initialize:**
```json
{
  "type": "initialize",
  "protocol_version": "1.4",
  "client": { "name": "kimi-ide", "version": "0.1.0" }
}
```

### Server → Client

**Turn Begin:**
```json
{
  "type": "turn_begin",
  "turnId": "uuid-v4",
  "userInput": "What is 2 + 2?"
}
```

**Content (text):**
```json
{
  "type": "content",
  "text": "The answer is ",
  "turnId": "uuid-v4"
}
```

**Thinking:**
```json
{
  "type": "thinking",
  "text": "I need to calculate this...",
  "turnId": "uuid-v4"
}
```

**Tool Call:**
```json
{
  "type": "tool_call",
  "toolName": "calculator",
  "toolCallId": "call_123",
  "turnId": "uuid-v4"
}
```

**Tool Result:**
```json
{
  "type": "tool_result",
  "toolCallId": "call_123",
  "toolArgs": { "expression": "2 + 2" },
  "toolOutput": "4",
  "toolDisplay": [],
  "isError": false,
  "turnId": "uuid-v4"
}
```

**Turn End:**
```json
{
  "type": "turn_end",
  "turnId": "uuid-v4",
  "fullText": "The answer is 4."
}
```

## Error Handling

### Parse Errors
When JSON parsing fails on wire output:
```json
{
  "type": "parse_error",
  "line": "malformed json here"
}
```

### Wire Process Errors
- Spawn failures logged to console
- STDERR piped to console
- Process exit logged with code

### Connection Cleanup
On WebSocket close:
1. Kill associated Kimi wire process
2. Remove session from sessions Map

## Debugging

### Wire Log (`wire-debug.log`)
All wire communication is logged with timestamps:
```
[2026-03-04T00:00:00.000Z] WIRE_IN: {"jsonrpc":"2.0",...}
```

### Console Logging
- `[→ Wire]` - Messages sent to Kimi
- `[← Wire]` - Messages received from Kimi
- `[WS →]` - Messages from WebSocket client
- `[Think]` - Thinking content received

## Implementation Notes

### Line Buffering
The wire protocol uses newline-delimited JSON (NDJSON). The server maintains a buffer for incomplete lines:

```javascript
session.buffer += data.toString();
let lines = session.buffer.split('\n');
session.buffer = lines.pop(); // Keep incomplete line
```

### Truncation for Logs
Long messages are truncated in console output (500 chars) but full messages are logged to `wire-debug.log`.

### Environment
- `KIMI_PATH` - Override default `kimi` command
- `TERM=xterm-256color` - Set for colored output support

## Future Considerations

- Reconnection handling for dropped WebSocket connections
- Multi-turn conversation persistence
- Rate limiting and token quotas
- Binary content streaming for file operations
