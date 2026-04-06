# AGENTS.md - Kimi IDE Server

> Agent-focused documentation for the Kimi IDE Server — a WebSocket + HTTP bridge between the React client and the Kimi CLI wire process.

---

## Project Overview

The Kimi IDE Server is a Node.js/Express application that:
- Spawns and manages Kimi CLI wire processes (`kimi --wire --yolo`)
- Bridges WebSocket communication between the React client and Kimi CLI
- Serves static files from the React client build (`kimi-ide-client/dist/`)
- Provides file explorer APIs for panel navigation
- Persists configuration and chat history

**Key Technologies:** Node.js, Express, WebSocket (ws), JSON-RPC 2.0, UUID

---

## Architecture

```
┌─────────────────┐     WebSocket      ┌──────────────┐     stdin/stdout     ┌────────┐
│  React Client   │ ◄────────────────► │ This Server  │ ◄──────────────────► │  Kimi  │
│ (kimi-ide-client│                    │  (server.js) │    (JSON-RPC)        │ --wire │
└─────────────────┘                    └──────────────┘                      └────────┘
         ▲                                    │
         │        HTTP (static files)          │
         └─────────────────────────────────────┘
                      Serves: kimi-ide-client/dist/
```

### File Structure

```
kimi-ide-server/
├── server.js              # Main entry point — Express + WebSocket server
├── config.js              # Configuration persistence manager
├── package.json           # Dependencies: express, ws, uuid
├── README.md              # Human-focused overview
├── AGENTS.md              # This file
├── STREAMING_RENDER_SPEC.md  # Protocol specification
├── data/                  # Runtime data storage (gitignored)
│   └── config.json        # User settings, project state, chat history
├── pipeline/              # Job pipeline folders (launch, active, complete, merged)
├── components/            # Reusable UI components (modal, confirmation)
├── docs/                  # Additional documentation
├── archive/               # Legacy vanilla JS client (NOT served)
│   ├── README.md
│   └── legacy-vanilla-client.html
└── popup-demo.html        # Standalone modal demo
```

---

## Core Modules

### 1. `server.js` — Main Server

**Responsibilities:**
- Express HTTP server for static file serving
- WebSocket server for real-time client communication
- Kimi wire process lifecycle management
- Protocol translation (JSON-RPC ↔ WebSocket)
- File explorer API handlers

**Key Components:**

| Function | Purpose |
|----------|---------|
| `spawnWireSession()` | Spawns `kimi --wire --yolo` process |
| `sendToWire()` | Sends JSON-RPC messages to Kimi CLI |
| `handleFileTreeRequest()` | Returns folder contents for file explorer |
| `handleFileContentRequest()` | Returns file contents |
| WebSocket handlers | Manages session state, message forwarding |

**Session State Structure:**
```javascript
{
  wire: ChildProcess,          // Reference to Kimi process
  sessionId: string,           // UUID for this connection
  currentTurn: {               // Current AI response state
    id: string,
    text: string,              // Accumulated text content
    status: 'streaming' | 'complete'
  },
  buffer: string,              // Incomplete line buffer from stdout
  toolArgs: {},                // Accumulated tool arguments per tool_call_id
  activeToolId: string | null  // Currently streaming tool
}
```

**Wire Events Handled:**
- `TurnBegin` / `TurnEnd` — Turn lifecycle
- `ContentPart` (text/think) — Streaming content
- `ToolCall` / `ToolCallPart` / `ToolResult` — Tool execution
- `StepBegin` — Reasoning steps
- `StatusUpdate` — Token/context usage

**WebSocket Message Types (Client ↔ Server):**
- `prompt` — Send user input to Kimi
- `response` — Client response to agent request
- `initialize` — Handshake on connection
- `file_tree_request` / `file_tree_response` — File explorer
- `file_content_request` / `file_content_response` — File reading

### 2. `config.js` — Configuration Manager

**Responsibilities:**
- Load/save user configuration from `data/config.json`
- Project-specific settings and panel state
- Chat history persistence (separate files per project/panel)

**API:**
```javascript
getConfig()                    // Get current config (cached)
updateConfig(updates)          // Merge and save updates
setLastProject(projectPath)    // Track most recent project
getProjectConfig(projectPath)  // Get project-specific config
setPanelState(...)         // Save panel UI state
saveChatHistory(...)           // Persist chat messages
loadChatHistory(...)           // Retrieve chat messages
```

