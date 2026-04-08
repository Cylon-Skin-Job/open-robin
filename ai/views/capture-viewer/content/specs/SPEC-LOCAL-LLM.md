---
title: Local LLM Integration — MLX Model Swapping via SESSION.md
created: 2026-03-30
status: draft
parent: MASTER_SYSTEM_SPEC.md
---

# Local LLM Integration — MLX Model Swapping

Run local models (MLX) as drop-in replacements for cloud models. Swap per-agent via SESSION.md. Node server manages model server lifecycle through the Event Bus.

---

## What Exists Today

### On Disk

| Asset | Location | Status |
|-------|----------|--------|
| Python venv | `~/mlx-env/` | Installed (Python 3.12, mlx-lm 0.31.1) |
| Qwen3.5-9B 4-bit | `~/.cache/huggingface/hub/models--mlx-community--Qwen3.5-9B-MLX-4bit` | Downloaded, tested at 20.6 tok/s |
| Qwen3.5-35B-A3B 4-bit | `~/.kandiga/experts/Qwen3.5-35B-A3B-4bit/packed` | Downloaded, untested |
| Knowledge base | `~/Desktop/MLX-Knowledge/MLX-Knowledge.md` | Research notes |

### Local Model Servers (OpenAI-Compatible)

Both serve `POST /v1/chat/completions` with streaming support.

```bash
# 9B — lightweight, fast, 5GB RAM
source ~/mlx-env/bin/activate
mlx_lm.server --model mlx-community/Qwen3.5-9B-MLX-4bit --port 8080

# 35B MoE — expert streaming via SSD, ~2GB RAM active
source ~/mlx-env/bin/activate
kandiga serve --port 8340
```

### Kimi CLI Config Mechanism

Kimi CLI supports `--config '<inline TOML>'` that **merges** with `~/.kimi/config.toml`. Custom providers work:

```toml
[providers."local-mlx"]
type = "openai"
base_url = "http://localhost:8080/v1"
api_key = "not-needed"

[models."local/qwen-9b"]
provider = "local-mlx"
model = "mlx-community/Qwen3.5-9B-MLX-4bit"
max_context_size = 32768
```

### SESSION.md (Already Parsed, Not Used)

`session-loader.js` parses `model:` and `endpoint:` from SESSION.md frontmatter and returns them. `spawnThreadWire()` ignores them.

---

## Design

### SESSION.md as the Control Surface

An agent's SESSION.md declares which model to use. The server reads it and configures the wire spawn accordingly.

```yaml
---
# Cloud model (current default — no changes needed)
model: kimi-for-coding
endpoint: null
---

---
# Local 9B
model: mlx-community/Qwen3.5-9B-MLX-4bit
endpoint: http://localhost:8080/v1
---

---
# Local 35B MoE
model: mlx-community/Qwen3.5-35B-A3B-4bit
endpoint: http://localhost:8340/v1
---
```

**Convention:** `endpoint` starting with `http://localhost` = local model, OpenAI-compatible, no auth.

### Wire Spawn Changes

`spawnThreadWire(threadId, projectRoot)` becomes:

```
spawnThreadWire(threadId, projectRoot, modelConfig = null)
```

When `modelConfig.endpoint` is a localhost URL:
1. Build inline TOML config string (provider + model definition)
2. Add `--config '<toml>'` to kimi CLI args
3. Wire speaks the same JSON-RPC protocol regardless of backend

When `modelConfig` is null or endpoint is null → current behavior (default Kimi Code).

### Inline TOML Generation

A utility function builds the TOML string from SESSION.md values:

```
buildKimiConfig(model, endpoint) → string | null
```

Returns null for cloud models (use defaults). Returns TOML for localhost endpoints:

```toml
default_model = "local/qwen3.5-9b"

[providers."local-mlx"]
type = "openai"
base_url = "http://localhost:8080/v1"
api_key = "not-needed"

[models."local/qwen3.5-9b"]
provider = "local-mlx"
model = "mlx-community/Qwen3.5-9B-MLX-4bit"
max_context_size = 32768
```

### Call Site

Agent wire spawn at `server.js:1046`. `config` is already in scope from `parseSessionConfig()` at line 985:

```javascript
// Before:
session.wire = spawnThreadWire(threadId, projectRoot);

// After:
session.wire = spawnThreadWire(threadId, projectRoot, {
  model: config.model,
  endpoint: config.endpoint,
});
```

Non-agent spawn sites (lines 892, 930, 956) stay unchanged — they use default Kimi Code.

---

## Automated Model Server Lifecycle

### The Problem

Local model servers must be running before the wire can connect. Starting them manually is friction. The Node server already manages child processes (wire spawning) and has an Event Bus.

### The Solution

