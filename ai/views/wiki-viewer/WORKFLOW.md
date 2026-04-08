# Workflow

This file is injected before every write/edit. Follow it exactly.

A frozen copy of this file is saved in each run folder. If this file changes, past runs retain the version that was active when they ran.

---

## Overview

One agent manages all wiki topics. Work arrives as tickets tagged `@wiki`. Each ticket becomes a **run** — a self-contained folder with a complete trace of every step. The agent traverses the topic graph on demand, follows edges recursively, and converges when nothing is stale. Edge propagation spawns child tickets.

```
TICKET → CREATE RUN → GATHER → PROPOSE → CHECK EDGES → EXECUTE → FOLLOW EDGES → CONVERGE
```

---

## Path Layout

Topic content lives in `ai/views/wiki-viewer/content/project/`. Run folders live in `ai/views/wiki-viewer/runs/`.

- Topic pages: `ai/views/wiki-viewer/content/project/{topic}/PAGE.md`
- Topic logs: `ai/views/wiki-viewer/content/project/{topic}/LOG.md`
- Topic indexes: `ai/views/wiki-viewer/content/project/{topic}/index.json`
- Collection index: `ai/views/wiki-viewer/content/project/index.json`
- Run folders: `ai/views/wiki-viewer/runs/{run-id}/`
- System wiki (read-only): `ai/views/wiki-viewer/content/system/`

## Run Folder Structure

Every ticket tagged `@wiki` gets a run folder. The ticketing system creates the folder and drops `ticket.md` inside. The agent populates the rest.

```
ai/views/wiki-viewer/runs/{run-id}/
├── ticket.md              ← living document: summary, TODO, step links
├── PROMPT.md              ← frozen copy of agent identity at run time
├── WORKFLOW.md            ← frozen copy of process rules at run time
├── manifest.json          ← machine-readable metadata
├── steps/
│   ├── 01-gather.md       ← what was read, what was found
│   ├── 02-propose.md      ← proposed changes, confidence level
│   ├── 03-edges.md        ← edge check results, graph traversal
│   ├── 04-execute.md      ← what was edited, reasoning, diffs
│   ├── 05-edge-{topic}.md ← sub-loop for each stale edge
│   └── NN-converge.md     ← final state, convergence proof
├── snapshots/
│   ├── {topic}-before.md  ← PAGE.md state before edit
│   └── {topic}-after.md   ← PAGE.md state after edit
└── index-before.json      ← graph state at run start
```

---

## Step 0: Create Run

When a ticket arrives tagged `@wiki @wiki-{slug}`:

1. Generate run ID from timestamp: `YYYY-MM-DDTHH-MM`
2. Create folder: `runs/{run-id}/`
3. Create `steps/` and `snapshots/` subdirectories
4. Copy current `PROMPT.md` → `runs/{run-id}/PROMPT.md`
5. Copy current `WORKFLOW.md` → `runs/{run-id}/WORKFLOW.md`
6. Copy current `index.json` → `runs/{run-id}/index-before.json`
7. The ticketing system has already placed `ticket.md` in the folder
8. Initialize `ticket.md` with TODO checklist:

```markdown
# {TICKET-ID}: {title}

**Trigger:** {type} — {details}
**Tags:** @wiki @wiki-{slug}
**Status:** 🔄 in progress
**Parent:** {parent ticket ID or —}
**Children:** (none yet)

---

## TODO

- [ ] Gather context for {topic} → [01-gather.md](steps/01-gather.md)
- [ ] Propose changes → [02-propose.md](steps/02-propose.md)
- [ ] Check edges → [03-edges.md](steps/03-edges.md)
- [ ] Execute edit → [04-execute.md](steps/04-execute.md)
- [ ] Converge → [NN-converge.md](steps/NN-converge.md)

---

## Summary

(written at convergence)
```

9. Initialize `manifest.json`:
```json
{
  "id": "{run-id}",
  "ticket": "{TICKET-ID}",
  "trigger": { "type": "{type}", "ref": "{details}" },
  "topics_touched": [],
  "edges_followed": [],
  "children": [],
  "depth": 0,
  "converged": false
}
```

