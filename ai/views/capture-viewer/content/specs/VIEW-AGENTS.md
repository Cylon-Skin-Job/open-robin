---
title: View Spec — Agents
created: 2026-03-28
updated: 2026-03-28
status: active
parent: MASTER_SYSTEM_SPEC.md
absorbs: PANEL-AGENT-SPEC.md (agent model), DOMAIN-1-RUNNER.md (execution), RUN-FOLDER-SPEC.md (run structure)
---

# Agents View

The agents workspace shows all background agents as cards. Each agent has its own persona, workflows, run history, and settings.

---

## Layout

```
┌──────────────────────────────────────────────────────┐
│  Agent Cards                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ Wiki     │ │ Code     │ │ Auditor  │            │
│  │ Manager  │ │ Manager  │ │          │            │
│  │ idle     │ │ running  │ │ idle     │            │
│  └──────────┘ └──────────┘ └──────────┘            │
└──────────────────────────────────────────────────────┘

Click card -> Bot Detail:
┌──────────────────────────────────────────────────────┐
│  Wiki Manager                    idle          [x]   │
│                                                      │
│  (Workflows)  (Runs)  (Settings)                     │
│  ┌────────────┬─────────────────┬──────────────────┐ │
│  │ Sidebar    │ Content viewer  │ Chat area        │ │
│  │ (per tab)  │ (selected item) │                  │ │
│  └────────────┴─────────────────┴──────────────────┘ │
└──────────────────────────────────────────────────────┘
```

---

## Agent Definition (by folder)

```
ai/agent-viewer/{folder}/{agentName}/
  PROMPT.md           ← personality, role, scope, constraints (was PROMPT.md)
  SESSION.md          ← harness config + CLI profile + tool permissions (absorbs TOOLS.md)
  MEMORY.md           ← persistent memory (user preferences, discovered through conversation)
  TRIGGERS.md         ← event-driven activation rules
  HISTORY.md          ← activity log (recent events, daily summaries)
  styles.css          ← UI styling for tile card
  workflows/
    {Workflow Name}/
      WORKFLOW.md     ← orchestrator instructions with YAML frontmatter
      TRIGGERS.md     ← workflow-specific triggers
      LESSONS.md      ← workflow-scoped learnings (append-only)
  runs/               ← execution history (one folder per ticket)
  threads/            ← conversation threads (daily-rolling)
```

**No LESSONS.md at agent root.** Lessons are workflow-scoped — each workflow has its own. Run agents don't need persistent memory; MEMORY.md lives with the agent, not the run.

---

## File Definitions

### PROMPT.md (renamed from PROMPT.md)

Who the agent is. Loaded at session start as system context. Should stay under 500 tokens.

Contains:
- Agent name and role
- Domain (what files/areas it owns)
- Prompts table (which workflow does what)
- Standards it follows
- How it works (triggers, blocks, records)
- How it responds when the user talks to it directly

**What's built:**
- [x] 3 PROMPT.md files exist (code-manager, ops-manager, wiki-manager) — rich content
- [x] Loaded via SESSION.md `system-context` array by session-loader.js
- [x] Displayed in UI with `badge` icon (AgentTiles.tsx)

**What's needed:**
- [ ] Rename PROMPT.md -> PROMPT.md across codebase (~15 touch points)
- [ ] Update session-loader.js docs, agentStore.ts, AgentTiles.tsx icon map, PromptCardView.tsx filter
- [ ] Update all SESSION.md `system-context` arrays
- [ ] Update specs and wiki pages

### SESSION.md (now absorbs TOOLS.md)

All session configuration in one file. Parsed by `session-loader.js`, consumed by `server.js` to spawn wire sessions.

```yaml
---
thread-model: daily-rolling
session-invalidation: memory-mtime
idle-timeout: 9m
system-context: ["PROMPT.md", "MEMORY.md"]

# CLI profile (new — determines which CLI and model to use)
cli: kimi
profile: default
model: claude-sonnet-4-6
endpoint: https://api.anthropic.com/v1/messages

# Tool permissions (absorbed from TOOLS.md)
tools:
  allowed:
    - read_file
    - glob
    - grep
    - git_log
    - git_diff
  restricted:
    write_file: ["ai/wiki-data/project/**", "ai/views/wiki-viewer/runs/**"]
    edit_file: ["ai/wiki-data/project/**"]
  denied:
    - shell_exec
    - git_commit
    - git_push

# DB access (scoped per agent)
db:
  read: [tickets, wiki_topics, chat_history]
  write: [tickets]
  denied: [system_config, secrets]
---
```

SESSION.md is the **single permission surface** — tools, DB tables, CLI profile, session behavior. One file, one place to audit.

**What's built:**
- [x] SESSION.md parsing (session-loader.js `parseSessionConfig()`)
- [x] System context loading via `system-context` list
- [x] Thread model selection (daily-rolling, multi-thread, single-persistent)
- [x] Session invalidation on MEMORY.md mtime change
- [x] Idle timeout configuration
- [x] System context injection on first prompt in server.js
- [x] UI display in agent detail Settings tab

