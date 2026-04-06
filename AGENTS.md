# AGENTS.md - Open Robin

> Agent-focused documentation for the Open Robin project — a web-based IDE that reads CLI wire protocols (RPC) and renders AI output in a visual interface. The CLI handles all AI inference; Open Robin is a harness/display layer, not an AI itself.

## ⚠️ CRITICAL PREREQUISITE: One Server

**One Node process** serves the React app from `open-robin-client/dist/`, HTTP, and the WebSocket bridge to the active CLI (default **port 3001**, or `PORT`).

The client is **not** hot-reloaded by the server: after UI changes, run **`npm run build`** in `open-robin-client/` (or **`./restart-kimi.sh`**, which builds then starts the server).

### Quick start
```bash
# From project root — rebuild client and restart server
./restart-kimi.sh
# Open http://localhost:3001
```

### Or manually
```bash
cd open-robin-client && npm run build
cd ../open-robin-server && node server.js
```

**Optional:** `npm run dev` in `open-robin-client` runs Vite’s dev server for local HMR; that is separate from production-like testing on port 3001. Day-to-day testing uses **3001** + **`dist/`**.

---

## Project Overview

This is a **web-based IDE** that integrates with command-line AI assistants via their wire protocols to provide an AI-powered development environment. Multiple CLIs supported: kimi, claude, qwen, codex, gemini, opencode. It uses a thin-client architecture where the backend handles all state and intelligence, and the frontend is purely for rendering.

