# Kimi IDE Server

WebSocket + HTTP server that bridges the React client to the Kimi wire process.

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

## Important: Where to Edit Code

**DO NOT edit files in `public/` or `archive/` for UI changes.**

The server ONLY serves the React client from `../kimi-ide-client/dist/`.

- **UI Components**: `kimi-ide-client/src/components/`
- **Styling**: `kimi-ide-client/src/styles/`
- **State**: `kimi-ide-client/src/state/`

## Running

```bash
node server.js
```

Server runs on port 3001 (or `process.env.PORT`).

## Archive

See `archive/` folder for old vanilla JS implementation (preserved for reference, NOT served).
