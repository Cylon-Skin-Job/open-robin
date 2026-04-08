# Background Agents

The execution workspace. Every agent that processes tickets lives here — defined by folders, dispatched by assignment, run by the wire protocol.

---

## The Three Systems

```
Issues workspace        →  the board (tickets, sync, columns)
Background Agents       →  the workers (agent folders, runner, runs)
Cron jobs               →  ticket factories (create and assign, nothing else)
```

No other workspace runs agents. Issues routes. Agents execute.

---

## Agent Folder Convention

Each agent is a self-contained folder. The folder *is* the routing — no external labels or tags needed.

```
ai/workspaces/background-agents/
├── workspace.json
├── runner.js                     ← agents workspace owns execution
├── registry.json                 ← bot name → agent folder mapping
│
└── agents/
    └── wiki-updater/
        ├── AGENT.md              ← identity, scope, constraints (system prompt)
        ├── WORKFLOW.md           ← execution rules, guardrails
        ├── agent.json            ← metadata, model config, limits
        ├── hooks.js              ← optional: beforeRun(), afterStep(), afterRun()
        ├── prompts/
        │   ├── 01-gather.md      ← "read sources, report findings"
        │   ├── 02-propose.md     ← "propose changes, state confidence"
        │   ├── 03-edges.md       ← "what else is affected?"
        │   ├── 04-execute.md     ← "make the changes"
        │   └── 05-verify.md      ← "verify convergence"
        └── runs/
            └── 2026-03-21T10-30/
                ├── ticket.md       ← frozen copy of the ticket
                ├── AGENT.md        ← frozen copy
                ├── WORKFLOW.md     ← frozen copy
                ├── manifest.json
                └── steps/
                    ├── 01-gather.md
                    ├── 02-propose.md
                    └── ...
```

---

## AGENT.md — Identity

Who the agent is. Loaded as the system prompt at session start.

```markdown
# Wiki Updater

You update wiki pages when source material changes.

## Scope
- You own: ai/workspaces/wiki/*/PAGE.md, ai/workspaces/wiki/*/LOG.md
- You read: entire project (code, git, other workspaces)
- You write: only wiki topic files + ai/STATE.md

## Constraints
- Never skip the workflow steps
- Never edit files outside your scope
- If confidence is below 70%, stop and mark the ticket
```

---

## Numbered Prompts — The Behavior

Each prompt in `prompts/` is a discrete turn in the wire protocol conversation. The runner feeds them in order. This is where the agent's intelligence lives.

| Prompt | Purpose |
|--------|---------|
| `01-gather.md` | Read the ticket. Gather all relevant source material. Report what you found. |
| `02-propose.md` | Based on what you gathered, propose specific changes with confidence levels. |
| `03-edges.md` | Check what else is affected. Declare child tickets if needed. |
| `04-execute.md` | Make the changes. |
| `05-verify.md` | Verify convergence. Confirm everything is consistent. |

Prompts use `{{template_vars}}` for context injection:
- `{{ticket_body}}` — the ticket's markdown body
- `{{step_01_output}}` — output from step 1
- `{{step_02_output}}` — output from step 2, etc.

The runner substitutes these before sending each prompt to the model.

**To create a new agent, you write markdown.** Not code. A new agent is:
1. Create a folder in `agents/`
2. Write AGENT.md (who you are)
3. Write WORKFLOW.md (rules)
4. Write numbered prompts (the actual behavior)
5. Write agent.json (metadata)
6. Add to registry.json

---

## agent.json — Metadata

```json
{
  "id": "wiki-updater",
  "name": "Wiki Updater",
  "bot_name": "kimi-wiki",
  "description": "Updates wiki pages when source material changes",
  "icon": "edit_note",
  "color": "#e91e8a",

  "model": {
    "thinking": false,
    "max_context_size": 131072
  },

  "limits": {
    "max_concurrent_runs": 1,
    "max_depth": 3,
    "timeout_minutes": 10
  }
}
```

| Field | Purpose |
|-------|---------|
| `bot_name` | The GitLab assignee name that triggers this agent — the dispatch key |
| `model` | Per-agent model override (inherits workspace api.json if omitted) |
| `limits.max_concurrent_runs` | How many tickets this agent processes simultaneously |
| `limits.max_depth` | Circuit breaker for child ticket chains |
| `limits.timeout_minutes` | Kill run after this duration |

---

## registry.json — Bot Name Routing

Maps bot names (GitLab assignees) to agent folders. The dispatch system reads this — nothing else.

```json
{
  "version": "1.0",
  "agents": {
    "kimi-wiki": {
      "folder": "agents/wiki-updater",
      "status": "idle"
    },
    "kimi-code": {
      "folder": "agents/bug-fixer",
      "status": "idle"
    },
    "kimi-review": {
      "folder": "agents/code-reviewer",
      "status": "idle"
    }
  }
}
```

