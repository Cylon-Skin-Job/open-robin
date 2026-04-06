# Open Robin
Web-based IDE for AI CLI harnesses

## Project Structure

```
open-robin/
├── open-robin-client/        ← ✅ ACTIVE: React + TypeScript + Vite
│   ├── src/components/       ← UI components (the "pulsating thing" is here)
│   ├── src/styles/           ← CSS and animations
│   └── src/state/            ← Zustand state management
│
├── open-robin-server/        ← WebSocket bridge server
│   ├── server.js             ← Main server file
│   ├── archive/              ← ❌ DEAD CODE (reference only)
│   │   └── legacy-vanilla-client.html
│   └── README.md
│
└── .cursor/
    └── rules/
        └── active-codebase.mdc  ← AI rule: always applies
```

## ⚠️ CRITICAL: Which Code Is Active?

**ONLY edit files in `kimi-ide-client/` for UI changes.**

The server no longer serves files from `public/` - it serves the React client from `kimi-ide-client/dist/` after you build it.

### Old code (preserved but NOT served):
- `kimi-ide-server/archive/legacy-vanilla-client.html` - Original vanilla JS implementation

### Looking for "that pulsating thing"?
- `kimi-ide-client/src/components/PulseSymbol.tsx` ← Current implementation
- `kimi-ide-client/src/components/TransitionPulse.tsx` ← Lifecycle version
- NOT the vanilla JS functions in archive/

## Documentation

- **[docs/RENDER_ENGINE_ARCHITECTURE.md](docs/RENDER_ENGINE_ARCHITECTURE.md)** — Pulse-driven render engine: job queue, state machine, separation of concerns. **Read before touching orchestration.**
- **[docs/TYPESCRIPT_REACT_SPEC.md](docs/TYPESCRIPT_REACT_SPEC.md)** — Code spec: modularization, forbidden patterns, validation rules. **Read before writing components.**
- **[docs/STREAMING_CONTENT.md](docs/STREAMING_CONTENT.md)** — Wire streaming: think vs text, chunk granularity, thought block boundaries.
- [docs/WIRE_PROTOCOL.md](docs/WIRE_PROTOCOL.md) — Full wire protocol reference
- [docs/STYLE_GUIDE.md](docs/STYLE_GUIDE.md) — Visual patterns, workspace themes
- [docs/VISION_CLONE_PIPELINE.md](docs/VISION_CLONE_PIPELINE.md) — Future: multi-agent clone spawning, war room UI
- [docs/VISION_RESEARCH_ASSISTANT.md](docs/VISION_RESEARCH_ASSISTANT.md) — Future: overnight research pipeline, preflight system, Karen's use case

To capture fresh wire output: `node scripts/capture-wire-output.js` → `docs/wire-output-sample.jsonl`

## Development

```bash
# Client (React)
cd kimi-ide-client
npm install
npm run dev        # Dev server on :5173
npm run build      # Build to dist/

# Server (WebSocket bridge)
cd kimi-ide-server
node server.js     # Server on :3001
```
