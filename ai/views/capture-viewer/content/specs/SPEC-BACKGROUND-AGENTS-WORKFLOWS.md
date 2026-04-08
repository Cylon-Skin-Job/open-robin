---
title: Spec — Background Agents, Workflows, and Runs
created: 2026-03-30
status: draft
parent: MASTER_SYSTEM_SPEC.md
---

# Background Agents, Workflows, and Runs

Background agents follow the same folder conventions as chat-facing agents. The key architectural decision: **fronting agent chat is system history (robin.db). Workflow runs are project work product (filesystem only).**

---

## Two Tiers of History

### System history → robin.db

The fronting agent (the agent that manages and assigns workflows) has a `chat/` folder that conforms to chat rules. Its exchanges are stored in robin.db and its markdown receipts go in `threads/{username}/`. This history is:

- Preserved at all costs
- Queryable across workspaces
- Cross-workspace searchable via skills
- Treated the same as any user-facing chat

### Project work product → filesystem

Workflow runs — the actual execution folders with attestation cards, frozen configs, and lessons — live entirely in the repo as folders and markdown. This work product is:

- Shareable via git push/pull
- Analyzable by sub-agents using grep and file reads
- Optionally gitignored per team preference
- Never touches robin.db

---

## Folder Structure

```
ai/views/{view}/agents/{agent}/
  chat/
    settings/
      SESSION.md               ← fronting agent config (daily-rolling)
      TRIGGERS.md              ← chat-scoped triggers
    threads/
      {username}/
        2026-03-30.md          ← fronting agent chat → also in robin.db
  workflows/
    {workflow-name}/
      WORKFLOW.md              ← the prompt (steps, context, file paths)
      LESSONS.md               ← accumulates over time from all runs
      TRIGGERS.md              ← monitors descendants, files tickets, assigns workers
      settings/
        SESSION.md             ← harness as orchestrator, subagent dispatch
      runs/
        {username}/
          2026-03-30/
            settings/
              WORKFLOW.md      ← frozen copy from parent at run start
              SESSION.md       ← frozen copy from parent at run start
            LESSONS.md         ← agent-editable during run, frozen after
            step-1-attest.md   ← attestation cards per step
            step-2-attest.md
            step-3-attest.md
          2026-03-29/
            settings/
              WORKFLOW.md      ← frozen from that date
              SESSION.md       ← frozen from that date
            LESSONS.md         ← frozen lessons as of that run
            step-1-attest.md
            step-2-attest.md
```

---

## Fronting Agent

The fronting agent is the background agent's "face." It:

- Has its own chat folder (daily-rolling by default)
- Manages and assigns workflows
- Files tickets via triggers
- Its chat history goes into robin.db (system history)

The fronting agent's SESSION.md uses the harness as orchestrator. It dispatches sub-agents one at a time, passing each a single step plus context (filenames, file paths, relevant prior attestation cards).

---

## Workflow Execution

### WORKFLOW.md — the prompt

Defines the steps of the workflow. Each step includes:
- What to do
- What files/paths are relevant
- What context to pass to the sub-agent
- Success criteria

### SESSION.md — the harness config

Lives in `workflows/{name}/settings/`. Configures:
- Orchestrator mode (harness dispatches sub-agents sequentially)
- Tool permissions scoped to workflow needs
- CLI profile for sub-agents

### TRIGGERS.md — the automation

Lives in `workflows/{name}/`. Handles:
- Filing tickets and assigning workers (if instant)
- Creating run folders with date
- Copying WORKFLOW.md and SESSION.md into `runs/{date}/settings/`
- Monitoring LESSONS.md in descendant folders
- Updating parent LESSONS.md when descendants change

---

## Frozen Copy Pattern

When a run starts:

1. Trigger creates `runs/{username}/{date}/` folder
2. Copies current `WORKFLOW.md` → `runs/{username}/{date}/settings/WORKFLOW.md`
3. Copies current `SESSION.md` → `runs/{username}/{date}/settings/SESSION.md`
4. Copies current parent `LESSONS.md` → `runs/{username}/{date}/LESSONS.md`

