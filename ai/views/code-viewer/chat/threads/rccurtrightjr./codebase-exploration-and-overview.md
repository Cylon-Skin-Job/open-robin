# Codebase exploration and overview

User

What can you tell me about my codebase?

Assistant

I'll explore your codebase to give you a comprehensive overview.Let me check the package configurations and key architecture files:Based on my exploration, here's a comprehensive overview of your codebase:

## Project Overview: **Open Robin (kimi-claude)**

This is a **web-based IDE** that acts as a visual interface for command-line AI assistants (Kimi, Claude, Qwen, Codex, Gemini, OpenCode). The CLI handles all AI inference; Open Robin is a harness/display layer.

### Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  CLIENT (Browser) - React + TypeScript + Vite                │
│  ├── Components (pure UI renderers)                          │
│  ├── State (Zustand)                                         │
│  └── Hooks (WebSocket bridge)                                │
├──────────────────────────────────────────────────────────────┤
│  SERVER (Node.js + Express + WebSocket)                      │
│  └── Bridges WebSocket ↔ JSON-RPC over STDIO                 │
├──────────────────────────────────────────────────────────────┤
│  CLI (kimi/claude/qwen/etc.) - External AI process           │
└──────────────────────────────────────────────────────────────┘
```

### Key Technologies

| Component | Stack |
|-----------|-------|
| **Frontend** | React 19 + TypeScript + Vite |
| **State** | Zustand |
| **Backend** | Node.js + Express + WebSocket (`ws`) |
| **Database** | SQLite (better-sqlite3 + Knex) |
| **Styling** | CSS with Raven OS-inspired Tron aesthetic |

### Directory Structure

| Path | Purpose |
|------|---------|
| `kimi-ide-client/src/components/` | 50+ React components (chat, file explorer, wiki, tickets, etc.) |
| `kimi-ide-client/src/state/` | Zustand stores (workspace, file, wiki, tickets, agents) |
| `kimi-ide-client/src/lib/` | Core libraries: tool renderers, chunk strategies, text animation |
| `kimi-ide-client/src/hooks/` | WebSocket, file tree, panel data hooks |
| `kimi-ide-server/` | WebSocket bridge server + SQLite database |
| `ai/` | Project intelligence layer (workspaces, specs, system DB) |
| `docs/` | 16 architecture & spec documents |

### Key Features

1. **Seven Workspaces** (color-coded tabs):
   - `browser` (blue) - Browser-based tools
   - `code` (cyan) - File editor, diffs
   - `rocket` (orange) - Deployments, builds
   - `issues` (yellow) - Tasks, processes
   - `wiki` (pink) - Documentation
   - `claw` (red) - Direct CLI chat
   - `skills` (purple) - Commands, prompts

2. **Pulse-Driven Render Engine**: 500ms pulse drives all state transitions, decoupling data arrival from visual presentation

3. **Multi-CLI Support**: Supports Kimi, Claude, Qwen, Codex, Gemini, OpenCode via harnesses

4. **File Explorer**: Multi-tab file browser with syntax highlighting

5. **Wiki System**: Topic-based documentation with edge panel viewer

6. **Ticket Board**: Kanban-style issue tracking

7. **Clipboard Integration**: Monitors clipboard for new content

8. **Voice Input**: Whisper-based transcription

### Development Workflow

```bash
# Restart script (recommended after UI changes)
./restart-kimi.sh

# Or manually:
cd kimi-ide-client && npm run build
cd ../kimi-ide-server && node server.js
# Then http://localhost:3001
```

**Critical**: After any client change, you must rebuild (`npm run build`) — the server serves static files from `dist/`, not the dev server.

### Notable Patterns

- **Thin Client**: Frontend is pure rendering; all state/intelligence is in backend
- **Forbidden Patterns**: Components cannot use `setTimeout`, `setInterval`, or call `store.setState()` directly
- **One Bridge, One Direction**: Engine → Bridge → Store → Components
- **Secrets**: Stored in macOS Keychain (account: `kimi-ide`), never `.env` files

### Documentation Highlights

- `docs/RENDER_ENGINE_ARCHITECTURE.md` - Pulse/queue/state machine
- `docs/TYPESCRIPT_REACT_SPEC.md` - Component patterns & forbidden practices  
- `docs/WIRE_PROTOCOL.md` - JSON-RPC protocol reference
- `docs/UI_THEME_SURFACE.md` - Design tokens & theming

This is a sophisticated IDE project with ~150 TypeScript/React files, focused on creating a visual interface for AI CLI tools while maintaining clean separation between rendering and logic.

**TOOL CALL(S)**

<!-- metadata: {"contextUsage":0.09147262573242188,"tokenUsage":{"input_other":1195,"output":999,"input_cache_read":22784,"input_cache_creation":0},"messageId":"chatcmpl-tqjNoZVzH4YKhD2r6B4EG6A4","planMode":false,"capturedAt":1775457953992} -->
