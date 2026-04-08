# Web-based AI IDE architecture

User

What can you tell me about this codebase?

Assistant

Based on the documentation, here's what this codebase is:

## Open Robin — A Web-Based AI IDE

**Open Robin** is a visual interface that integrates with command-line AI assistants (Kimi, Claude, Qwen, Codex, Gemini, Opencode). It acts as a **bridge/harness layer** — the CLI handles all AI inference, and Open Robin renders the output in a polished web interface.

### Architecture

```
┌─────────────┐     WebSocket      ┌─────────────┐     JSON-RPC      ┌─────────┐
│   React     │◄──────────────────►│ Node.js     │◄─────────────────►│  CLI    │
│  (Browser)  │                    │  Server     │    (stdin/stdout) │ (Kimi,  │
│             │   Thin Client      │   :3001     │                   │ Claude, │
│ Pure UI     │                    │  Bridge     │                   │  etc.)  │
└─────────────┘                    └─────────────┘                   └─────────┘
```

### Key Technologies
- **Frontend**: React 19 + TypeScript + Vite + Zustand (state)
- **Backend**: Node.js + Express + WebSocket (`ws`)
- **Database**: SQLite (`ai/system/robin.db`) for threads, chat history, config
- **Styling**: Raven OS-inspired "Tron" aesthetic with CSS variables

### Project Structure

| Directory | Purpose |
|-----------|---------|
| `kimi-ide-client/` | React frontend — **active code** |
| `kimi-ide-server/` | WebSocket bridge server |
| `ai/workspaces/` | Project intelligence layer (wiki, tickets, agents, skills) |
| `docs/` | Extensive architecture & spec docs |

### Core Concepts

1. **Pulse-Driven Render Engine** — A 500ms pulse drives all state transitions; components are pure renderers with no timers
2. **Seven Workspaces** — Color-coded tabs: Browser (blue), Code (cyan), Rocket (orange), Issues (yellow), Wiki (pink), Claw (red), Skills (purple)
3. **Three User Modes** — Riff (brainstorming), Vibe (quick edits), Plan (structured with validation)
4. **Workspace-Scoped Data** — Each project gets its own `ai/` folder and SQLite database

### Key Files
- `docs/RENDER_ENGINE_ARCHITECTURE.md` — Job queue, state machine
- `docs/TYPESCRIPT_REACT_SPEC.md` — Component patterns & forbidden patterns
- `docs/UI_THEME_SURFACE.md` — Design tokens
- `docs/WIRE_PROTOCOL.md` — JSON-RPC protocol spec

### Development Workflow
```bash
./restart-kimi.sh  # Build client + restart server on :3001
```

The server serves the built React app from `kimi-ide-client/dist/` — client changes require a rebuild to appear.

**TOOL CALL(S)**

<!-- metadata: {"contextUsage":0.10291671752929688,"tokenUsage":{"input_other":9315,"output":829,"input_cache_read":17664,"input_cache_creation":0},"messageId":"chatcmpl-fMnWe6GAsDnI6DHAw50hTi6p","planMode":false,"capturedAt":1775464245050} -->
