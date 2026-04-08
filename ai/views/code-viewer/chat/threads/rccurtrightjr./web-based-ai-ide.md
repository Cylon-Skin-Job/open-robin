# Web-based AI IDE

User

What can you tell me about this project?

Assistant

Based on the `AGENTS.md` and project structure, here's what this project is:

## **kimi-claude / Open Robin** — Web-based AI IDE

A **thin-client IDE** that connects to command-line AI assistants (Kimi, Claude, Qwen, Codex, Gemini, OpenCode) via their wire protocols. The CLI handles all AI inference; the IDE is purely a display/harness layer.

---

### Architecture

```
┌─────────────┐     WebSocket      ┌─────────────┐     STDIO/JSON-RPC     ┌─────────┐
│   React     │ ◄────────────────► │ Node.js     │ ◄────────────────────► │  CLI    │
│  (Browser)  │    (port 3001)     │  Server     │                        │ (kimi,  │
│  Pure UI    │                    │  Bridge     │                        │ claude, │
└─────────────┘                    └─────────────┘                        │ etc.)   │
                                                                          └─────────┘
```

---

### Key Technologies

| Layer | Stack |
|-------|-------|
| **Frontend** | React 19 + TypeScript + Vite + Zustand |
| **Styling** | CSS with Raven OS-inspired "Tron" aesthetic |
| **Backend** | Node.js + Express + WebSocket (`ws`) |
| **Protocol** | JSON-RPC 2.0 over WebSocket (client↔server) and STDIO (server↔CLI) |
| **Database** | SQLite (`ai/system/robin.db`) — per-project, workspace-scoped |

---

### Project Structure

```
kimi-claude/
├── kimi-ide-client/     # React frontend — build to dist/ for server
│   ├── src/components/  # Pure UI components (no business logic)
│   ├── src/state/       # Zustand store
│   ├── src/hooks/       # WebSocket bridge hook
│   └── src/lib/         # Render engine, content accumulator
├── kimi-ide-server/     # Node.js WebSocket bridge
│   ├── server.js        # Main entry — serves client + WebSocket
│   └── lib/             # DB queries, migrations, config
├── ai/                  # Project intelligence layer
│   ├── system/          # SQLite DB (robin.db), runtime state
│   └── workspaces/      # Workspace configs (wiki, issues, agents, etc.)
└── docs/                # Architecture & spec docs
```

---

### Core Concepts

**1. Seven Workspaces** (tab-based UI with distinct colors):
- `browser` (blue) — Browser-based tools
- `code` (cyan) — File editor, diffs
- `rocket` (orange) — Deployments, builds
- `issues` (yellow) — Tasks, processes
- `wiki` (pink) — Documentation
- `claw` (red) — Direct CLI chat
- `skills` (purple) — Commands, prompts

**2. Pulse-Driven Render Engine**
- 500ms pulse drives all state transitions
- Job queue buffers render instructions
- Components are pure renderers — no `setTimeout`, no direct store writes

**3. Three User Modes**
- **Riff Mode** — Fast brainstorming, no tools
- **Vibe Mode** — Quick edits with file tools
- **Plan Mode** — Structured, step-by-step with validation

---

### Quick Start

```bash
# One-command rebuild + restart
./restart-kimi.sh

# Or manually:
cd kimi-ide-client && npm run build    # Build to dist/
cd ../kimi-ide-server && node server.js # Serves on :3001
```

Then open http://localhost:3001

---

### Key Design Principles

1. **Thin Client** — Frontend has zero business logic; all state lives in backend/CLI
2. **Engine Owns Timing** — No `setInterval`/`setTimeout` in components
3. **One Bridge, One Direction** — Engine → Bridge → Store → Components
4. **Workspace-Scoped** — The `ai/` folder travels with the project; opening a different project reads *that* project's workspaces

Want me to dive deeper into any specific area — the wire protocol, render engine, workspace system, or how to extend it?

<!-- metadata: {"contextUsage":0.06807327270507812,"tokenUsage":{"input_other":9909,"output":1038,"input_cache_read":7936,"input_cache_creation":0},"messageId":"chatcmpl-WYqF66taVdHp7eNW4G0GI1jz","planMode":false,"capturedAt":1775458577614} -->

User

Send out an Explore agent to have a look at the wire protocol and RCP handling.

Assistant

The Explore agent has finished its investigation. Here's a comprehensive summary of the **wire protocol and RPC handling**:

---

## Protocol Architecture

The system uses **two distinct protocols** layered together:

```
┌─────────────┐      WebSocket        ┌─────────────┐      JSON-RPC 2.0       ┌─────────┐
│   React     │ ◄────────────────────► │   Node.js   │ ◄─────────────────────► │  CLI    │
│   Client    │    JSON messages       │   Server    │   line-delimited NDJSON │  (kimi, │
│             │                        │   Bridge    │                        │ claude) │
└─────────────┘                        └─────────────┘                        └─────────┘
```

