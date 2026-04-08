# Model Config

Each workspace declares its preferred model, provider, and settings in `api.json`. The server hot-swaps the CLI config on session start — no manual switching, no global state pollution.

## api.json

```json
{
  "workspace": "wiki",
  "description": "Fast model for wiki updates — speed over depth",
  "model": {
    "provider": "managed:kimi-code",
    "model": "kimi-for-coding",
    "thinking": false,
    "max_context_size": 131072
  },
  "overrides": {
    "default_thinking": false,
    "loop_control.max_steps_per_turn": 50,
    "loop_control.max_retries_per_step": 2
  },
  "notes": "Wiki edits are short, targeted writes. Thinking mode adds latency for no gain."
}
```

## Fields

| Field | Purpose |
|-------|---------|
| `model.provider` | Which provider to use (CLI-specific, e.g., maps to `[providers]` in Kimi's config.toml) |
| `model.model` | Model identifier |
| `model.thinking` | Enable/disable thinking/reasoning mode |
| `model.max_context_size` | Context window limit for this workspace |
| `overrides` | Key-value pairs overriding kimi config.toml (dot notation for nested keys) |
| `notes` | Human-readable rationale (not machine-read) |

## Hot-Swap Mechanism

The base CLI config (`~/.kimi/config.toml`) is never modified.

```
1. Server reads workspace api.json
2. Server reads base CLI config (e.g., ~/.kimi/config.toml for Kimi)
3. Server creates temp config with overrides applied
4. Server spawns active CLI with --wire flag and config pointing to temp overlay
5. Session ends → temp config cleaned up
```

Each workspace gets its own overlay. Switching tabs = switching model config. No cross-contamination.

## Current Workspace Preferences

| Workspace | Thinking | Context | Max Steps | Why |
|-----------|----------|---------|-----------|-----|
| wiki | Off | 131K | 50 | Short targeted edits, speed matters |
| coding-agent | On | 262K | 100 | Deep reasoning, complex multi-file ops |
| issues | Off | 131K | 30 | Ticket triage is fast, structured work |
| pre-flight | On | 131K | 50 | Validation needs reasoning but scope is bounded |
| launch | Off | 131K | 30 | Automated pipeline, structured steps |
| review | On | 262K | 100 | Final review needs full context and careful reasoning |

## When to Change Preferences

Adjust `api.json` when:
- A workspace consistently hits context limits → increase `max_context_size`
- An agent makes reasoning errors → enable thinking mode
- An agent is too slow for its task type → disable thinking, reduce context
- A new model becomes available → update provider and model fields

Changes take effect on next session start. Active sessions keep their config until they end.

## Fallback

If `api.json` doesn't exist in a workspace, the agent inherits base `config.toml` settings unchanged. This is the safe default.

## Related

- [Workspace-Agent-Model](Workspace-Agent-Model) — the 5-file pattern including api.json
- [Session-Scoping](Session-Scoping) — how sessions are isolated per workspace
- [Workspaces](Workspaces) — which workspaces use which settings
