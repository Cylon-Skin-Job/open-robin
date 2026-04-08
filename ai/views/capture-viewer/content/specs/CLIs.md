---
title: CLI Integration Spec
created: 2026-03-28
status: active
parent: MASTER_SYSTEM_SPEC.md
---

# CLI Integration

How the app interacts with CLI tools (Kimi, future CLIs) via the wire protocol.

---

## Current State

The app spawns `kimi --wire --yolo` as a subprocess. Communication is JSON-RPC 2.0 over stdio (NDJSON). See STREAMING_RENDER_SPEC.md for the full wire protocol.

### Spawn

```javascript
const args = ['--wire', '--yolo', '--session', threadId];
if (projectRoot) args.push('--work-dir', projectRoot);

spawn(kimiPath, args, {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, TERM: 'xterm-256color' }
});
```

`KIMI_PATH` env var overrides the default `kimi` command.

---

## Wire Protocol Versioning

As features are added, the WebSocket protocol between client and server evolves. The wire protocol between server and CLI also evolves independently.

### Client <-> Server Protocol
- Version declared in `initialize` handshake: `protocol_version: "1.4"`
- Server should reject connections with incompatible versions
- Backward-compatible additions (new message types) don't require version bump
- Breaking changes (renamed fields, removed message types) require version bump

### Server <-> CLI Wire Protocol
- JSON-RPC 2.0 — stable specification
- Event types (`ContentPart`, `ToolCall`, `TurnBegin`, etc.) are CLI-defined
- New event types are additive — server ignores unknown types
- CLI version detected at startup (parse `kimi --version` output)

---

## Multiple CLI Support (Profiles)

SESSION.md defines which CLI and model to use per agent/chat:

```yaml
---
cli: kimi
profile: default
model: claude-sonnet-4-6
endpoint: https://api.anthropic.com/v1/messages
---
```

Robin's Profiles tab manages CLI configurations. Each profile is a distinct "personality install":
- "KIMI CLI" (default)
- "Qwen3 Coder via KIMI CLI"
- Custom profiles with different models/endpoints

The `profile` field in SESSION.md references a profile by name. The server resolves it to spawn args at session start.

---

## TODO

- [ ] CLI version detection at startup
- [ ] Protocol version negotiation (client <-> server)
- [ ] Unknown event type handling (log + ignore)
- [ ] Profile resolution: SESSION.md profile name -> spawn args
- [ ] Multiple CLI binary support (not just kimi)
- [ ] Wire protocol event type registry (document all known types)
