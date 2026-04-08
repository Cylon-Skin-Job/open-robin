# Ticket Routing

Three columns. One mechanism. The assignee determines everything.

## The Three-Column Model

```
INBOX              OPEN                COMPLETED
(assigned: human)  (assigned: bot)     (state: closed)
```

- **Assigned to a human** → INBOX. Human decides what to do.
- **Assigned to a bot name** → OPEN. Server dispatches to agent. Agent runs.
- **Closed** → COMPLETED. Done.

No lifecycle labels. No routing tags. No status fields. The column is the assignee.

---

## How Tickets Move

```
Ticket created (by you, a friend, a cron job, or another agent)
  → assigned to you → sits in INBOX
  → you decide it should run
  → reassign to bot name (e.g., kimi-wiki)
  → server sees bot-assigned ticket → dispatches to agent
  → agent runs, produces a run folder with full audit trail
  → agent finishes → ticket closed → COMPLETED
  → sync pushes closed state to GitLab
```

Or the fast path — a cron job or agent creates a ticket and assigns the bot directly:

```
Cron: "Daily wiki freshness check" → assigned to kimi-wiki
  → skips INBOX entirely
  → goes straight to OPEN → agent runs → COMPLETED
```

---

## Dispatch Logic

The server watches `issues/tickets/` via `fs.watch`. No polling. Dispatch is three conditions:

```
1. Is the ticket open?
2. Is the assignee a known bot name?
3. Is the bot available (not at max concurrent runs)?

All yes → dispatch. Otherwise → skip.
```

The dispatch system doesn't read labels, tags, or metadata beyond the assignee field. The **agent folder is the routing** — it contains AGENT.md, WORKFLOW.md, and numbered prompts that define what the agent does. The assignee just points to the folder.

---

## Where Tickets Live

**Locally:** `ai/workspaces/issues/tickets/KIMI-NNNN.md`

Each ticket is a markdown file with frontmatter:

```markdown
---
id: KIMI-0014
gitlab_iid: 23
title: Update secrets page token expiry
assignee: kimi-wiki
created: 2026-03-21T10:00:00
author: local
state: open
---

The secrets page lists token expiry as 2026-03-22 but it was
rotated to 2026-06-20. Update PAGE.md to reflect the new date.
```

**On GitLab:** A normal issue. Synced bidirectionally. Labels and milestones are optional — for humans browsing the board, not for dispatch.

---

## Workspace Ownership

Each workspace owns its job. No workspace reaches into another's logic.

| Workspace | Owns | Doesn't touch |
|-----------|------|---------------|
| **Cron** | Creating tickets, assigning bots | Routing, execution |
| **Issues** | The board, GitLab sync, status | Agent logic, prompts |
| **Agents** | Running work, wire protocol, prompts | Ticket creation, sync |

The server is a thin relay between them.

---

## GitLab Sync

Bidirectional. Issues workspace owns the sync script.

**Push (local → GitLab):**
- New local ticket → create GitLab issue, write `gitlab_iid` back
- Assignee or state changed locally → update GitLab issue
- Closed locally → close GitLab issue

**Pull (GitLab → local):**
- New GitLab issue (friend created it) → create local ticket with `author: gitlab`
- Assignee or state changed on GitLab → update local ticket
- New comments → pull to local

---

## Collaboration

### You create work for a friend

You write a ticket, assign to their GitLab username. Sync pushes it. They see it on GitLab in the INBOX column. They work on it, close it. Next sync pulls the closure.

### Friend creates work for you

Friend opens a GitLab Issue. Assigns to you. Next sync pulls it locally. You see it in INBOX. You assign to a bot. Agent runs. Closes. Sync pushes result back. Friend sees the resolution on GitLab.

### You + bot on the same ticket

You're assigned. You add the bot as co-assignee (or reassign entirely). Bot runs, posts summaries as GitLab comments. You review, close when satisfied.

---

## Child Tickets

When an agent discovers downstream work during execution, it declares a child ticket:

```
Agent output: CHILD_TICKET: kimi-wiki "gitlab page references outdated token expiry"
  → Runner creates new local ticket, assigns to named bot
  → Syncs to GitLab
  → Goes through the same dispatch loop
  → Parent manifest records child ticket ID
```

The agent doesn't dispatch the child. It declares what needs to happen. The system handles the rest.

### Preventing Loops

- `max_depth` in agent.json — no children beyond this depth
- Circuit breaker: if a child targets the same topic as an ancestor, stop
- Manifest tracks full lineage

---

## Cron Jobs — Ticket Factories

Cron jobs create tickets and assign bots. That's their entire job. They don't know what the agents do.

```bash
# Daily wiki freshness — 9am
0 9 * * * node ai/workspaces/issues/scripts/create-ticket.js \
  --title "Daily wiki freshness check" \
  --assignee kimi-wiki \
  --body "Check all wiki topics for staleness."

# Weekly code review — Monday 10am
0 10 * * 1 node ai/workspaces/issues/scripts/create-ticket.js \
  --title "Weekly code quality scan" \
  --assignee kimi-review
```

The intelligence lives in the agent folder, not the cron job.

---

## Related

- [Background-Agents](Background-Agents) — the agent workspace that runs tickets
- [Workspaces](Workspaces) — workspace ownership roles
- [Run-Auditing](Run-Auditing) — inspecting completed runs
- [Workspace-Agent-Model](Workspace-Agent-Model) — the file pattern agents follow
