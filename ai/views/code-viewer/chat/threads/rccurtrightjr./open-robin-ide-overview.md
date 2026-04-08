# Open Robin IDE Overview

User

What can you tell me about this project?

Assistant

Based on the project files, this is **Open Robin** — a web-based IDE that integrates with command-line AI assistants (Kimi, Claude, Qwen, Codex, Gemini, OpenCode) to provide a visual interface for AI-powered development.

Let me read the key documentation to give you a complete overview:Let me also check the roadmap and explore the client structure:Based on my exploration, here's a comprehensive overview of this project:

---

## **Open Robin** — AI-Powered Web IDE

This is a **web-based IDE** that acts as a visual interface for command-line AI assistants. Instead of using AI CLIs in a terminal, Open Robin renders their output in a rich, visual environment.

### **Core Concept**
- The **CLI handles all AI inference** (Kimi, Claude, Qwen, Codex, Gemini, OpenCode)
- Open Robin is a **harness/display layer** — it reads CLI wire protocols and renders the output visually
- Uses a **thin-client architecture**: backend manages state, frontend purely renders

---

### **Architecture**

```
Browser (React + TypeScript + Vite)
    ↕ WebSocket
Node Server (Express + WebSocket bridge)
    ↕ stdin/stdout JSON-RPC
Active CLI (kimi/claude/qwen/etc.)
```

---

### **Tech Stack**
| Layer | Technology |
|-------|------------|
| Frontend | React 19, TypeScript, Vite, Zustand (state) |
| Backend | Node.js, Express, WebSocket |
| Database | SQLite (`ai/system/robin.db`) |
| Protocol | JSON-RPC 2.0 over WebSocket |
| Styling | CSS with Raven OS-inspired Tron aesthetic |

---

### **Key Features**

**7 Workspaces** (color-coded tabs):
| Workspace | Color | Purpose |
|-----------|-------|---------|
| `browser` | Blue | Browser-based tools |
| `code` | Cyan | File editor, diffs |
| `rocket` | Orange | Deployments, builds |
| `issues` | Yellow | Tasks, ticket board |
| `wiki` | Pink | Documentation |
| `claw` | Red | Direct CLI chat |
| `skills` | Purple | Commands, prompts |

**3 User Modes:**
- **Riff Mode** — Fast brainstorming, no tools
- **Vibe Mode** — Quick edits with file tools
- **Plan Mode** — Structured, step-by-step with validation

---

### **Unique: Pulse-Driven Render Engine**

Instead of rendering content as it arrives, the engine:
- Uses a **500ms pulse** to drive all state transitions
- Buffers content in a **job queue**
- **Decouples data arrival from visual presentation** — creates smooth, cinematic reveals

---

### **Project Structure**

| Path | Purpose |
|------|---------|
| `kimi-ide-client/` | React + TypeScript frontend (ACTIVE) |
| `kimi-ide-server/` | WebSocket bridge server |
| `ai/workspaces/` | Per-project workspace data |
| `ai/system/robin.db` | SQLite database for threads, config |
| `docs/` | Architecture & protocol specs |

---

### **How to Run**

```bash
# Quick restart (rebuilds client + restarts server)
./restart-kimi.sh

# Or manually
cd kimi-ide-client && npm run build
cd ../kimi-ide-server && node server.js
# Open http://localhost:3001
```

---

### **Notable Design Decisions**

1. **Build Required** — Client changes need `npm run build` to appear on port 3001
2. **Components are Pure Renderers** — No `setTimeout`, no direct store writes; the engine owns all timing
3. **Workspace-Scoped Database** — `robin.db` lives in `ai/system/` and travels with the project
4. **Secrets in macOS Keychain** — No `.env` files; credentials stored via Keychain (service: `kimi-ide`)

---

### **Key Documentation**
- `docs/RENDER_ENGINE_ARCHITECTURE.md` — Pulse engine, job queue, state machine
- `docs/TYPESCRIPT_REACT_SPEC.md` — Code patterns, forbidden patterns
- `docs/WIRE_PROTOCOL.md` — JSON-RPC protocol reference
- `docs/UI_THEME_SURFACE.md` — Design tokens, theming

Would you like me to dive deeper into any specific aspect?

**TOOL CALL(S)**

<!-- metadata: {"contextUsage":0.09325408935546875,"tokenUsage":{"input_other":2942,"output":870,"input_cache_read":21504,"input_cache_creation":0},"messageId":"chatcmpl-88HVMO7mVS2ANSgF4bFB7vQk","planMode":false,"capturedAt":1775508180642} -->