This gives you:
- **Audit trail**: You know exactly what instructions the agent operated under for that run
- **Reproducibility**: The frozen config is the complete input for that run
- **Evolution tracking**: Compare frozen copies across dates to see how the workflow changed

After the run:
- `LESSONS.md` in the run folder is frozen (reflects what was learned during and before that run)
- Parent `LESSONS.md` gets updated via triggers (accumulates learnings over time)
- Attestation cards in the run folder are permanent records of agent decisions

---

## LESSONS.md Propagation

```
workflows/{name}/LESSONS.md          ← accumulates from ALL runs
  ↑ trigger monitors descendants
  │
  ├─ runs/{user}/2026-03-30/LESSONS.md  ← frozen to this run
  ├─ runs/{user}/2026-03-29/LESSONS.md  ← frozen to prior run
  └─ runs/{user}/2026-03-28/LESSONS.md  ← frozen to earlier run
```

- Parent TRIGGERS.md watches `**/LESSONS.md` in any descendant `runs/` folder
- When a run's LESSONS.md gets new entries, trigger updates parent LESSONS.md
- Parent LESSONS.md is the living document; run copies are snapshots
- Over time, the parent LESSONS.md becomes the distilled wisdom of all runs

---

## Attestation Cards

Each step in a workflow produces an attestation card (`step-N-attest.md`) in the run folder. These record:

- What the agent was asked to do (the step)
- What the agent decided
- What the agent did (tool calls, file changes)
- Evidence of success or failure
- Any lessons learned

Attestation cards are the raw material for pattern analysis. Sub-agents can be fired at the `runs/` folder to:
- Look for common threads across runs
- Find repeated breakages
- Identify patterns in agent decision-making
- Surface workflow improvements

---

## Sharing and Team Collaboration

Everything is folders, so sharing is git:

| What to share | How | Use case |
|---------------|-----|----------|
| Workflow definition | Share `workflows/{name}/` (minus runs/) | Team uses same workflow |
| Agent + workflows | Share entire `agents/{name}/` | Team uses same agent setup |
| Individual runs | Push `runs/{username}/` | Show your work, peer review |
| All runs | Don't gitignore `runs/` | Full team transparency |
| Private runs | Gitignore `runs/` | Keep execution history local |
| Lessons only | Share parent `LESSONS.md` only | Distilled wisdom without run details |

Teams can choose their sharing level by configuring `.gitignore` at the appropriate folder level.

---

## What Goes Where — Decision Matrix

| Data | Storage | Why |
|------|---------|-----|
| Fronting agent chat | robin.db + markdown receipts | System history, queryable, preserved |
| Workflow definitions | Filesystem (WORKFLOW.md) | Shareable, versionable, human-readable |
| Run execution | Filesystem (runs/ folders) | Work product, auditable, optional sharing |
| Attestation cards | Filesystem (step-N-attest.md) | Evidence, pattern analysis by sub-agents |
| Lessons learned | Filesystem (LESSONS.md) | Accumulated wisdom, frozen per run |
| Frozen configs | Filesystem (runs/{date}/settings/) | Audit trail, reproducibility |
| System config | robin.db | Global, above workspaces |

---

## Open Questions

1. **Run folder naming**: `{date}` works for daily-rolling workflows. For workflows that run multiple times per day, do we need `{date}-{seq}` or `{date}-{time}`?

2. **Lessons deduplication**: As parent LESSONS.md grows from trigger propagation, how do we prevent duplicate entries? Content hash check? AI-driven dedup?

3. **Attestation card format**: Standard frontmatter? Free-form markdown? Both?

4. **Workflow versioning**: When WORKFLOW.md changes significantly, should we create a new version folder rather than overwriting? Or is the frozen copy pattern in runs/ sufficient?

5. **Sub-agent analysis**: The meta-agent that analyzes runs across agents — does it get its own agent folder, or is it a system-level skill?