**What's needed:**
- [ ] Add CLI profile fields to SESSION.md frontmatter
- [ ] Extend `parseSessionConfig()` to extract tool permissions
- [ ] Implement server-side tool enforcement (validate tool calls before forwarding to wire)
- [ ] Add `profile` field that references Robin's Profiles tab
- [ ] Remove standalone TOOLS.md (only exists for wiki-viewer currently)

### MEMORY.md

User preferences discovered through conversation. Loaded at session start. Starts empty, grows over time. Session invalidation checks MEMORY.md mtime — if memory was updated since last session, the session refreshes.

**What's built:**
- [x] Template exists in all 3 agents (empty, with placeholder comment)
- [x] Loaded as system context alongside PROMPT.md
- [x] Session invalidation checks mtime (`checkSessionInvalidation()`)

**What's needed:**
- [ ] Nightly rollover: when daily-rolling chat transitions to next day, summarize key points into MEMORY.md
- [ ] Threaded chat: use MEMORY.md before context compression (load it as refresher when thread resumes)
- [ ] Agent self-write: agents should update MEMORY.md with discovered user preferences

### LESSONS.md (workflow-scoped only)

Append-only institutional memory per workflow. Frozen copy drops into run folders at start. Review trigger at ~500 tokens.

**What's built:**
- [x] 56 LESSONS.md files across agents and workflows
- [x] Append-only pattern established
- [x] Frozen copy into runs by run-folder.js
- [x] Review trigger spec (lessons-review.md) — creates ticket when exceeding ~500 tokens

**What's needed:**
- [ ] Move any agent-root LESSONS.md into workflows (lessons are workflow-scoped)
- [ ] Implement token counting trigger in watcher
- [ ] Review flow: human reads, promotes to PROMPT.md, clears reviewed entries

### TRIGGERS.md

Event-driven activation. See SPEC-EVENT-SYSTEM.md for full syntax. TRIGGERS.md lives at **two levels**:

- **Agent-level** (`agents/{agentName}/TRIGGERS.md`) — fronting persona triggers. Cross-workflow concerns, nightly audits, general agent-scoped events.
- **Workflow-level** (`agents/{agentName}/workflows/{name}/TRIGGERS.md`) — workflow-specific triggers. "When a source file changes, run THIS workflow."

Both are discovered by the trigger-loader. They chain via the event bus — one workflow completing emits `agent:run_completed`, which another workflow's TRIGGERS.md can listen for.

Every trigger fire is an event itself (`trigger:fired`) with a `chain_id` that links to all downstream effects (ticket creation, dispatch, run start, run completion). Full causal traceability.

**What's built:**
- [x] wiki-manager TRIGGERS.md fully populated (4 triggers: source-file-change, wiki-page-changed, daily-freshness, nightly-audit)
- [x] Trigger parser, loader, cron scheduler all built
- [x] Hold registry for batching rapid-fire triggers
- [x] Trigger loader scans agent folders for TRIGGERS.md

**What's needed:**
- [ ] Trigger loader recurses into `workflows/*/TRIGGERS.md` (currently only reads agent-level)
- [ ] Populate code-manager and ops-manager TRIGGERS.md (agent-level + per-workflow)
- [ ] Extended event types (chat, ticket, agent, system) per SPEC-EVENT-SYSTEM.md
- [ ] `trigger:fired` event emission with chain_id
- [ ] `trigger:registered` / `trigger:unregistered` lifecycle events

---

## Runner (Execution Engine)

### What's Built

The runner is fully implemented across 4 modules:

| Module | Path | Purpose |
|--------|------|---------|
| `runner/index.js` | `lib/runner/index.js` | Main orchestrator — executeRun(), heartbeat, completion handling |
| `runner/run-folder.js` | `lib/runner/run-folder.js` | Creates run directory, freezes seed files, writes manifest |
| `runner/prompt-builder.js` | `lib/runner/prompt-builder.js` | Assembles system context (AGENTS.md + PROMPT body) and user message (ticket + run folder) |
| `runner/wire-session.js` | `lib/runner/wire-session.js` | Spawns CLI subprocess via wire protocol |

### Run Creation Flow

```
1. dispatch.js claims ticket (state: open -> claimed)
2. syncPush() to GitLab (claim signal)
3. syncPull() (catch new blocks)
4. Re-check eligibility
5. executeRun(projectRoot, agentFolder, ticket)
   ├── createRunFolder() — freezes ticket.md, WORKFLOW.md, LESSONS.md
   ├── Writes manifest.json (status: pending)
   ├── Writes run-index.json (empty steps)
   ├── buildContext() — AGENTS.md + PROMPT body as system, ticket as user
   ├── Spawns wire subprocess
   ├── Updates manifest (status: running)
   └── Monitors via heartbeat (5-min interval)
6. On exit:
   ├── Updates manifest (completed/stopped, outcome, timestamp)
   ├── Appends to agent HISTORY.md
   ├── Notifies persona wire session
   └── syncPush() completion to GitLab
```

### Run Folder Structure