Treat model servers like any other managed process. The Node server spawns them on demand and tracks their state.

### New Event Types

```
system:model_server_starting   { endpoint, model, port, pid }
system:model_server_ready      { endpoint, model, port, pid, warmupMs }
system:model_server_failed     { endpoint, model, port, error }
system:model_server_stopped    { endpoint, model, port, reason }
```

These follow existing event naming: `system.[domain].[action]`.

### Model Server Manager

New module: `lib/model-server/model-server-manager.js`

**Registry:** Maps `endpoint → process state`:

```javascript
{
  "http://localhost:8080/v1": {
    status: "ready" | "starting" | "stopped" | "failed",
    proc: ChildProcess,
    model: "mlx-community/Qwen3.5-9B-MLX-4bit",
    port: 8080,
    pid: 12345,
    startedAt: Date,
    type: "mlx_lm" | "kandiga"
  }
}
```

**Lifecycle:**

```
1. Agent opens → SESSION.md has localhost endpoint
2. spawnThreadWire() calls modelServerManager.ensure(endpoint, model)
3. If already running + healthy → return immediately
4. If not running → spawn process, wait for health check
5. Emit system:model_server_starting
6. Poll GET /v1/models every 500ms (model loading takes 10-30s)
7. First 200 response → emit system:model_server_ready → spawn wire
8. Timeout (60s) → emit system:model_server_failed → send error to client
9. On agent disconnect (last wire using this endpoint) → optional: keep alive for N minutes, then stop
```

**Spawn Commands:**

```javascript
const MODEL_SERVER_COMMANDS = {
  "mlx_lm": {
    cmd: `${HOME}/mlx-env/bin/python`,
    args: ["-m", "mlx_lm.server", "--model", "{model}", "--port", "{port}"],
  },
  "kandiga": {
    cmd: `${HOME}/mlx-env/bin/kandiga`,
    args: ["serve", "--port", "{port}"],
  },
};
```

**Type Detection:**
- Port 8080 or model contains `MLX` → `mlx_lm`
- Port 8340 or model contains `A3B` → `kandiga`
- Or: add `server-type: mlx_lm | kandiga` to SESSION.md frontmatter

### Health Check

Before spawning a wire against a local endpoint, verify the server is up:

```
GET http://localhost:{port}/v1/models
```

- 200 → server ready, proceed
- Connection refused → server not running, auto-start or error
- Timeout → server loading model, wait and retry

### Keep-Alive Strategy

Model servers consume GPU memory. Don't keep them running forever.

```
- First agent opens with local endpoint → start server
- Last agent using that endpoint disconnects → start idle timer (5 minutes)
- Idle timer expires → stop server, free GPU memory
- New agent opens same endpoint → restart
```

This is configurable per-endpoint or globally.

---

## Event Bus Integration

### TRIGGERS.md Support

Agents can react to model server events:

```yaml
---
name: model-ready-notify
type: system
event: model_server_ready
action: log
message: |
  Local model {{model}} ready on port {{port}} ({{warmupMs}}ms warmup)
---
```

### Client Notification

The server sends WebSocket messages for model server state so the UI can show status:

```json
{ "type": "model_server:starting", "endpoint": "...", "model": "..." }
{ "type": "model_server:ready", "endpoint": "...", "warmupMs": 12500 }
{ "type": "model_server:failed", "endpoint": "...", "error": "..." }
```

The client can render a loading indicator while the model warms up: "Loading Qwen3.5-9B... (10s)" instead of a confusing hang.

---

## SESSION.md Extended Frontmatter

New optional fields (backward compatible):

```yaml
---
model: mlx-community/Qwen3.5-9B-MLX-4bit
endpoint: http://localhost:8080/v1
server-type: mlx_lm          # mlx_lm | kandiga (auto-detected if omitted)
max-context: 32768            # override for local model context window
thinking: false               # disable thinking mode for models that don't support it
---
```

Existing fields unchanged. Missing fields = current defaults.

---

## Files Touched

| File | Change |
|------|--------|
| `kimi-ide-server/server.js` | Modify `spawnThreadWire()` signature + agent spawn call site (line 1046) |
| `kimi-ide-server/lib/session/kimi-config-builder.js` | **New.** Inline TOML generator |
| `kimi-ide-server/lib/model-server/model-server-manager.js` | **New.** Model server lifecycle manager |
| `kimi-ide-server/lib/session/session-loader.js` | Add `server-type`, `max-context`, `thinking` field parsing |
| `kimi-ide-server/lib/event-bus.js` | No changes (new events use existing emit/on) |
| Agent SESSION.md files | Add `model:` + `endpoint:` for local agents |

---

## Phasing

