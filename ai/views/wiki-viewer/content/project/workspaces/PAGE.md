# Workspaces

Eight workspace tabs. Each owns its domain. No workspace reaches into another's logic.

## Overview

| Workspace | Color | Icon | Purpose | Role | Status |
|-----------|-------|------|---------|------|--------|
| `code` | Cyan | `code_blocks` | File editor, coding chat | Reader + ticket creator | Active |
| `pre-flight` | Amber | `stat_minus_3` | Plan, validate, prep | Reader + ticket creator | Planned |
| `launch` | Orange | `rocket` | Build and test pipeline | Automated | Planned |
| `review` | Green | `rebase_edit` | Review, commit, trigger hooks | Reader + ticket creator | Planned |
| `issues` | Yellow | `business_messages` | Ticket board, GitLab sync | Board owner | Planned |
| `wiki` | Pink | `full_coverage` | Documentation, wiki browsing | Reader + ticket creator | Active |
| `background-agents` | Red | `smart_toy` | Agent command center | Executor | Planned |
| `skills` | Purple | `dynamic_form` | Commands, prompts | Reader + ticket creator | Planned |

## Workspace Ownership

Each workspace owns its job and nothing else. This is the core separation:

```
Readers + Ticket Creators   → wiki, code, pre-flight, review, skills
  └─ User reads content, chat creates tickets
  └─ Never runs agents, never executes work

Automated                   → launch
  └─ Build and test pipeline, runs automatically

Board Owner                 → issues
  └─ Owns the ticket board and GitLab sync
  └─ Moves tickets between columns
  └─ Doesn't run agents or know agent logic

Executor                    → background-agents
  └─ Owns the runner, wire protocol, agent folders
  └─ Runs tickets, produces audited run folders
  └─ Doesn't create tickets or manage the board
```

No user-facing workspace has agents. No workspace owns more than one domain. The boundaries are strict.

## How Tickets Flow Between Workspaces

```
wiki ──── creates ticket ────→ issues ──── dispatches ────→ background-agents
code ──── creates ticket ────→ issues ──── dispatches ────→ background-agents
cron ──── creates ticket ────→ issues ──── dispatches ────→ background-agents
agent ─── creates child ─────→ issues ──── dispatches ────→ background-agents

all ───── state updates ─────→ ai/STATE.md (cross-workspace breadcrumbs)
issues ── bidirectional sync ─→ GitLab Issues (collaboration layer)
```

### The Three-Column Model

Tickets move through three columns based on assignee + state:

```
INBOX              OPEN                COMPLETED
(assigned: human)  (assigned: bot)     (state: closed)
```

Issues workspace owns the board. It doesn't know what agents do — it just sees who's assigned and whether the ticket is open or closed.

See [Ticket-Routing](Ticket-Routing) for the full routing spec.

## How Workspaces Work

Each workspace has a chat interface scoped by workspace-level files:

- **PROMPT.md** — chat agent identity and scope
- **TOOLS.md** — what the chat agent can do (typically: read anything, write only to issues)
- **api.json** — model preferences for the chat session
- **workspace.json** — metadata and settings

The server reads these files and enforces them. See [Workspace-Agent-Model](Workspace-Agent-Model) for the full pattern.

## Per-Workspace Details

### code (Active)
File editor and coding chat. Read-only interface — chat creates tickets for bugs, reviews, refactors. Existing thread system for conversation history.

### wiki (Active)
Wiki browsing interface. Three-column layout: topic list, rendered PAGE.md, edges + floating chat. Chat is read-only for wiki files, creates tickets for updates. See [Wiki-Interface](Wiki-Interface).

### issues (Planned)
The ticket board. Owns `tickets/` folder and GitLab sync. Three-column view: INBOX (human-assigned), OPEN (bot-assigned), COMPLETED (closed). Syncs bidirectionally with GitLab Issues for collaboration with external contributors. See [Ticket-Routing](Ticket-Routing).

### background-agents (Planned)
The executor. Tiles UI showing all agents as cards. Each agent is a folder with AGENT.md, WORKFLOW.md, numbered prompts, and a runs/ directory. Owns the wire protocol runner. See [Background-Agents](Background-Agents).

### pre-flight (Planned)
Planning and validation workspace. Review proposed changes, validate dependencies, prep work before builds. Chat creates tickets for validation issues.

### launch (Planned)
Build and test pipeline. Automated workspace that runs builds, tests, and deployment steps. No user chat — fully automated, triggered by the pre-flight stage.

### review (Planned)
Review, commit, and trigger hooks. Final stage of the pipeline — inspect results, approve commits, trigger post-merge hooks.

### skills (Planned)
Manages Claude Code commands and Cursor skills. Read-only view of current skills. Chat creates tickets for skill updates, sync checks.

## Related

- [Workspace-Agent-Model](Workspace-Agent-Model) — the file pattern for workspace chat agents
- [Background-Agents](Background-Agents) — the agent command center and execution workspace
- [Ticket-Routing](Ticket-Routing) — how tickets flow between workspaces
- [Session-Scoping](Session-Scoping) — isolated sessions per workspace
- [Model-Config](Model-Config) — per-workspace model preferences
