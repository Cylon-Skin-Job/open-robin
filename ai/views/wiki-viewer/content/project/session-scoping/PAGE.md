# Session Scoping

Each workspace gets its own CLI `--wire` session. Sessions are isolated — different model configs, different system prompts, different tool restrictions. `ai/STATE.md` is the bridge between them.

## One Session Per Workspace

When a workspace tab opens (or a ticket triggers an agent), the server spawns a dedicated CLI process for that workspace. The process gets:

1. **Model config from api.json** — hot-swapped before spawn
2. **System context from PROMPT.md** — who the agent is
3. **Cross-workspace context from STATE.md** — what happened recently elsewhere
4. **Tool filtering from TOOLS.md** — enforced server-side

Two workspaces active at the same time = two separate CLI processes with different configs.

## Session Lifecycle

```
Tab opens (or ticket arrives)
  │
  ├─ Server reads api.json → creates temp config overlay
  ├─ Server spawns active CLI with --wire flag and workspace config
  ├─ Server loads PROMPT.md + STATE.md into system context
  ├─ Server holds TOOLS.md for server-side enforcement
  │
  ├─ Agent works (reads broadly, writes within scope)
  │
  ├─ Tab closes or idle timeout
  ├─ Agent's final WORKFLOW.md step: update STATE.md
  ├─ CLI process enters grace period → suspends
  └─ Session state preserved for resume
```

## Switching Workspaces

When you switch from one workspace to another:

1. Current workspace session suspends (or stays in background)
2. New workspace session starts (or resumes if it was suspended)
3. New agent reads STATE.md — sees what you just did in the previous workspace

STATE.md is the handoff mechanism. It's not a full context transfer — it's a breadcrumb trail. The new agent knows where you came from and what was happening, then loads its own context.

**Example:**
```
You're in code workspace → commit lib/secrets.js
  → Code agent updates STATE.md: "committed token rotation changes"

You switch to wiki workspace
  → Wiki agent reads STATE.md: "code workspace just committed lib/secrets.js"
  → Wiki agent knows to check if secrets/PAGE.md needs updating
```

## Isolation Guarantees

| Aspect | Isolated? | How |
|--------|-----------|-----|
| Model/thinking mode | Yes | api.json → separate config per process |
| System prompt | Yes | PROMPT.md loaded per workspace |
| Tool access | Yes | TOOLS.md enforced server-side per workspace |
| Conversation state | Yes | Each process has its own context window |
| File write access | Yes | TOOLS.md restricts writes to workspace folder |
| File read access | No (intentional) | All agents can read the whole project |
| STATE.md | Shared (intentional) | Cross-workspace bridge |

Read access is intentionally shared. The wiki agent needs to read code. The coding agent needs to read wiki pages. Isolation is about writes and identity, not reads.

## Session Persistence

When a session suspends:
- The active CLI preserves session state (location CLI-specific, e.g., `~/.kimi/sessions/` for Kimi)
- The workspace's `workspace.json` tracks the session ID
- Resuming the tab resumes the session with context intact

For the wiki workspace specifically, sessions are lightweight — each run is self-contained, so a fresh session with just index.json and recent tickets is enough context.

## Multiple Active Sessions

The server can run multiple workspace sessions simultaneously. Limits:

- Each workspace: max 1 active session
- Total across project: governed by system resources and active CLI limits
- Idle timeout: per workspace.json settings (e.g., 30 minutes)

When a session idles past its timeout, it suspends. The next interaction resumes it.

## Related

- [Workspace-Agent-Model](Workspace-Agent-Model) — the 5-file pattern that defines each session
- [Model-Config](Model-Config) — how api.json drives the config hot-swap
- [Workspaces](Workspaces) — overview of all workspaces and their session types
- [Progressive-Disclosure](Progressive-Disclosure) — how agents load context within sessions