### Phase 1: Config Passthrough (Minimal)
- `kimi-config-builder.js` — build inline TOML from model/endpoint
- Modify `spawnThreadWire()` to accept and pass config
- Wire up agent spawn call site
- Manual model server start required
- Health check before spawn (clear error if server not running)

### Phase 2: Automated Lifecycle
- `model-server-manager.js` — spawn/track/stop model servers
- Auto-start on agent open, keep-alive with idle timeout
- Event Bus integration (`system:model_server_*` events)
- WebSocket status messages to client

### Phase 3: UI Integration
- Model server status indicator in the IDE
- Start/stop controls
- Model switching dropdown per-agent
- Warmup progress bar

---

## Constraints & Gotchas

1. **16GB RAM ceiling.** Only one large model at a time. If 35B is running, starting 9B will swap-thrash. Model server manager should enforce mutual exclusion on GPU memory.

2. **Model load time.** 9B takes ~10s to load, 35B takes ~30s. The wire spawn must wait for the health check — don't send prompts to a half-loaded server.

3. **Kimi CLI `type = "openai"` assumption.** Verified that `--config` with `type = "openai"` works. If Kimi updates and changes this, the TOML generator needs updating.

4. **`--config` merges, not replaces.** Verified: inline config merges with `~/.kimi/config.toml`. Base config (loop_control, services, etc.) preserved.

5. **Local models lack tool use.** Qwen3.5-9B may not reliably call tools. Agents targeting local models should have `tools: { denied: [all] }` or simplified tool sets.

6. **No streaming thinking.** Local models likely don't emit thinking tokens. SESSION.md should set `thinking: false` for local agents.

7. **Port conflicts.** If another process uses port 8080/8340, startup fails. Health check detects this; error message should suggest alternate ports.

---

## Session Resume & Model Switching

### The Problem

Kimi CLI stores full conversation history in `~/.kimi/sessions/<workspace>/<session-id>/context.jsonl`. When `--session <id>` is passed, Kimi loads this history and sends it to whatever model is configured. This creates three failure modes when switching models mid-session:

1. **Context mismatch.** Prior turns were generated by Model A (e.g., Kimi Code cloud). Model B (local Qwen) receives a conversation it didn't produce — including response formats, tool call patterns, and reasoning styles it may not understand or be able to continue coherently.

2. **Context window overflow.** Kimi Code has 262K context. Qwen-9B has ~32K. A resumed session with 100K+ tokens of history will exceed the local model's window — causing silent truncation, errors, or degraded output.

3. **Capability gap in history.** Prior turns may contain tool calls, structured outputs, or thinking blocks that the local model can't replicate. The session state implies capabilities the new model doesn't have.

### Design Rule: One Model Per Session

**A session is bound to the model that created it.** Switching models means starting a fresh session.

### How This Works with Thread Strategies

The thread strategies in `session-loader.js` already control session lifecycle:

| Strategy | Behavior with model switch |
|----------|---------------------------|
| `multi-thread` | New thread = new session automatically. No issue. |
| `daily-rolling` | Same thread reused all day. If model changes mid-day, stale session. |
| `single-persistent` | One thread forever. Model switch would corrupt it. |

### Implementation: Model-Aware Session Invalidation

Add a new invalidation trigger: **model change**.

When `spawnThreadWire()` is called with a model config:

1. **Record model identity in session metadata.** When a wire spawns, write the model identifier (e.g., `mlx-community/Qwen3.5-9B-MLX-4bit` or `kimi-for-coding`) into the thread's metadata (via ThreadManager or a sidecar file).

2. **On resume, compare.** Before reusing a `--session <id>`, compare the SESSION.md model against the model recorded in the thread metadata. If they differ → **do not resume**. Instead:
   - Archive/suspend the old thread (same as `memory-mtime` invalidation does today)
   - Create a fresh thread with a new session ID
   - Optionally inject a summary of the prior thread as the system prompt ("Previous conversation used Kimi Code. Key context: ...")

3. **For `daily-rolling` and `single-persistent`:** If the model changed, force a new thread regardless of strategy. The strategy controls thread *lifecycle*, but model identity is a hard constraint on session *validity*.

### SESSION.md Field

No new fields needed. The existing `model:` field in SESSION.md is the source of truth. The recorded model in thread metadata is the comparison target.

### Thread Metadata Extension

The thread index (managed by `ThreadManager`) already stores per-thread metadata. Add:

```json
{
  "threadId": "abc-123",
  "model": "mlx-community/Qwen3.5-9B-MLX-4bit",
  "endpoint": "http://localhost:8080/v1",
  "createdAt": "2026-03-30T..."
}
```

On open: if `config.model !== thread.model` → invalidate.

### Edge Cases