```
runs/
  ledger.json                              ← ALL runs for this agent
  {Workflow Name}/
    ledger.json                            ← runs for this workflow only
    {YYYY-MM-DDTHH-MM-SS}/
      SESSION.md                           ← duped from workflow, created_at stamped
      ticket.md                            ← frozen copy of triggering ticket
      WORKFLOW.md                          ← frozen copy of workflow instructions
      LESSONS.md                           ← frozen copy of workflow lessons
      manifest.json                        ← status: pending -> running -> completed/stopped
      evidence/
        00-validate.md                     ← certificate cards (proof of work)
        01-gather.md
        02-propose.md
```

**SESSION.md** gets `created_at` stamped at run start. Next run can check its own folder for when it was born. Nightly audit checks `ledger.json` entries against `last_checked`.

**Ledger files** track all runs with timestamp, ticket, outcome, duration. `last_checked` field lets nightly audits diff "what's new since last audit." Scripts do the diffing, agents see clean results.

### Run Snapshot via Event Bus (planned)

Currently run folder creation is hardcoded in runner/index.js. The plan is to trigger run snapshots via the Universal Event Bus + a TRIGGERS.md in the agent's parent folder. The system eats its own dog food — ticket claimed event fires, trigger catches it, run folder is created.

**What's needed:**
- [ ] Wire run creation to `ticket:claimed` event on event bus
- [ ] TRIGGERS.md in agent parent folder that responds to claim events
- [ ] Remove hardcoded run creation from runner (or keep as fallback)

---

## Manifest Status Machine

```
pending -> running -> completed (exit code 0)
                   -> stopped   (non-zero exit, heartbeat timeout, or stall)
```

```json
{
  "run_id": "2026-03-28T14-32-15",
  "agent_id": "wiki-manager",
  "bot_name": "kimi-wiki",
  "ticket_id": "KIMI-0042",
  "prompt": "WORKFLOW.md",
  "status": "completed",
  "created": "2026-03-28T14:32:15.000Z",
  "started": "2026-03-28T14:32:16.000Z",
  "completed": "2026-03-28T14:35:42.000Z",
  "model": { "thinking": true, "max_context_size": 131072 },
  "outcome": "success",
  "error": null
}
```

---

## Registry

```json
{
  "version": "1.0",
  "agents": {
    "kimi-wiki": { "folder": "System/wiki-manager", "status": "idle" },
    "kimi-code": { "folder": "System/code-manager", "status": "idle" },
    "kimi-ops": { "folder": "System/ops-manager", "status": "idle" }
  }
}
```

`bot_name` in WORKFLOW.md frontmatter maps to registry key maps to GitLab assignee. That's the dispatch chain.

---

## Bot Detail Tabs

- **Workflows**: sidebar shows workflow cards (name + description), content shows step cards with detail panel
- **Runs**: sidebar shows run list by timestamp, content shows manifest + evidence cards per step
- **Settings**: sidebar shows PERSONA, MEMORY, SESSION, TRIGGERS; content shows plain text editor

---

## Robin's Relationship to Agents

Robin dispatches agents via tickets but never runs them directly. She can:
- See all agents across all projects
- Show run history and evidence cards
- Surface status in her dashboard (idle/running/error with RAM usage)
- Help build new agents
- Help write PROMPT.md, SESSION.md, TRIGGERS.md

---

## Current Agents

| Bot Name | Folder | Workflows | Triggers |
|----------|--------|-----------|----------|
| kimi-wiki | System/wiki-manager | Wiki Update, Wiki Audit, Edge Consistency | 4 triggers (source change, page change, daily freshness, nightly audit) |
| kimi-code | System/code-manager | Bug Fix, Code Review, Test Generation | Empty (planned) |
| kimi-ops | System/ops-manager | Dependency Audit, Documentation | Empty (planned) |

---

## TODO

### Built (working)
- [x] Runner: run-folder.js, prompt-builder.js, wire-session.js, index.js
- [x] Dispatch: claiming, blocking, GitLab sync, registry lookup
- [x] Session loader: SESSION.md parsing, system context injection
- [x] Trigger system: parser, loader, cron scheduler, hold registry
- [x] Agent detail UI: card layout, pill tabs, sidebar + content + chat
- [x] Workflow folders with WORKFLOW.md + TRIGGERS.md + LESSONS.md
- [x] 3 agents with PROMPT.md, SESSION.md, MEMORY.md, TRIGGERS.md

### Needed
- [ ] Rename PROMPT.md -> PROMPT.md (~15 touch points)
- [ ] Absorb TOOLS.md into SESSION.md (add tool permissions to frontmatter)
- [ ] Implement server-side tool enforcement
- [ ] Add CLI profile fields to SESSION.md
- [ ] Nightly MEMORY.md rollover (daily chat -> memory summary)
- [ ] LESSONS.md token counting and review trigger
- [ ] Populate code-manager and ops-manager TRIGGERS.md
- [ ] Run snapshot via event bus (ticket:claimed -> TRIGGERS.md -> create run folder)
- [ ] Evidence card rendering in run view
- [ ] Agent status indicators (idle/running/error) with RAM
- [ ] Cross-project agent visibility in Robin's panel
- [ ] No actual runs have executed yet — all runs/ directories are empty