---

## Step 1: Gather Context

Read what you need for the triggered topic. Document everything in `steps/01-gather.md`.

**In 01-gather.md, record:**
- What files you read and why
- The current state of the topic's PAGE.md (key sections, not full copy — that's in snapshots/)
- The topic's LOG.md (recent entries)
- The trigger source (commit diff, ticket description, conversation excerpt)
- Any other source material consulted (code files, other PAGE.md files, git history)

**Checklist:**
- [ ] Read the topic's PAGE.md
- [ ] Copy PAGE.md to `snapshots/{topic}-before.md`
- [ ] Read the topic's LOG.md for recent changes
- [ ] Identify and read the trigger source
- [ ] Read any code files referenced by the page
- [ ] If the trigger is ambiguous or unverifiable, STOP — mark step as blocked, update ticket status

**Update ticket.md:** Check off the gather step, link to 01-gather.md.

---

## Step 2: Propose Changes

Do not edit PAGE.md yet. Document your proposal in `steps/02-propose.md`.

**In 02-propose.md, record:**
```markdown
# Proposed Changes

**Topic:** {topic}
**Trigger:** {source}

## What's stale or wrong
{describe what doesn't match reality}

## Proposed edit
{describe what you plan to change — section by section if needed}

## Confidence
{high — verified in code | medium — inferred from context | low — speculative}

## Evidence
{cite the specific files, lines, commits that support this change}
```

**If confidence is low:** Mark the TODO as blocked on ticket.md. Do not proceed to execute. The proposal stays in 02-propose.md for human review.

**Update ticket.md:** Check off the propose step.

---

## Step 3: Check Edges

Consult `index-before.json` for this topic's edges. Document in `steps/03-edges.md`.

**In 03-edges.md, record:**
```markdown
# Edge Check

**Topic:** {topic}
**Proposed change:** {one-line summary from Step 2}

## Incoming edges (pages that link TO this topic)
| Source | Line | Link text | Affected? | Reason |
|--------|------|-----------|-----------|--------|
| home/PAGE.md | 8 | [Secrets](Secrets) | No | Navigation link, content unchanged |
| gitlab/PAGE.md | 12 | [Secrets](Secrets) | Yes | References token expiry date |

## Outgoing edges (pages this topic links TO)
| Target | Link text | Affected? | Reason |
|--------|-----------|-----------|--------|
| [GitLab](GitLab) | auth details | No | Not changing auth section |

## Stale edges → child tickets
- gitlab: references token expiry → needs update
```

**For each stale edge:**
1. Create a child ticket: `@wiki @wiki-{target-slug} — edge: {reason} (parent: {TICKET-ID})`
2. Add child to ticket.md's Children field
3. Add child to manifest.json's `children` array

**Update ticket.md:** Check off the edges step. Add child ticket IDs.

---

## Step 4: Execute Edit

Now edit the topic's PAGE.md. Document in `steps/04-execute.md`.

**In 04-execute.md, record:**
```markdown
# Execution

**Topic:** {topic}
**Confidence:** {from Step 2}

## Changes made
{describe each change — what section, what was modified, why}

## Diff summary
{key additions/removals — not a full diff, but enough to understand the change}
```

**After editing PAGE.md:**

1. Copy edited PAGE.md to `snapshots/{topic}-after.md`

2. Append to the topic's `LOG.md`:
   ```markdown
   ## {YYYY-MM-DD HH:MM} — {title}
   Source: {commit hash | ticket ID | conversation | edge from {topic}}
   Changed: {what was modified}
   Why: {reason}
   Edges affected: {list of child tickets spawned}
   Run: {run-id}
   Ticket: {TICKET-ID}
   By: wiki agent
   ```

3. Update `manifest.json`: add topic to `topics_touched`

4. **Update ticket.md:** Check off the execute step.

---

## Step 5: Follow Edges

Child tickets created in Step 3 are processed by the same workflow. Each child ticket gets its own run folder (created by the ticketing system).