- **model field is null** (old SESSION.md, no model specified): Treat as `kimi-for-coding` (the default). No invalidation needed when resuming against another null-model thread.
- **Endpoint changes but model stays the same**: This is fine — same model served from a different port doesn't affect session continuity.
- **Cloud model version changes** (e.g., `claude-opus-4-5` → `claude-opus-4-6`): Treat as a model change. Different model = different session. The cloud model version is part of the identity string.
- **User explicitly wants to continue**: Not supported initially. A model switch always starts fresh. Future: could add `force-resume: true` to SESSION.md for power users who want cross-model continuation.

---

## Inactivity, Timeout & Same-Model Resume

### Why Resume Works with Local Models

The local model servers (mlx_lm.server, kandiga serve) are **fully stateless HTTP endpoints**. They have no session concept. The OpenAI chat completions API is request/response: every request includes the full `messages` array. The server doesn't remember previous requests.

**Session state lives entirely in Kimi CLI** — `context.jsonl` on disk. Kimi reconstructs the full conversation on each turn and sends it fresh to whatever endpoint is configured.

This means: **restarting the model server between turns has zero effect on session continuity.** The full lifecycle:

```
1. Agent opens → model server starts (10-30s warmup)
2. Wire spawns: kimi --wire --session abc --config <local TOML>
3. User chats → Kimi sends POST /v1/chat/completions { messages: [full history] }
4. Model responds statelessly
5. Idle timeout → wire killed → model server stopped (GPU freed)
   ... hours pass ...
6. User returns → model server restarts (10-30s warmup)
7. Wire spawns: kimi --wire --session abc --config <local TOML>
8. Kimi loads context.jsonl → sends full history → model responds
9. Session continues seamlessly. No state was lost.
```

**Verdict: same-model resume works. No fresh session needed.**

The only constraint is that the same model is configured — the model-switch invalidation from the previous section handles that.

### The Real Threat: Context Window Accumulation

Local models have small context windows compared to cloud:

| Model | Context Window |
|-------|---------------|
| Kimi Code (cloud) | 262,144 tokens |
| Qwen3.5-9B (local) | 32,768 tokens |
| Qwen3.5-35B-A3B (local) | 65,536 tokens |

Every turn, Kimi sends the **full session history** in the messages array. After enough back-and-forth, the history exceeds the local model's window. This isn't specific to resume — it happens during a live session too. But resume after inactivity means the full accumulated history hits the model cold.

### Context Window Management

Kimi CLI has built-in compaction:

```toml
# From ~/.kimi/config.toml
[loop_control]
reserved_context_size = 50000
compaction_trigger_ratio = 0.85
```

**Problem:** These defaults are tuned for 262K. At 85% of 32K = ~27K tokens, compaction fires — but `reserved_context_size = 50000` is larger than the entire window.

**Solution:** The inline `--config` TOML must override compaction settings for local models:

```toml
[loop_control]
reserved_context_size = 8000
compaction_trigger_ratio = 0.75
```

This makes Kimi compact the conversation earlier, keeping it within the local model's window. The `max_context_size` on the model definition tells Kimi the ceiling:

```toml
[models."local/qwen-9b"]
provider = "local-mlx"
model = "mlx-community/Qwen3.5-9B-MLX-4bit"
max_context_size = 32768
```

### What `kimi-config-builder.js` Must Include

The inline TOML generator needs to emit **both** the provider/model config **and** adjusted loop_control settings:

```toml
default_model = "local/qwen-9b"

[providers."local-mlx"]
type = "openai"
base_url = "http://localhost:8080/v1"
api_key = "not-needed"

[models."local/qwen-9b"]
provider = "local-mlx"
model = "mlx-community/Qwen3.5-9B-MLX-4bit"
max_context_size = 32768

[loop_control]
reserved_context_size = 8000
compaction_trigger_ratio = 0.75
```

This ensures sessions stay within bounds across resume cycles. Kimi handles compaction internally — we just set the right parameters.

### Warmup Delay on Resume

When the model server was stopped and needs to restart:
- 9B: ~10s to load into GPU memory
- 35B: ~30s to load + split experts

The wire spawn must **wait for the health check** before allowing prompts. The model server manager pings `GET /v1/models` until it gets a 200. During this wait, the client should see a status message: "Warming up Qwen3.5-9B..." rather than a silent hang.

Sequence on resume after inactivity:

```
User sends message
  → Server checks: is model server running?
  → No → modelServerManager.ensure(endpoint, model)
       → Spawn process, poll /v1/models every 500ms
       → Send WS: { type: "model_server:starting", model: "..." }
       → First 200 response (10-30s later)
       → Send WS: { type: "model_server:ready", warmupMs: 12500 }
  → Spawn wire with --session (same thread, same model)
  → Forward user message to wire
  → Response streams back normally
```
