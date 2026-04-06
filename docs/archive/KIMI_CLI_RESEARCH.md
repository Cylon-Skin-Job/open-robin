# Kimi CLI Research

> Research conducted 2026-03-16

## What is Kimi CLI?

[Kimi Code CLI](https://github.com/MoonshotAI/kimi-cli) is an AI-powered terminal agent by **Moonshot AI**. It is **not** a fork of Claude Code — it is an independent, competing project. Apache 2.0 licensed, fully open source. Written in Python, installable via `pip install kimi-cli` or Homebrew.

- **Latest version:** 1.20.0 (kosong 0.45.0)
- **Python:** 3.12–3.14 (recommends 3.13)
- **License:** Apache-2.0
- **PyPI:** https://pypi.org/project/kimi-cli/
- **GitHub:** https://github.com/MoonshotAI/kimi-cli
- **Agent SDK:** https://github.com/MoonshotAI/kimi-agent-sdk (Go, Node.js, Python)
- **Rust wire-mode kernel:** https://github.com/MoonshotAI/kimi-agent-rs

## Operating Modes

| Mode | Flag | Description |
|------|------|-------------|
| Interactive shell | _(default)_ | Terminal chat, Ctrl-X toggles shell commands |
| Print | `--print` | Non-interactive, implicitly enables `--yolo`, exits when done |
| Wire | `--wire` | JSON-RPC 2.0 over stdin/stdout for custom UIs |
| ACP server | `kimi acp` | Agent Client Protocol for IDE integration |
| Browser UI | `kimi web` | Graphical interface with session management |

### Print Mode Details

- Implicitly enables `--yolo` (auto-approve all tool calls)
- `--output-format stream-json` produces JSONL for programmatic integration
- `--quiet` is shorthand for `--print --output-format text --final-message-only`
- Reads from stdin or `--command` / `-p` flag, writes to stdout

### Wire Mode Details

- JSON-RPC 2.0, line-delimited JSON over stdin/stdout (protocol v1.4)
- Supports capability negotiation
- Lightweight Rust alternative: `kimi-agent-rs`

## Provider & Model Configuration

Config file: `~/.kimi/config.toml` (auto-created on first run, also supports JSON).

### Supported Provider Types

| Type | Description |
|------|-------------|
| `kimi` | Moonshot AI / Kimi API |
| `openai_responses` | OpenAI-compatible APIs |
| `openai_legacy` | Legacy OpenAI / Ollama / local endpoints |
| `anthropic` | Claude / Anthropic APIs |
| `google_genai` | Google Gemini APIs |
| `vertexai` | Google Vertex AI |

### Example: Multiple Providers in config.toml

```toml
default_model = "kimi-for-coding"

# --- Kimi (primary) ---
[providers.kimi-for-coding]
type = "kimi"
base_url = "https://api.kimi.com/coding/v1"
api_key = "sk-xxx"

[models.kimi-for-coding]
provider = "kimi-for-coding"
model = "kimi-for-coding"
max_context_size = 262144

# --- Local Ollama (cheap subagent work) ---
[providers.ollama]
type = "openai_legacy"
base_url = "http://localhost:11434/v1"
api_key = "ollama"

[models.local-llama]
provider = "ollama"
model = "llama3.1:70b"
max_context_size = 131072

# --- Claude (alternative top-tier) ---
[providers.claude]
type = "anthropic"
base_url = "https://api.anthropic.com"
api_key = "sk-ant-xxx"

[models.claude-opus]
provider = "claude"
model = "claude-opus-4-6"
max_context_size = 200000
capabilities = ["thinking", "image_in"]
```

### Key Flags for Config Overrides

| Flag | Purpose |
|------|---------|
| `--config-file <path>` | Use a specific config.toml (different provider/model) |
| `--agent-file <path>` | Load custom agent YAML (different prompts/tools) |
| `--model <name>` | Override model at CLI level |
| `--thinking` / `--no-thinking` | Toggle thinking mode |
| `--yolo` | Auto-approve all tool calls |

## Sub-Agent Architecture

### How Sub-Agents Work

- **`LaborMarket`** class (`src/kimi_cli/soul/agent.py`) manages all subagents
- **`Task` tool** (`src/kimi_cli/tools/multiagent/`) spawns subagents at runtime
- Subagents run in **isolated contexts** — no shared conversation history
- All necessary context must be passed in the prompt

### Two Types of Sub-Agents

1. **Fixed subagents:** Defined in agent YAML spec, loaded at initialization
2. **Dynamic subagents:** Created at runtime via `CreateSubagent` tool (not enabled by default), persisted with session state

### Agent YAML Format

```yaml
# primary.yaml
extend: default
system_prompt: "You are a senior architect..."
tools:
  - kimi_cli.tools.file
  - kimi_cli.tools.shell
  - kimi_cli.tools.multiagent:Task
subagents:
  coder:
    path: ./coder.yaml
    description: "Writes implementation code"
  reviewer:
    path: ./reviewer.yaml
    description: "Reviews code for quality"
```

```yaml
# coder.yaml (subagent — inherits from main, excludes Task to prevent nesting)
extend: default
exclude_tools:
  - kimi_cli.tools.multiagent:Task
system_prompt: "You are a focused implementation coder..."
```

### Template Variables Available in Agent Specs

- `KIMI_NOW` — current timestamp
- `KIMI_WORK_DIR` — working directory path
- `KIMI_WORK_DIR_LS` — directory listing
- `KIMI_AGENTS_MD` — agent documentation
- `KIMI_SKILLS` — available skill registry

## The Problem: Per-Subagent Model Selection

**Kimi CLI currently has no native per-subagent model override.** The model/provider is chosen globally at runtime initialization and **inherited by all subagents**. This is a known limitation — subagents inherit the main agent's model even when config says otherwise.

Related: [oh-my-opencode issue #1265](https://github.com/code-yeongyu/oh-my-opencode/issues/1265)

Agent Swarm (up to 100 parallel sub-agents) exists on the web UI but is not yet available in CLI: [Feature request #746](https://github.com/MoonshotAI/kimi-cli/issues/746).

## Solution: Clone-Spawn Pattern with --print

Since in-process subagent model routing is broken, **spawn separate kimi processes with different configs** instead.

### Architecture

```
Kimi IDE Backend (Node.js)
  │
  ├── PRIMARY AGENT
  │   kimi --wire --yolo --config-file config-primary.toml --agent-file primary.yaml
  │   (top-tier LLM: Kimi K2.5 / Claude Opus / GPT-4o)
  │   (full tool access, planning capability, orchestration)
  │
  └── For each sub-task dispatched by primary:
        WORKER CLONE
        kimi --print --config-file config-worker.toml --agent-file worker.yaml -p "<task>"
        (cheaper LLM: Ollama local / Haiku / GPT-4o-mini)
        (limited tools, isolated context, focused instructions)
```

### Why This Works

1. **Full isolation** — each process has its own config, model, provider, context window
2. **No model inheritance bug** — separate processes don't share runtime state
3. **Scalable** — spawn as many workers as needed in parallel
4. **Config flexibility** — different `config.toml` per worker = different LLM
5. **Agent flexibility** — different `agent.yaml` per worker = different tools/prompts
6. **Print mode** is purpose-built for this — non-interactive, auto-approves, exits when done

### Example Invocations

```bash
# Primary agent (expensive, capable model) — long-running wire session
kimi --wire --yolo --config-file config-primary.toml --agent-file primary.yaml

# Worker clone (cheap model) — one-shot task
kimi --print --config-file config-worker.toml --agent-file worker.yaml \
  -p "Implement the fizzbuzz function in src/utils.py with full test coverage"

# Another worker (different cheap model) — one-shot task
kimi --print --config-file config-reviewer.toml --agent-file reviewer.yaml \
  -p "Review this diff for bugs and security issues: $(git diff HEAD~1)"
```

### Config Files

```toml
# config-primary.toml
default_model = "kimi-k25"

[providers.kimi]
type = "kimi"
base_url = "https://api.kimi.com/coding/v1"
api_key = "sk-xxx"

[models.kimi-k25]
provider = "kimi"
model = "kimi-k2.5-thinking"
max_context_size = 262144
capabilities = ["thinking", "image_in"]
```

```toml
# config-worker.toml
default_model = "local-llama"

[providers.ollama]
type = "openai_legacy"
base_url = "http://localhost:11434/v1"
api_key = "ollama"

[models.local-llama]
provider = "ollama"
model = "llama3.1:70b"
max_context_size = 131072
```

## Open Source Compatibility

Apache 2.0 allows:
- Free use for any purpose, including commercial
- Modification and redistribution
- Embedding in proprietary or open-source products
- Explicit patent grant from contributors
- Only requirements: include license copy and provide attribution

Compatible with keeping the Kimi IDE project open source under any OSI-approved license.

## References

- [MoonshotAI/kimi-cli GitHub](https://github.com/MoonshotAI/kimi-cli)
- [Kimi Agent SDK](https://github.com/MoonshotAI/kimi-agent-sdk)
- [Providers and Models docs](https://moonshotai.github.io/kimi-cli/en/configuration/providers.html)
- [Agents and Subagents docs](https://moonshotai.github.io/kimi-cli/en/customization/agents.html)
- [Wire Mode docs](https://moonshotai.github.io/kimi-cli/en/customization/wire-mode.html)
- [Print Mode docs](https://moonshotai.github.io/kimi-cli/en/customization/print-mode.html)
- [Config Files docs](https://moonshotai.github.io/kimi-cli/en/configuration/config-files.html)
- [AGENTS.md](https://github.com/MoonshotAI/kimi-cli/blob/main/AGENTS.md)
- [Subagent model inheritance bug](https://github.com/code-yeongyu/oh-my-opencode/issues/1265)
- [Agent Swarm feature request #746](https://github.com/MoonshotAI/kimi-cli/issues/746)
- [kimi-cli on PyPI](https://pypi.org/project/kimi-cli/)
- [Kimi CLI Technical Deep Dive](https://llmmultiagents.com/en/blogs/kimi-cli-technical-deep-dive)
- [DeepWiki: Subagent System](https://deepwiki.com/MoonshotAI/kimi-cli/5.3-multi-agent-coordination)
