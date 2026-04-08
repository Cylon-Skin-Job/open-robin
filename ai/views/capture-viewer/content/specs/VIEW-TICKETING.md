---
title: View Spec — Ticketing
created: 2026-03-28
updated: 2026-03-28
status: active
parent: MASTER_SYSTEM_SPEC.md
absorbs: TICKETING-SPEC.md (core model), DOMAIN-5-BLOCKING.md (blocking fields)
---

# Ticketing View

Local-first ticketing with GitLab Issues as the collaboration layer. Tickets are the universal work unit — they drive agent dispatch, cron schedules, one-off future tasks, blocking, and cross-instance coordination.

---

## Filtered Views

The ticket pool is one flat list. Views are filters over it. The user configures defaults and visible views via `index.json`.

| View | Filter | Purpose |
|------|--------|---------|
| **All** | No filter | Everything — local, public, crons, one-offs, PRs |
| **Board** | Grouped by assignee+state | Three-column INBOX/OPEN/COMPLETED |
| **Local Hub** | `visibility: local` | Stays on your machine. Never synced to GitLab. Internal crons, personal reminders, local-only agent work |
| **Public Exchange** | `visibility: public` | Synced to GitLab. Visible to collaborators. Cross-instance coordination |
| **Calendar** | Has `fires-at` or `schedule` | Month view. One-offs and scheduled crons on a timeline with countdowns |

View configuration, defaults, and state persistence controlled by `index.json` in the issues folder.

---

## Board Layout (default)

```
┌──────────────────┬──────────────────┬──────────────────┐
│  INBOX           │  OPEN            │  COMPLETED       │
│  (human)         │  (bot running)   │  (closed)        │
│                  │                  │                  │
│  ┌────────────┐  │  ┌────────────┐  │  ┌────────────┐  │
│  │ KIMI-0040  │  │  │ KIMI-0038  │  │  │ KIMI-0035  │  │
│  │ assignee:  │  │  │ kimi-wiki  │  │  │ done       │  │
│  │ you        │  │  │ running... │  │  │            │  │
│  └────────────┘  │  └────────────┘  │  └────────────┘  │
└──────────────────┴──────────────────┴──────────────────┘
```

Column is determined entirely by **assignee + state**:
- Assigned to a human -> INBOX
- Assigned to a bot name -> OPEN (dispatched to agent)
- Closed -> COMPLETED

---

## Ticket Format

```markdown
---
id: KIMI-0045
title: Daily wiki check
assignee: kimi-wiki
created: 2026-03-28T10:00:00
author: local
state: open
visibility: public
schedule: "daily 09:00"
fires-at: 2026-03-29T09:00:00
blocks: [self, wiki-updates]
blocked_by: null
tags: [cron, wiki]
---

Run your daily freshness check against recent commits.
```

### Fields

| Field | Type | Purpose |
|-------|------|---------|
| `id` | string | Local ID (KIMI-NNNN) |
| `title` | string | One-line summary |
| `assignee` | string | Dispatch key: bot name or human username |
| `state` | enum | `open`, `claimed`, `closed` |
| `visibility` | enum | `local` (never synced) or `public` (synced to GitLab) |
| `schedule` | string | Cron expression (`daily 09:00`, `0 9 * * *`). Repeating. |
| `fires-at` | ISO 8601 | One-shot future execution time. Countdown in UI. |
| `blocks` | string or array | Topic/resource names this ticket locks. `self` = re-blocks itself after firing (for repeating crons). |
| `blocked_by` | string | Ticket ID, `auto-hold`, or null |
| `tags` | array | Free-form strings for filtering views |
| `author` | enum | `local` or `gitlab` |
| `gitlab_iid` | number | GitLab issue number (set after first push) |
| `prompt` | string | Prompt file reference for agent execution |

---

## Two Ticket Patterns

### Repeating Cron

Defined in TRIGGERS.md. Generates a fresh ticket each time the schedule fires. The schedule lives in the trigger file, not the ticket.

```yaml
# In TRIGGERS.md
---
name: daily-wiki-check
type: cron
schedule: "daily 09:00"
action: create-ticket
ticket:
  title: "Daily wiki freshness check"
  assignee: kimi-wiki
  visibility: public
  tags: [cron, wiki]
  prompt: PROMPT_02.md
---
```

### One-Shot Delayed

A single ticket with a `fires-at` timestamp. An agent creates it mid-conversation. No TRIGGERS.md needed. Dispatch watcher holds until the clock hits.

```markdown
---
id: KIMI-0046
title: Check deployment health
assignee: kimi-code
fires-at: 2026-03-28T17:00:00
visibility: local
blocks: [wiki-updates]
state: open
---

Check the deployment at myapp.com. Notify user via Signal if it fails.
```

