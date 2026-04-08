---
title: Agent Self-Improvement — Memory, Lessons, Decisions & the Capture Gate
created: 2026-03-29
status: draft
---

# Agent Self-Improvement

Agents improve over time through self-editable knowledge files (MEMORY.md, LESSONS.md, DECISIONS.md) while identity and permissions remain locked behind a human approval gate.

## Design Principles

- **Agents get smarter, not different** — An agent can learn lessons and record decisions, but cannot change who it is (PROMPT.md) or what it's allowed to do (SESSION.md) without human approval.
- **The capture gate is the approval mechanism** — Suggested changes to locked files land in capture tiles where the user reviews and manually moves them. Cut-and-paste is the approval flow. No new UI needed.
- **Archive is the version history** — Every edit clones the prior version to `archive/{type}/{{date}}.md`. No database, just dated markdown. Diffable, readable, rollback-friendly.
- **Low-tech by design** — No approval queues, no voting systems, no complex workflows. Just files, folders, and the file explorer that already exists.

## Agent Folder Structure

```
ai/views/agents-viewer/System/{agent-name}/
├── PROMPT.md              ← identity — LOCKED
├── SESSION.md             ← config/permissions — LOCKED
├── MEMORY.md              ← user intent, shaping (rolling cache)
├── LESSONS.md             ← gotchas, solved problems (append-mostly)
├── DECISIONS.md           ← behavioral decisions with dates
├── TRIGGERS.md            ← event triggers
└── archive/
    ├── prompt/
    │   └── {{date}}.md
    ├── session/
    │   └── {{date}}.md
    ├── memory/
    │   └── {{date}}.md
    ├── lessons/
    │   └── {{date}}.md
    └── decisions/
        └── {{date}}.md
```

## File Definitions

### MEMORY.md — Rolling Cache

User's intent and shaping for this agent. Overwritten as understanding evolves.

Example:
```markdown
# Memory

- User wants terse responses, no summaries
- Focus on server-side files, ignore client unless asked
- Prefers single bundled PRs for refactors
- Last updated: 2026-03-29
```

The agent updates this as it learns user preferences during conversations. Low stakes — it's a cache, not a contract.

### LESSONS.md — Discovered Truths

Problems solved, gotchas discovered, things that work. Append-mostly.

Example:
```markdown
# Lessons

## 2026-03-29 — Filter-loader nesting depth
The filter-loader's original regex parser silently dropped YAML nested deeper than 2 levels. Switched to stack-based parser in Phase 0.

## 2026-03-28 — Wiki symlink behavior
`ai/wiki-data/screenshots/` is a symlink to `~/Desktop/Screenshots`. The watcher follows it but fs.watch doesn't — use polling for symlinked folders.
```

Each entry is dated. The agent appends as it discovers. User can prune or reorganize.

### DECISIONS.md — The Why Layer

Architectural and behavioral decisions with reasoning. Dated. When reversed, old decision moves to archive, new one takes its place.

Example:
```markdown
# Decisions

## 2026-03-29 — Stack-based YAML parsing
**Decision:** Use stack-based nesting in frontmatter parser instead of regex.
**Why:** SESSION.md now has 3-level nesting (tools.restricted.write_file). Regex couldn't handle it.
**Reversible:** Yes, but would need to flatten SESSION.md schema.

## 2026-03-29 — Tool permissions advisory until Phase 3
**Decision:** Parse tool permissions in SESSION.md but don't enforce server-side yet.
**Why:** Agents are internally controlled. Enforcement adds complexity we don't need until external agents exist.
**Reversible:** Yes, enforcement is additive.
```

## Edit Permissions

| File | Agent Can Edit | Gate |
|------|---------------|------|
| PROMPT.md | No | Capture gate (human paste) |
| SESSION.md | No | Capture gate (human paste) |
| TRIGGERS.md | No | Capture gate |
| MEMORY.md | Yes | Direct edit |
| LESSONS.md | Yes | Direct append |
| DECISIONS.md | Yes | Direct edit |
| WORKFLOW.md (in workflows/) | Yes | Direct edit |

### File Name = Permission

The file name determines editability, not the path:

- **PROMPT.md** — always locked. Agent identity.
- **SESSION.md** — always locked. Permissions and receipts.
- **TRIGGERS.md** — always locked. Event triggers.
- **WORKFLOW.md** — always agent-editable. Operational task instructions in `workflows/*/`. The agent can refine how it does a specific task without going through the capture gate.
- **MEMORY.md** — always agent-editable. Rolling cache.
- **LESSONS.md** — always agent-editable. Discovered truths.
- **DECISIONS.md** — always agent-editable. The why layer.

This eliminates path-based permission rules. The file name *is* the permission. No ambiguity.

## The Capture Gate

### Flow

1. Agent determines PROMPT.md (or SESSION.md) needs updating
2. Agent writes suggested replacement to `ai/views/capture-viewer/captures/suggested-prompt-{agent-name}.md`
3. User sees thumbnail in capture tiles
4. User reads, evaluates
5. If approved: right-click → Cut → navigate to agent folder → Paste
6. System archives old file: `cp PROMPT.md archive/prompt/{{date}}.md`
7. New file takes its place

### Right-Click Context Menu Rules

Capture files get special treatment — they're the only files with a file-move option, and it's **cut only** (no copy). This prevents accidental duplication and makes capture the explicit outbox.

```
Right-click any file (non-capture):
  → Open, Rename, Delete

Right-click a file in capture/:
  → Open, Rename, Delete
  → Cut                        ← only here, only cut (not copy)

Right-click in a destination folder (e.g., agent settings):
  → Paste                      ← only if clipboard has a cut file
```

- **No copy** — the file leaves capture when placed. It doesn't exist in two places.
- **Cut only in capture** — other folders don't expose file-move operations.
- **Paste only with clipboard** — the paste option only appears when there's a pending cut.

### Why This Works

- **No new UI** — uses the file explorer and capture tiles that already exist
- **Human in the loop** — the agent can't promote its own changes
- **Auditable** — every change is archived with date
- **Reversible** — copy from archive to restore any prior version
- **Low friction** — it's just cut and paste, not a review board
- **No duplication** — cut-only means the suggestion is consumed, not cloned

### Background Context Suggestion Worker

After a chat message ends, a background worker can fire and produce context suggestions. These appear in the active view as a helper panel with:
- A block of suggested text
- File paths referenced
- A copy button

This worker reads the agent's MEMORY.md and LESSONS.md to inform its suggestions. If it identifies a pattern worth capturing, it writes to LESSONS.md directly (allowed) or suggests a PROMPT.md update through the capture gate (locked).

## Archive Mechanics

### On Edit

Before any write to a tracked file:
1. Check if `archive/{type}/` exists, create if not
2. Copy current file to `archive/{type}/{{date}}.md`
3. If same-day archive exists, append a counter: `{{date}}-2.md`
4. Write new content to the live file

### Implementation

Server-side hook in the file write handler:

```javascript
async function archiveBeforeWrite(agentPath, filename) {
  const type = filename.replace('.md', '').toLowerCase(); // 'prompt', 'session', etc.
  const archiveDir = path.join(agentPath, 'archive', type);
  await fs.mkdir(archiveDir, { recursive: true });

  const date = new Date().toISOString().split('T')[0]; // '2026-03-29'
  let archiveName = `${date}.md`;

  // Handle multiple edits per day
  let counter = 1;
  while (await fileExists(path.join(archiveDir, archiveName))) {
    counter++;
    archiveName = `${date}-${counter}.md`;
  }

  await fs.copyFile(
    path.join(agentPath, filename),
    path.join(archiveDir, archiveName)
  );
}
```

### Reading History

An agent can read its own archive to understand its evolution:
- `archive/lessons/` shows how its knowledge grew
- `archive/decisions/` shows what changed and why
- `archive/prompt/` shows how its identity was shaped over time

This enables genuine self-reflection: "I used to handle X this way, but after lesson Y, the user changed my prompt to do Z instead."

## Verification

- [ ] MEMORY.md, LESSONS.md, DECISIONS.md created for all 3 system agents
- [ ] Agent can write to MEMORY.md, LESSONS.md, DECISIONS.md
- [ ] Agent cannot write to PROMPT.md or SESSION.md directly
- [ ] Suggested PROMPT.md changes appear in capture tiles
- [ ] Cut-paste from capture to agent folder triggers archive
- [ ] Archive creates dated snapshots in correct subfolder
- [ ] Multiple same-day edits get counter suffix
- [ ] Agent can read its own archive files