### Key Technologies
- **Frontend:** React 19 + TypeScript + Vite
- **Backend:** Node.js + Express + WebSocket
- **State Management:** Zustand
- **Styling:** CSS with Raven OS-inspired Tron aesthetic
- **Protocol:** JSON-RPC 2.0 over WebSocket

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (Browser)                                │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                     React + TypeScript (Vite)                         │  │
│  │  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌──────────┐  │  │
│  │  │  Components │   │   Store     │   │   Hooks     │   │  Engine  │  │  │
│  │  │  (Pure UI)  │◄──│  (Zustand)  │◄──│  (Bridge)   │◄──│  (Pulse) │  │  │
│  │  └─────────────┘   └─────────────┘   └─────────────┘   └──────────┘  │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│                              WebSocket (ws://localhost:3001)               │
└────────────────────────────────────┼────────────────────────────────────────┘
                                     │
┌────────────────────────────────────┼────────────────────────────────────────┐
│                           SERVER (Node.js)                                   │
│                                    │                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                      Express + WebSocket Server                       │  │
│  │                         (open-robin-server/)                            │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│                          stdin/stdout (JSON-RPC)                            │
│                                    │                                        │
│                           ┌────────┴────────┐                               │
│                           │   Active CLI    │                               │
│                           │  (kimi/claude/  │                               │
│                           │  qwen/codex/etc)│                               │
│                           └─────────────────┘                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
kimi-claude/
├── open-robin-client/          # React + TypeScript + Vite frontend
│   ├── src/
│   │   ├── components/       # UI components (pure renderers)
│   │   │   ├── App.tsx
│   │   │   ├── ChatArea.tsx
│   │   │   ├── MessageList.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   ├── ToolsPanel.tsx
│   │   │   ├── ContentArea.tsx
│   │   │   ├── file-explorer/
│   │   │   └── Ribbon/
│   │   ├── state/            # Zustand store
│   │   │   └── workspaceStore.ts
│   │   ├── hooks/            # React hooks
│   │   │   └── useWebSocket.ts
│   │   ├── lib/              # Utility libraries
│   │   │   ├── simpleQueue.ts
│   │   │   ├── contentAccumulator.ts
│   │   │   ├── instructions.ts
│   │   │   └── markdownBlocks.ts
│   │   ├── types/            # TypeScript types
│   │   │   └── index.ts
│   │   ├── styles/           # CSS files
│   │   │   ├── variables.css
│   │   │   └── animations.css
│   │   ├── main.tsx          # Entry point
│   │   └── index.css         # Global styles
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
│
├── open-robin-server/          # Node.js WebSocket bridge server
│   ├── server.js             # Main server entry
│   ├── config.js             # Configuration manager
│   ├── components/           # Reusable UI components
│   ├── data/                 # Runtime data (gitignored)
│   ├── pipeline/             # Job pipeline folders
│   └── archive/              # Legacy code (NOT served)
│
├── ai/
│   ├── system/                  # Local runtime state (gitignored)
│   │   ├── robin.db             # SQLite — all persistent data
│   │   └── README.md            # Scope, git policy, migration path
│   └── views/                   # Workspace view assets + injected CSS
│
├── docs/                     # Documentation
│   ├── RENDER_ENGINE_ARCHITECTURE.md  # Pulse-driven render engine
│   ├── TYPESCRIPT_REACT_SPEC.md       # Code spec & patterns
│   ├── STYLE_GUIDE.md                 # Toolbar/menu chrome; see UI_THEME_SURFACE for tokens
│   ├── UI_THEME_SURFACE.md            # Shell/chat tokens & surfaces (current)
│   ├── WIRE_PROTOCOL.md               # JSON-RPC protocol
│   ├── STREAMING_CONTENT.md           # Streaming content handling
│   └── ...
│
├── scripts/                  # Utility scripts
│   └── capture-wire-output.js
│
├── README.md                 # Human-focused overview
├── ROADMAP.md                # Architecture roadmap
└── AGENTS.md                 # This file
```

---

## ⚠️ CRITICAL: Which Code Is Active?

**ONLY edit files in `open-robin-client/` for UI changes.**

The server no longer serves files from `public/` — it serves the React client from `open-robin-client/dist/` after you build it.

### Code Status:
| Location | Status | Notes |
|----------|--------|-------|
| `open-robin-client/src/` | ✅ **ACTIVE** | React + TypeScript implementation |
| `open-robin-server/` | ✅ **ACTIVE** | WebSocket bridge server |
| `open-robin-server/archive/` | ❌ **DEAD CODE** | Preserved for reference only |

---

## Core Concepts

### 1. Thin Client Architecture

- **Frontend**: Pure rendering layer, no business logic
- **Backend**: All state, intelligence, and persistence
- **Communication**: WebSocket with JSON-RPC protocol

### 2. Pulse-Driven Render Engine

The render engine decouples data arrival from visual presentation:

- **500ms pulse** drives all state transitions
- **Job queue** buffers render instructions
- **Engine owns all timing** — components are pure renderers
- **One bridge, one direction**: Engine → Bridge → Store → Components

See `docs/RENDER_ENGINE_ARCHITECTURE.md` for complete specification.

### 3. Workspaces

Seven workspace tabs with distinct colors:

| Workspace | Color | Icon | Purpose |
|-----------|-------|------|---------|
| `browser` | Blue | `captive_portal` | Browser-based tools |
| `code` | Cyan | `code_blocks` | File editor, diffs |
| `rocket` | Orange | `rocket` | Deployments, builds |
| `issues` | Yellow | `business_messages` | Tasks, processes |
| `wiki` | Pink | `full_coverage` | Documentation |
| `claw` | Red | `robot_2` | Direct CLI chat |
| `skills` | Purple | `wand_shine` | Commands, prompts |

### 4. User Modes

Three interaction modes:
- **Riff Mode**: Fast brainstorming, no tools
- **Vibe Mode**: Quick edits with file tools
- **Plan Mode**: Structured, step-by-step with validation

---

## Development Guidelines

### Where to Edit Code

| Task | Location |
|------|----------|
| UI Components | `open-robin-client/src/components/` |
| Styling | `open-robin-client/src/styles/` |
| State Management | `open-robin-client/src/state/` |
| WebSocket Logic | `open-robin-client/src/hooks/` |
| Type Definitions | `open-robin-client/src/types/` |
| Server Bridge | `open-robin-server/server.js` |

### Forbidden Patterns (from `docs/TYPESCRIPT_REACT_SPEC.md`)

Components MUST NOT:
- Use `setTimeout` / `setInterval` (engine's job)
- Use `useEffect` for orchestration (engine state machine)
- Call `store.setState()` directly (use `engine.enqueue()`)
- Manage timing logic (belongs in engine)

### Allowed Patterns

- `useStore(selector)` for reading state
- `useState` for local UI only (hover, input values)
- `useRef` for DOM references
- `onClick={() => engine.enqueue(...)}` for user actions
- CSS transitions via `className`

### File Header Convention

```typescript
/**
 * @module ComponentName
 * @role Pure renderer for [purpose]
 * @reads workspaceStore: [fields read]
 * @emits engine.enqueue (user interactions)
 */
```

---

## Development Workflow

### 1. Install (once)

```bash
cd open-robin-client && npm install
```

### 2. Build the client

```bash
cd open-robin-client
npm run build
# Output: dist/ — this is what the server serves
```

### 3. Start the server

```bash
cd open-robin-server
node server.js
# App + WebSocket: http://localhost:3001
```

### 4. Testing & restart (CRITICAL)

**After client (`open-robin-client/src/`) or bundle-affecting changes:** rebuild and restart the Node process so `dist/` is current.

**Quick restart (recommended):**
```bash
# From project root
./restart-kimi.sh
```

**Manual:**
```bash
lsof -ti:3001 | xargs kill -9 2>/dev/null || true
cd open-robin-client && npm run build
cd ../open-robin-server && node server.js &
```

**⚠️ AGENT RULE after UI changes:**
1. Run `./restart-kimi.sh` (or build + `node server.js`)
2. Wait until the server is listening
3. **Then** tell the user to refresh the browser (hard refresh if assets look stale)

**Why:** The server only serves **`open-robin-client/dist/`**. There is no separate frontend port in the default workflow; `npm run build` is required for changes to appear on **3001**.

---

## Key Technologies & Dependencies

### Client (`open-robin-client/package.json`)

```json
{
  "dependencies": {
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "zustand": "^5.0.11",
    "marked": "^17.0.3",
    "highlight.js": "^11.11.1"
  },
  "devDependencies": {
    "vite": "^7.3.1",
    "typescript": "~5.9.3"
  }
}
```

### Server (`open-robin-server/package.json`)

```json
{
  "dependencies": {
    "express": "^5.2.1",
    "ws": "^8.19.0",
    "uuid": "^13.0.0"
  }
}
```

---

## Wire Protocol (Server ↔ Active CLI)

JSON-RPC 2.0 over STDIO (newline-delimited):

**Server → CLI:**
```json
{"jsonrpc":"2.0","method":"prompt","id":"uuid","params":{"user_input":"Hello"}}
```

**CLI → Server (Event):**
```json
{"jsonrpc":"2.0","method":"event","params":{"type":"ContentPart","payload":{"type":"text","text":"Hello"}}}
```

See `docs/WIRE_PROTOCOL.md` for complete specification.

---

## WebSocket Protocol (Client ↔ Server)

Message types:
- `initialize` — Handshake on connection
- `prompt` — Send user input to active CLI
- `turn_begin` / `turn_end` — Turn lifecycle
- `content` / `thinking` — Streaming content
- `tool_call` / `tool_result` — Tool execution
- `file_tree_request` / `file_content_request` — File explorer

---

## Documentation Reference

| Document | Purpose | Read Before... |
|----------|---------|----------------|
| `docs/RENDER_ENGINE_ARCHITECTURE.md` | Pulse, queue, state machine | Touching orchestration code |
| `docs/TYPESCRIPT_REACT_SPEC.md` | Code spec, forbidden patterns | Writing components |
| `docs/STYLE_GUIDE.md` | Toolbar/menu chrome (see UI_THEME_SURFACE for tokens) | Styling components |
| `docs/UI_THEME_SURFACE.md` | Tokens, neutral vs accent borders, CSS file map | Shell/chat/explorer chrome |
| `docs/HANDOFF_PROMPT_UI_SESSION.md` | Pasteable context for a fresh session | After UI theme work |
| `ai/system/README.md` | DB scope, git policy, Electron migration path | Adding tables, questioning DB location |
| `docs/WIRE_PROTOCOL.md` | JSON-RPC protocol | Protocol changes |
| `docs/STREAMING_CONTENT.md` | Streaming content handling | Content rendering |
| `docs/VISION_CLONE_PIPELINE.md` | Future: multi-agent pipeline | Architecture planning |
| `docs/VISION_RESEARCH_ASSISTANT.md` | Future: research pipeline | Feature planning |

---

## Secrets

All credentials are stored in **macOS Keychain** (account: `kimi-ide`). No `.env` files, no GCP secrets, no config objects, no plain text anywhere.

| Secret | Service Name | Purpose |
|--------|-------------|---------|
| GitLab Token | `GITLAB_TOKEN` | Wiki sync, API calls, git credentials |

**Access from shell / Claude skills:**
```bash
TOKEN=$(security find-generic-password -a "kimi-ide" -s "GITLAB_TOKEN" -w 2>/dev/null)
```

**Access from Node.js:**
```js
const secrets = require('./open-robin-server/lib/secrets');
const token = await secrets.get('GITLAB_TOKEN');
```

**Never use** `gcloud secrets` or `.env` files. See `ai/workspaces/wiki/secrets/PAGE.md` for the full API reference (`get`, `set`, `del`, `has`, `getMany`).

---

## The `ai/` Folder — Project Intelligence Layer

Every project that uses Kimi IDE has an `ai/` folder at its root. This is the project's intelligence layer — where workspaces, agents, specs, and state live. It is not application code; it is the AI coordination surface.

```
{projectRoot}/ai/
├── STATE.md                  ← Cross-workspace activity log
├── TICKETING-SPEC.md         ← Ticketing system specification
├── WORKSPACE-AGENT-SPEC.md   ← Agent execution specification
└── workspaces/               ← All workspace folders
    ├── workspaces.json       ← Tab ordering for the client UI
    ├── coding-agent/         ← type: file-explorer
    ├── pre-flight/           ← type: checklist
    ├── launch/               ← type: pipeline
    ├── review/               ← type: review
    ├── issues/               ← type: ticket-board
    ├── wiki/                 ← type: wiki-viewer
    ├── background-agents/    ← type: agent-tiles
    └── skills/               ← type: skill-library
```

### How Workspaces Work

Each workspace folder contains a `workspace.json` that declares its identity, type, theme, and settings. The `type` field drives how the client renders it — `wiki-viewer` renders topic pages, `ticket-board` renders an issue board, `agent-tiles` renders agent status cards, etc.

```json
{
  "id": "wiki",
  "name": "Wiki",
  "type": "wiki-viewer",
  "icon": "full_coverage",
  "hasChat": true,
  "theme": { "primary": "#ec4899", ... }
}
```

**The folder IS the workspace.** The client reads `workspaces.json` for tab ordering, then reads each folder's `workspace.json` to build the UI. Adding a workspace = adding a folder with a `workspace.json` + registering it in `workspaces.json`.

### Workspace Types and Their Internal Structure

Different workspace types expect different folder contents:

| Type | Internal Structure | Example |
|------|-------------------|---------|
| `wiki-viewer` | Subfolders per topic, each with `PAGE.md` + `LOG.md` | `wiki/secrets/PAGE.md` |
| `ticket-board` | Ticket markdown files at root, `done/` subfolder for closed | `issues/KIMI-0001.md` |
| `agent-tiles` | Agent subfolders with `AGENT.md`, `agent.json`, `prompts/` | `background-agents/agents/wiki-updater/` |
| `file-explorer` | Thread storage in `threads/` | `coding-agent/threads/` |
| `pipeline` | Pipeline step definitions | `launch/` |

### Key Principle

The `ai/` folder is portable. When Kimi IDE opens a different project, it reads that project's `ai/workspaces/` — not this repo's. All paths must be relative to the project root.

---

## Environment Variables

### Server

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3001` | HTTP server port |
| `KIMI_PATH` | `kimi` | Path to default CLI executable (kimi, claude, etc.) |

### CLI Registry

Available CLIs: `kimi`, `claude`, `qwen`, `codex`, `gemini`, `opencode`. User must have at least one installed. The **active CLI** is set per-system in `robin.db` (`cli_registry` table). Multiple CLIs can be installed simultaneously; switching the active CLI does not affect project state, chat history, triggers, or settings.

**Switching CLIs:** Changing the active CLI starts a fresh session bound to that CLI. Sessions do not transfer between CLIs—each session remains tied to the CLI that created it. Users can fork conversations across CLIs via message ID + `/fork` command.

**Payment:** Open Robin is free. Token costs go to the CLI provider. Two modes: (1) CLI sign-in = metered plan from provider, often cheaper than raw API. (2) BYO API key = user provides own key via LLM Providers tab or Secrets. Free tiers exist (Qwen, Gemini offer generous daily limits).

---

## Project Root & File Storage

### Critical: Always Use Project Root Relative Paths

The Kimi IDE is designed to work with ANY project. All file storage must be relative to the **current project root**, not hardcoded to `kimi-claude/`.

### Project Root Detection

**Use `getDefaultProjectRoot()`** (defined in `open-robin-server/server-with-threads.js`):

```javascript
function getDefaultProjectRoot() {
  const cfg = config.getConfig();
  if (cfg.lastProject && fs.existsSync(cfg.lastProject)) {
    return path.resolve(cfg.lastProject);
  }
  return path.resolve(path.join(__dirname, '..'));
}
```

This function:
1. Returns `config.lastProject` if set and exists
2. Falls back to parent directory of server (for development)

### AI Workspaces Path Pattern

**CORRECT:**
```javascript
const projectRoot = getDefaultProjectRoot();
const aiWorkspacesPath = path.join(projectRoot, 'ai', 'workspaces');
```

**INCORRECT:**
```javascript
// ❌ Hardcoded - breaks when used as IDE for other projects
const AI_WORKSPACES_PATH = path.join(__dirname, '..', 'ai', 'workspaces');
```

### Per-Workspace Thread Storage

Each workspace gets its own thread storage:
```
{projectRoot}/ai/workspaces/{workspaceId}/
├── threads/
│   ├── {threadId}/
│   │   └── CHAT.md
│   └── threads.json (index)
```

### Key Rule

When the IDE is used on another project (e.g., `~/projects/my-app/`), threads should be stored at:
- `~/projects/my-app/ai/workspaces/code/threads/`

NOT at:
- `~/projects/kimi-claude/ai/workspaces/code/threads/`

---

## Database (`ai/system/robin.db`)

The server uses **SQLite** (Knex + better-sqlite3) for all persistent state. The database file lives at **`{projectRoot}/ai/system/robin.db`** — inside the workspace, not in a global app-data directory.

### Why it is workspace-scoped

`initDb(projectRoot)` receives the **project root** and opens `ai/system/robin.db` relative to it. Each project the IDE opens gets its own database. This is intentional:

- Chat history, threads, wiki pages, and workspace config are **per-project** — they travel with the repo folder (but are `.gitignore`d).
- The server runs one Node process per project. There is no multi-project session.
- Features added to the database (clipboard, metadata, etc.) are contextual to the workspace session.

### What is in the database

Threads, exchanges (chat history), `system_config`, `system_wiki`, `system_tabs`, `cli_registry`, `system_theme`, `workspaces`, `workspace_themes` — and any tables added by future migrations.

### Adding a new table

1. Create a migration file in `open-robin-server/lib/db/migrations/` (e.g. `005_clipboard.js`).
2. Follow the existing pattern: `exports.up` / `exports.down`, receive `knex`, create/seed/drop.
3. Migrations run automatically on server startup (`initDb` calls `migrate.latest()`).
4. Write a query module in `open-robin-server/lib/` (pattern: every function takes `db` as the first argument, no global DB reference inside the module).

### Git policy

`ai/system/` should be in `.gitignore`. The `.db` file is binary and may contain sensitive data. Do not commit it. See `ai/system/README.md` for full details.

### Electron migration path

When this app is packaged as Electron, the **only** change is **who calls `initDb` and with what path**. Electron's main process calls `initDb(electronChosenPath)` instead of `server.js` doing it. The Knex instance, migrations, query modules, and table schemas are unchanged. Do not propose a separate "host-level" database unless the product explicitly requires cross-workspace data that persists without a server restart.

---

## Common Tasks

### Adding a New Component

1. Create file in `open-robin-client/src/components/`
2. Add header comment with @module, @role, @reads
3. Use `useWorkspaceStore()` to read state
4. No timers, no direct store writes
5. Import and use in parent component
6. Update styles in `src/styles/` if needed

### Adding a New Workspace

1. Add to `WorkspaceId` type in `src/types/index.ts`
2. Add config to `WORKSPACE_CONFIGS` object
3. Component renders automatically (mapped in App.tsx)

### Modifying the Wire Protocol

1. Update parsing in `server.js`
2. Add message type to `WebSocketMessage` in `src/types/index.ts`
3. Add handler in `useWebSocket.ts`
4. Document in `docs/WIRE_PROTOCOL.md`

---

## Notes for AI Agents

1. **This is a BRIDGE architecture.** The server translates between WebSocket and CLI wire protocol (Kimi, Claude, Qwen, etc.). The client is a pure renderer.

2. **The engine owns timing.** Components never use `setTimeout` or `setInterval`. All timing flows through the pulse-driven engine.

3. **One bridge, one direction.** Engine → Bridge → Store → Components. Never bypass the bridge.

4. **Tokens are tokens.** Think, text, and tool calls all go into ONE ordered queue. They MUST stay in order.

5. **Buffering buys time.** The ribbon, shimmer holds, and typing effects are NOT decorative — they stall the UI so content buffers ahead of display.

6. **Archive folder is dead.** Do not edit files in `open-robin-server/archive/` — they are preserved for reference only.

7. **Build required.** Client changes require `npm run build` to be served by the server.

8. **Type safety matters.** TypeScript catches many errors at compile time. Run `npm run build` to check.

9. **The database is workspace-scoped.** `robin.db` lives at `{projectRoot}/ai/system/robin.db` — this is correct. Do not propose moving it to a global/host directory or creating a second database. The path is injected via `initDb(projectRoot)`; when Electron wraps this app, only the caller changes, not the DB layer. See `ai/system/README.md`.

---

*Last Updated: 2026-03-21*
*Applies to: kimi-claude project (open-robin-client + open-robin-server)*
