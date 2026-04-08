# Workspace Agent Model

Every workspace gets an agent. Every agent follows the same model. Five files define the agent — the server reads them and enforces.

## The Five Files

```
ai/workspaces/{workspace}/
├── PROMPT.md         ← who the agent is
├── TOOLS.md          ← what it can do
├── WORKFLOW.md       ← how it does work (injected on every write)
├── api.json          ← model/provider preferences (hot-swapped on session start)
└── workspace.json    ← metadata and settings
```

Plus one project-level file:
- `ai/STATE.md` — cross-workspace activity trail, written by every agent after work

## How Each File Is Used

| File | Loaded when | Purpose |
|------|-------------|---------|
| PROMPT.md | Session start | Agent identity, scope, ownership |
| TOOLS.md | Every tool call | Server-side enforcement of allowed/restricted/denied tools |
| WORKFLOW.md | Every write/edit | Process rules injected just-in-time — the agent sees them before every mutation |
| api.json | Pre-session | CLI config hot-swapped to match workspace model preferences |
| workspace.json | Session start | Metadata: session type, scopes, trigger sources |
| STATE.md | Session start + after work | Cross-workspace breadcrumb trail |

## The Injection Model

```
Pre-Session:  api.json → hot-swap CLI config
Session Start: PROMPT.md + STATE.md loaded
Any Read:      unrestricted (whole project)
Any Write:     TOOLS.md checked (server-side) → WORKFLOW.md injected (agent-visible) → execute
After Work:    WORKFLOW.md requires STATE.md update
```

## Scoped Write, Broad Read

Every agent can read the entire project — code, git history, other workspaces, docs. But each agent writes only within its own workspace (plus `ai/STATE.md`). This is enforced by TOOLS.md at the server level, not by prompt suggestion.

## Adding a New Workspace

1. Create folder in `ai/workspaces/`
2. Add the five files (PROMPT.md, TOOLS.md, WORKFLOW.md, api.json, workspace.json)
3. Server discovers workspaces by scanning `ai/workspaces/*/workspace.json`
4. The agent is available when its tab opens or a ticket arrives

## Background Agent Variant

Background agents (in `background-agents/agents/`) extend this model:

- **AGENT.md** replaces PROMPT.md (same role — identity and system prompt)
- **Numbered prompts** in `prompts/` define discrete workflow steps
- **agent.json** replaces workspace.json (adds `bot_name`, `limits`, model overrides)
- **hooks.js** optional per-agent server-side customization
- **runs/** stores frozen copies and step outputs per execution

See [Background-Agents](Background-Agents) for the full agent folder convention.

Full specification: `ai/workspaces/capture/specs/WORKSPACE-AGENT-SPEC.md` and `ai/workspaces/capture/specs/TICKETING-SPEC.md`

## Related

- [Workspaces](Workspaces) — overview of all workspaces
- [Model-Config](Model-Config) — api.json and hot-swapping details
- [Session-Scoping](Session-Scoping) — how sessions stay isolated
- [Progressive-Disclosure](Progressive-Disclosure) — how agents load context