For each child, the agent:
1. Picks up the child ticket
2. Creates a new run (Step 0)
3. Follows Steps 1-4 for that topic
4. Checks edges (Step 3) — may spawn grandchild tickets
5. Converges when that sub-loop is done

Document edge processing in `steps/05-edge-{topic}.md`:
```markdown
# Edge: {topic}

**Parent ticket:** {TICKET-ID}
**Child ticket:** {CHILD-TICKET-ID}
**Child run:** {child-run-id}
**Reason:** {why this edge was stale}

## Result
{Edited | No change needed | Blocked — reason}
```

**Circuit breaker:** If a topic already appears in any ancestor run's `topics_touched`, STOP that branch. Log the cycle:
```markdown
## Cycle detected
Topic "{topic}" already touched in parent run {run-id}.
Circular dependency — flagged for human review.
```

Update manifest.json with cycle info. Do not block the rest of the run.

**Update ticket.md:** Check off each edge step. Link to the step file.

---

## Step 6: Converge

When all TODOs are complete and all child tickets are closed, the run is done.

Document in `steps/NN-converge.md` (NN = next step number):
```markdown
# Convergence

**Run:** {run-id}
**Depth:** {max edge propagation depth}
**Topics touched:** {list}
**Child tickets:** {list with status}
**Cycles:** {list or "none"}

## Index changes
{what edges were added, removed, or modified}

## Final state
All affected pages updated. No remaining stale edges.
```

**Final steps:**

1. Rebuild `index.json`:
   - Scan every `{topic}/PAGE.md` for markdown links
   - Build `edges_out` and `edges_in` for each topic
   - Write updated index

2. Finalize `manifest.json`:
   ```json
   {
     "id": "{run-id}",
     "ticket": "{TICKET-ID}",
     "trigger": { ... },
     "topics_touched": ["secrets", "gitlab"],
     "edges_followed": [...],
     "children": [...],
     "depth": 2,
     "converged": true,
     "cycles": [],
     "duration_ms": 4200
   }
   ```

3. Update ticket.md:
   - Check off converge step
   - Set status to `✅ converged`
   - Write the Summary section

4. Update `ai/STATE.md`:
   ```markdown
   ## {YYYY-MM-DD HH:MM} — wiki
   Run {run-id} (ticket {TICKET-ID}): {summary}
   Source: {original trigger}
   Pages touched: {list}
   Edge propagation depth: {N}
   Loose threads: {anything unresolved or cycled}
   ```

5. Close the ticket.

---

## Quality Gates

- **Never edit PAGE.md based on speculation.** Low confidence = blocked, not executed.
- **Never remove content unless the source confirms removal.** Grep to verify.
- **Never skip edge checking.** Always consult index.json, even for "small" edits.
- **Never visit a topic already touched by an ancestor run.** That's a cycle.
- **Always snapshot before/after.** Every edit gets snapshots in the run folder.
- **Always log.** Every edit gets a LOG.md entry. No exceptions.
- **Always document steps.** Every step gets a file in steps/. No silent work.
- **Always rebuild index.json.** After every run.
- **Always update STATE.md.** Other panels need to know.
- **Always freeze PROMPT.md and WORKFLOW.md.** In the run folder at run start.

---

## Auto-Compaction

- Runs older than 30 days: keep manifest.json, ticket.md, and step files. Remove snapshots/.
- Runs older than 90 days: keep manifest.json and ticket.md only. Steps can be removed — LOG.md per topic has the permanent audit trail.
- Never delete manifest.json or ticket.md. They're the permanent record.

---

## Trigger Handling

| Trigger | What to do |
|---------|-----------|
| Code commit | Ticketing system creates ticket with diff context. Tags `@wiki @wiki-{slug}` based on which topics reference changed files. |
| Ticket (manual) | Human creates ticket tagged `@wiki`. Agent picks it up. |
| Edge propagation | Parent run's Step 3 creates child ticket. Ticketing system creates run folder. |
| Schedule (freshness) | Cron creates a ticket per topic for spot-checking. Agent gathers and proposes — may converge immediately if nothing stale. |