---

## The Wire Protocol Execution Loop

Owned by `runner.js` in this workspace. This is the core engine.

```
1. Receive dispatch (ticket file + agent folder path)
2. Read agent.json → model config
3. Read AGENT.md → system prompt
4. Read ai/STATE.md → cross-workspace context
5. Create run folder: agents/{id}/runs/{timestamp}/
6. Freeze: copy ticket.md, AGENT.md, WORKFLOW.md into run folder
7. Spawn active CLI with `--wire` flag and agent model config
8. For each prompt in prompts/ (sorted numerically):
   a. Read prompt template
   b. Substitute {{ticket_body}}, {{step_NN_output}} vars
   c. Send to model via wire protocol
   d. Capture response → save to runs/steps/NN-{name}.md
   e. If response contains STOP signal → break, mark ticket
   f. If hooks.afterStep exists → call it
9. Write manifest.json
10. Notify issues workspace to close ticket
11. Post summary as GitLab comment (via issues sync)
12. Update ai/STATE.md
13. Update registry.json status → "idle"
```

### Context Accumulation

Each prompt sees more context than the last:

```
Step 1: system=AGENT.md, user=prompt_01(ticket_body)
Step 2: system=AGENT.md, user=prompt_02(ticket_body + step_01_output)
Step 3: system=AGENT.md, user=prompt_03(ticket_body + step_01 + step_02)
...
```

### hooks.js — Optional Escape Hatch

Per-agent custom server-side behavior. Most agents don't need this.

```javascript
module.exports = {
  beforeRun(ticket, agentConfig) { },
  afterStep(stepNumber, stepOutput, context) { },
  afterRun(manifest, ticket) { }
};
```

---

## The Tiles UI

The background-agents workspace tab shows all agents as cards.

### Default View

```
┌─────────────────────────────────────────────────────────────┐
│  Background Agents                                          │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ edit_note   │  │ bug_report  │  │ rate_review  │        │
│  │ Wiki        │  │ Bug         │  │ Code         │        │
│  │ Updater     │  │ Fixer       │  │ Reviewer     │        │
│  │             │  │             │  │             │         │
│  │ kimi-wiki   │  │ kimi-code   │  │ kimi-review  │        │
│  │ ● running   │  │ ○ idle      │  │ ○ idle       │        │
│  │ run: 2m ago │  │ last: 1h    │  │ last: 30m    │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Card States

| State | Indicator | Meaning |
|-------|-----------|---------|
| `● running` | Green pulse | Actively processing a ticket |
| `○ idle` | Dim | No active work |
| `⏸ paused` | Yellow | Paused by user |
| `● error` | Red | Last run failed |

### Expanded Card

Click a card to see: AGENT.md preview, WORKFLOW.md preview, recent runs, pending tickets. Full details without leaving the workspace.

---

## Starter Agents

| Agent | Bot name | What it does |
|-------|----------|-------------|
| **wiki-updater** | `kimi-wiki` | Reads source material, updates wiki PAGE.md files |
| **bug-fixer** | `kimi-code` | Reads bug description, locates code, proposes fix |
| **code-reviewer** | `kimi-review` | Reviews code changes for quality, patterns, security |
| **edge-checker** | `kimi-edge` | Processes edge propagation — checks linked wiki pages |
| **skills-sync** | `kimi-skills` | Checks wiki changes against skill files for drift |

---

## Design Decisions

### Why the agent folder is the routing

The folder contains AGENT.md, WORKFLOW.md, and numbered prompts. That's everything the agent needs. No external labels or routing tags — the assignee field points to the folder via registry.json. Adding a new agent is creating a folder and a registry entry.

### Why numbered prompts instead of one big prompt

Breaking the workflow into discrete turns gives you:
- **Auditability** — each step saved separately in runs/steps/
- **Control** — stop between steps if something looks wrong
- **Context management** — each step sees only what it needs plus prior outputs
- **Reusability** — swap a single prompt without rewriting the whole agent

### Why one session per run

Clean slate prevents context bleed. Each run starts fresh with just AGENT.md + the ticket. If the agent fails, the next run doesn't inherit the failure. Frozen files per run ensure reproducibility.

### Why the agents workspace owns the runner

The runner is execution logic. It belongs with the agents, not in the server or the issues workspace. The server is a thin relay. Issues owns the board. Agents own the work.

---

## Related

- [Ticket-Routing](Ticket-Routing) — how tickets move through columns
- [Run-Auditing](Run-Auditing) — inspecting completed runs
- [Workspace-Agent-Model](Workspace-Agent-Model) — the file pattern workspaces follow
- [Model-Config](Model-Config) — per-agent model preferences
- [Workspaces](Workspaces) — all workspace roles
