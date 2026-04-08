# Open Robin web-based IDE

User

Tell me about this project.

Assistant

This is **Open Robin** (repo name: `kimi-claude`) — a web-based IDE that reads CLI wire protocols from AI assistants (Kimi, Claude, Qwen, Codex, Gemini, OpenCode) and renders their output in a visual interface.

## Overview

Open Robin acts as a **display layer**, not an AI itself. The CLI handles all AI inference; this IDE provides a rich visual harness for interacting with it.

## Architecture

```
┌─────────────┐      WebSocket       ┌─────────────┐      JSON-RPC       ┌──────────┐
│   Browser   │◄────────────────────►│ Node Server │◄───────────────────►│   CLI    │
│  (React UI) │   (port 3001)        │  (bridge)   │    (stdin/stdout)   │   (AI)   │
└─────────────┘                      └─────────────┘                     └──────────┘
```

## Key Components

| Directory | Purpose |
|-----------|---------|
| `kimi-ide-client/` | React 19 + TypeScript + Vite frontend |
| `kimi-ide-server/` | Node.js Express + WebSocket bridge server |
| `ai/` | Project intelligence layer — workspaces, specs, state |

## Core Concepts

- **Thin Client**: Frontend is pure rendering; all state lives in the backend
- **Pulse-Driven Engine**: 500ms pulse drives state transitions; components never use `setTimeout`
- **Workspaces**: 7 tabs (browser, code, rocket, issues, wiki, claw, skills) with distinct themes
- **Wire Protocol**: JSON-RPC 2.0 over WebSocket (client↔server) and STDIO (server↔CLI)

## Tech Stack

- **Frontend**: React 19, Zustand (state), Vite, marked, highlight.js
- **Backend**: Node.js, Express, WebSocket (`ws`), SQLite (better-sqlite3 + Knex)
- **Styling**: CSS with Raven OS-inspired Tron aesthetic

## Development Notes

- Client changes require `npm run build` in `kimi-ide-client/` — the server serves static files from `dist/`
- Use `./restart-kimi.sh` to rebuild and restart after UI changes
- Database at `ai/system/robin.db` is per-project (workspace-scoped, `.gitignore`d)

The project essentially turns CLI-based AI interactions into a modern IDE experience with file explorers, chat interfaces, and workspace organization.

<!-- metadata: {"contextUsage":0.06806182861328125,"tokenUsage":{"input_other":9906,"output":603,"input_cache_read":7936,"input_cache_creation":0},"messageId":"chatcmpl-hQ7OvyXkvWnJeirmOyiDa2UC","planMode":false,"capturedAt":1775459746496} -->