The agent can also set this up on behalf of the user during a chat:
- "Wake up in 4 hours and check this" -> agent creates ticket with `fires-at: now + 4h`
- "Don't let wiki edits through before then" -> agent adds `blocks: wiki-updates`

---

## Cron-Chat Integration

Any chat can have a cron attached. The cron sends a **gray system message** to the chat when it fires. This is implemented as a self-blocking ticket:

1. Ticket has `schedule` and `blocks: [self]`
2. Cron fires -> sends system message to target chat -> ticket re-blocks itself
3. UI shows countdown to next fire
4. System events can postpone (reset the countdown)
5. User or agent can pause without closing

---

## Blocking

### `blocked_by`
- Ticket ID (KIMI-NNNN): must close before this ticket dispatches
- `auto-hold`: 9-minute timer from hold-registry (batches rapid-fire triggers)
- `self`: for repeating crons — re-blocks after each fire with next countdown

### `blocks`
- Topic/resource name: while this ticket is open, no other ticket targeting that topic dispatches
- Array supported: `blocks: [self, wiki-updates, database-refactor]`
- Evaluated at dispatch time from the full ticket pool

### Cross-Instance Blocking

Currently `blocks`/`blocked_by` are local-only. To make blocking work across instances, encode in GitLab description or labels on sync. Not yet implemented but the architecture supports it — pull would read blocking fields and evaluate them the same way.

---

## Dispatch Logic

The server watches `issues/` for changes. Dispatch requires:
1. State is `open`
2. Assignee maps to a known bot in `registry.json`
3. Not blocked (no open blocker, no topic lock, no auto-hold)
4. If `fires-at` is set, current time must be >= `fires-at`

Detection via `fs.watch` on the issues root. No polling.

### Claiming (Distributed Lock via GitLab)

```
1. shouldDispatch() passes
2. claimTicket() → state: open → claimed (local)
3. syncPush() → PUT assignee on GitLab (claim signal to other instances)
4. syncPull() → fetch latest (catch other claims, new blockers)
5. Re-check shouldDispatch() with fresh data
6. If still eligible → executeRun()
7. If not → release claim, revert to open
```

GitLab assignee IS the distributed mutex:
- No assignee on GitLab = available
- Bot assigned = claimed by an instance
- Other instances pull, see the claim, back off

---

## Visibility and Sync

| Visibility | GitLab Sync | Who sees it |
|-----------|-------------|-------------|
| `local` | Never pushed | Only this machine |
| `public` | Bidirectional | All collaborators via GitLab |

The sync system checks `visibility` before pushing. Local tickets stay local. Public tickets follow the full push/pull cycle.

### Sync Flow

- **Push**: local state -> GitLab (create issue, update assignee/state, close)
- **Pull**: GitLab -> local (new issues, state changes, assignee changes)
- **Claim signal**: bot assigned on GitLab = "this instance owns it"
- **Bot accounts**: `sync.json` maps bot names to GitLab user IDs

---

## Folder Structure

```
ai/views/issues-viewer/
  ├── index.json             ← view config, defaults, state
  ├── sync.json              ← last sync timestamp, ID counter, bot accounts
  ├── tickets.json           ← index of all tickets
  ├── KIMI-0040.md           ← open tickets at root
  ├── KIMI-0041.md
  ├── done/
  │   ├── KIMI-0035.md       ← closed tickets
  │   └── KIMI-0036.md
  └── scripts/
      ├── create-ticket.js
      └── sync-tickets.js
```

Open = root directory. Closed = `done/`. Structural, not metadata-based.

---

## Robin's Role

Robin is the ticket-mediated dispatch layer. She creates tickets, agents execute, she reports back. Every action Robin takes on project files goes through a ticket. This is the trust model.

Robin can also show cross-project ticket visibility in her panel — all tickets across all projects, filtered and searchable.

---

## Child Tickets

Agents can declare downstream work during execution:
```
CHILD_TICKET: kimi-wiki "gitlab page references outdated token expiry"
```
The runner creates the child ticket. Parent manifest records the child ID. `limits.max_depth` prevents infinite loops.

---

## TODO

- [ ] Ticket board UI rendering
- [ ] Filtered views (All, Local Hub, Public Exchange, Calendar)
- [ ] Calendar month view with countdowns
- [ ] `fires-at` support in dispatch watcher
- [ ] `visibility` field in create-ticket.js and sync
- [ ] `tags` field and tag-based filtering
- [ ] Cross-instance blocking via GitLab encoding
- [ ] Cron-chat self-blocking ticket pattern
- [ ] index.json view configuration
- [ ] Blocking indicators in UI (lock icon, countdown)
- [ ] Cross-project ticket visibility in Robin's panel