**Config Structure:**
```javascript
{
  version: '1.0',
  lastProject: '/path/to/project',
  projects: {
    '/path/to/project': {
      path: '/path/to/project',
      panels: { 'code': { ...state } }
    }
  },
  settings: {
    theme: 'dark',
    fontSize: 14,
    autoSave: true
  }
}
```

---

## Protocols

### Wire Protocol (Server ↔ Kimi CLI)

JSON-RPC 2.0 over STDIO (newline-delimited):

**Server → Kimi (Request):**
```json
{
  "jsonrpc": "2.0",
  "method": "prompt",
  "params": { "user_input": "Hello" },
  "id": "uuid-v4"
}
```

**Kimi → Server (Event):**
```json
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

Bidirectional JSON messages. See `STREAMING_RENDER_SPEC.md` for complete specification.

---

## File Explorer API

**Security Features:**
- Path traversal guard (resolves and validates paths)
- Large folder guard (max 1000 items)
- Hidden file/folder exclusion (dotfiles)
- `node_modules` exclusion

**Panels:**
- `explorer` — Maps to current project root (filesystem-backed)
- Other panels — GUI-based (null = no filesystem access)

**Project Root Resolution:**
1. Use `config.lastProject` if set and exists
2. Default to parent directory of server (`..`)

---

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3001` | HTTP server port |
| `KIMI_PATH` | `kimi` | Path to Kimi CLI executable |

---

## Development Guidelines

### Where to Edit Code

**⚠️ IMPORTANT:** Do NOT edit files in `public/` or `archive/` for UI changes.

The server ONLY serves the React client from `../kimi-ide-client/dist/`.

- **UI Components:** Edit in `kimi-ide-client/src/components/`
- **Styling:** Edit in `kimi-ide-client/src/styles/`
- **State:** Edit in `kimi-ide-client/src/state/`

### Running the Server

```bash
node server.js
```

### Debugging

**Wire Debug Log:** `wire-debug.log`
- All wire communication logged with timestamps
- Full messages (not truncated)

**Console Prefixes:**
- `[→ Wire]` — Messages sent to Kimi
- `[← Wire]` — Messages received from Kimi
- `[WS →]` — Messages from WebSocket client
- `[Think]` — Thinking content received
- `[Server]` — Server lifecycle events
- `[Config]` — Configuration operations

---

## Common Tasks

### Adding New Wire Event Handlers

1. Add parsing logic in `wire.stdout.on('data', ...)` switch statement
2. Forward to client via `ws.send(JSON.stringify({...}))`
3. Document in `STREAMING_RENDER_SPEC.md`

### Adding New File Explorer Features

1. Add handler function (follow `handleFileTreeRequest` pattern)
2. Validate panel with `getPanelPath()`
3. Apply path traversal guard: `path.resolve(targetPath).startsWith(basePath)`
4. Register in WebSocket message handler switch

### Modifying Configuration Schema

1. Update `getDefaultConfig()` in `config.js`
2. Add helper functions following existing patterns
3. Export in `module.exports`

---

## Dependencies

```json
{
  "express": "^5.2.1",     // HTTP server and static file serving
  "ws": "^8.19.0",         // WebSocket server
  "uuid": "^13.0.0"        // UUID generation for session/message IDs
}
```

---

## Related Projects

- **`kimi-ide-client/`** — React-based web UI (sibling directory)
- **`kimi-ide/`** — Legacy/related project (parent directory)

---

## Notes for AI Agents

1. **This is a BRIDGE, not a UI.** All visual changes belong in `kimi-ide-client`.

2. **Always use config helpers** — Don't read/write `data/config.json` directly.

3. **Wire process lifecycle** — One Kimi process per WebSocket connection. Cleaned up on disconnect.

4. **Path security** — Always validate paths with `path.resolve().startsWith(basePath)`.

5. **Buffer handling** — Wire protocol uses NDJSON; incomplete lines stay in `session.buffer`.

6. **Logging** — Use `console.log('[Prefix] message')` pattern for consistency.

7. **Archive folder** — Contains legacy code for reference only; never serve from here.