---

## 1. Wire Protocol (Server ↔ CLI): JSON-RPC 2.0

**Transport**: Line-delimited JSON (NDJSON) over stdin/stdout  
**Version**: JSON-RPC 2.0 with protocol version 1.4

### Server → CLI Requests
| Method | Purpose |
|--------|---------|
| `initialize` | Handshake, negotiate capabilities |
| `prompt` | Send user input |
| `response` | Reply to agent request (approvals) |
| `steer` | Inject message mid-turn |
| `replay` | Replay session history |

### CLI → Server Events
| Event Type | Description |
|------------|-------------|
| `TurnBegin` / `TurnEnd` | Turn lifecycle |
| `ContentPart` | Streaming text (type: `text`, `think`) |
| `ToolCall` / `ToolResult` | Tool execution |
| `StepBegin` | Multi-step turn marker |
| `StatusUpdate` | Token/context usage |

### CLI → Server Requests (need response)
- `ApprovalRequest` — Tool needs user approval
- `QuestionRequest` — Interactive multi-choice question

---

## 2. WebSocket Protocol (Client ↔ Server)

**Format**: JSON messages (simpler type-based routing, NOT JSON-RPC)

### Key Message Types

| Direction | Type | Purpose |
|-----------|------|---------|
| C→S | `prompt` | Send user message |
| C→S | `thread:create/open/rename/delete` | Thread management |
| C→S | `file_tree_request` / `file_content_request` | File explorer |
| S→C | `turn_begin` / `turn_end` | Turn lifecycle |
| S→C | `content` / `thinking` | Streaming content |
| S→C | `tool_call` / `tool_result` | Tool execution |
| S→C | `request` | Agent needs approval/answer |
| S→C | `status_update` | Token usage updates |

---

## 3. Message Routing & Handling

### Critical: Line Buffering for NDJSON
```javascript
// Server accumulates partial lines from stdout
session.buffer += data.toString();
let lines = session.buffer.split('\n');
session.buffer = lines.pop(); // Keep incomplete line for next chunk

for (const line of lines) {
  const msg = JSON.parse(line);
  handleWireMessage(msg);
}
```

### Wire Message Router (`server.js`)
```javascript
function handleWireMessage(msg) {
  if (msg.method === 'event') {
    // CLI notifications → forward to WebSocket
    handleEvent(msg.params.type, msg.params.payload);
  } else if (msg.method === 'request') {
    // CLI requests approval → send to client, await response
    ws.send({ type: 'request', requestId: msg.id, ... });
  } else if (msg.id && msg.result) {
    // CLI responded to our request
    handleResponse(msg.id, msg.result);
  }
}
```

---

## 4. Session State Management

Each WebSocket maintains session state:
```javascript
{
  wire: null,              // Active CLI process
  currentTurn: null,       // Turn tracking
  buffer: '',              // NDJSON line buffer
  toolArgs: {},            // Accumulated tool arguments
  activeToolId: null,      // Currently executing tool
  assistantParts: [],      // Exchange parts for persistence
  contextUsage: null,      // Token usage from wire
  currentThreadId: null    // Active thread
}
```

**Global wire registry**: `Map<threadId, {wire, projectRoot}>` — allows any WebSocket connection to send to any thread's CLI process.

---

## 5. Multi-CLI Support

The server supports multiple CLI backends through a **harness abstraction**:

| CLI | Protocol |
|-----|----------|
| `kimi` | Native Wire Protocol 1.4 |
| `codex` | ACP Protocol translation |
| `claude-code` | ACP Protocol translation |
| `qwen` | Wire Protocol translation |
| `gemini` | ACP Protocol translation |

Each harness translates between CLI-specific protocols and the canonical event format.

---

## Key Files

| File | Purpose |
|------|---------|
| `docs/WIRE_PROTOCOL.md` | Full protocol spec |
| `kimi-ide-server/server.js` | Main bridge server |
| `kimi-ide-server/lib/harness/kimi/wire-parser.js` | NDJSON parser |
| `kimi-ide-client/src/types/index.ts` | TypeScript message types |
| `kimi-ide-client/src/lib/ws-client.ts` | Client WebSocket client |

---

**Key Takeaway**: The server acts as a **protocol bridge** — translating between JSON-RPC 2.0 (CLI) and simple JSON WebSocket messages (client), while maintaining session state and handling the asynchronous, streaming nature of AI tool execution.

**TOOL CALL(S)**

<!-- metadata: {"contextUsage":0.08759307861328125,"tokenUsage":{"input_other":4274,"output":1214,"input_cache_read":18688,"input_cache_creation":0},"messageId":"chatcmpl-appnr6Jvv0E5HyXbSGa3l0Dj","planMode":false,"capturedAt":1775458801335} -->
