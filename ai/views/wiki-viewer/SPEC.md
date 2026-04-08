# Wiki Panel Spec

> The wiki is the nervous system. It connects brain to hands.

---

## What This Is

A panel where wiki pages live as browsable markdown folders. One agent maintains all topics. Work arrives as tickets from the issues panel. Each ticket becomes a **run** — a folder containing a complete, auditable trace of every step the agent took. The agent traverses the topic graph on demand, follows edges recursively, spawns child tickets for stale edges, and converges when nothing is stale.

Each run folder freezes the PROMPT.md and WORKFLOW.md that were active at run time, enabling DSPy-style process auditing — you can crawl past runs, compare how the process was followed, find flaws, and improve.

Wiki pages sync to GitLab for a browser-readable UI, but the local folders are the source of truth.

This panel follows the universal panel agent model defined in `ai/views/capture-viewer/specs/PANEL-AGENT-SPEC.md`.

---

## Folder Structure

```
ai/views/wiki-viewer/
├── PROMPT.md                ← agent identity (see ai/views/capture-viewer/specs/PANEL-AGENT-SPEC.md)
├── TOOLS.md                 ← agent capabilities
├── WORKFLOW.md              ← agent process rules (injected on every write)
├── SPEC.md                  ← this file
├── panel.json               ← panel metadata
├── index.json               ← topic graph (edges between pages, rebuilt each run)
├── .wiki-repo/              ← git clone of <project>.wiki.git (gitignored)
│
├── runs/                    ← edit round history (one folder per ticket)
│   ├── 2026-03-20T15-30/
│   │   ├── ticket.md        ← plain markdown copy of issue (summary + TODO + step links)
│   │   ├── PROMPT.md        ← frozen agent identity at run time
│   │   ├── WORKFLOW.md      ← frozen process rules at run time
│   │   ├── manifest.json    ← machine-readable metadata
│   │   ├── index-before.json ← graph state at run start
│   │   ├── steps/
│   │   │   ├── 01-gather.md
│   │   │   ├── 02-propose.md
│   │   │   ├── 03-edges.md
│   │   │   ├── 04-execute.md
│   │   │   ├── 05-edge-gitlab.md
│   │   │   └── 06-converge.md
│   │   └── snapshots/
│   │       ├── secrets-before.md
│   │       └── secrets-after.md
│   └── ...
│
├── home/
│   ├── PAGE.md              ← published wiki page (syncs to GitLab as "Home")
│   └── LOG.md               ← change trail
│
├── secrets/
│   ├── PAGE.md              ← syncs to GitLab as "Secrets"
│   ├── LOG.md
│   └── .slug                ← (optional) custom GitLab slug override
│
├── gitlab/
│   ├── PAGE.md              ← syncs to GitLab as "GitLab"
│   ├── LOG.md
│   └── .slug                ← "GitLab" (override for casing)
│
└── {topic-name}/
    ├── PAGE.md
    └── LOG.md
```

---

## The Two Files Per Topic

Every topic folder contains exactly two files.

### PAGE.md — The Published Page

The wiki content that syncs to GitLab. This is what other agents, tools, and humans read when they "check the wiki."

- **Single source of truth** for this topic
- Written in standard markdown
- First `# heading` becomes the page title in GitLab sidebar
- Syncs to GitLab via `scripts/sync-wiki.sh`

**Who writes it:** The wiki agent, Claude (any instance), humans.
**Who reads it:** Everyone. Other agents, other panels, skills, humans.

### LOG.md — The Change Trail

Append-only log of changes to PAGE.md. Captures **why** something changed, not just what.

**Format:**
```markdown
# Change Log

## 2026-03-20 14:30 — Initial creation
Source: conversation
Changed: Created from scratch during secrets manager implementation
Run: 2026-03-20T14-30
By: Claude (IDE)

## 2026-03-21 09:00 — Token rotation update
Source: commit abc123
Changed: Updated token expiry from 2026-03-22 to 2026-06-20
Edges affected: gitlab
Run: 2026-03-21T09-00
By: wiki agent
```

**Entry fields:**
- **Date + title** — when and what (one line)
- **Source** — conversation, commit hash, ticket ID, manual edit
- **Changed** — what was modified in PAGE.md
- **Edges affected** — which topics were checked or updated as a result
- **Run** — the run ID that made this change
- **By** — who made the change

**Who writes it:** Wiki agent (automated), Claude (manual), humans.
**Who reads it:** Anyone auditing the wiki's evolution.

---

## index.json — The Topic Graph

A lightweight map of all topics and their edges. The agent reads this at session start instead of loading all PAGE.md files.

```json
{
  "version": "1.0",
  "last_updated": "2026-03-20T15:00:00",
  "topics": {
    "secrets": {
      "slug": "Secrets",
      "edges_out": ["GitLab"],
      "edges_in": ["Home", "GitLab", "Wiki-System"]
    }
  }
}
```

**Rebuilt after every run** by scanning all PAGE.md files for markdown links (`[text](Slug)`).

The index tells the agent "these topics exist and here's how they connect." Actual page content is read only when the loop reaches that node.

---

## runs/ — Edit Round History

Each ticket tagged `@wiki` gets a run folder. The ticketing system creates the folder and drops `ticket.md` inside. The agent populates everything else.

```
runs/2026-03-20T15-30/
├── ticket.md              ← plain markdown: summary, TODO checklist, step links
├── PROMPT.md              ← frozen copy of agent identity at run time
├── WORKFLOW.md            ← frozen copy of process rules at run time
├── manifest.json          ← machine-readable metadata
├── index-before.json      ← graph state at run start
├── steps/
│   ├── 01-gather.md       ← what was read, what was found
│   ├── 02-propose.md      ← proposed changes, confidence level
│   ├── 03-edges.md        ← edge check results, graph traversal
│   ├── 04-execute.md      ← what was edited, reasoning
│   ├── 05-edge-gitlab.md  ← sub-loop for each stale edge
│   └── 06-converge.md     ← final state, convergence proof
└── snapshots/
    ├── secrets-before.md  ← PAGE.md state before edit
    └── secrets-after.md   ← PAGE.md state after edit
```

### ticket.md — Progressive Disclosure Hub

The ticket is both the summary and the navigation layer. Reading ticket.md tells you what happened at a glance. Step links take you to full detail.

```markdown
# WIKI-12: Update secrets page

**Trigger:** commit abc123 — lib/secrets.js changed
**Tags:** @wiki @wiki-secrets
**Status:** ✅ converged
**Parent:** —
**Children:** WIKI-13 (@wiki-gitlab)

---

## TODO

- [x] Gather context for secrets → [01-gather.md](steps/01-gather.md)
- [x] Propose changes → [02-propose.md](steps/02-propose.md)
- [x] Check edges → [03-edges.md](steps/03-edges.md)
- [x] Execute edit → [04-execute.md](steps/04-execute.md)
- [x] Follow edge: gitlab → [05-edge-gitlab.md](steps/05-edge-gitlab.md)
- [x] Converge → [06-converge.md](steps/06-converge.md)

---

## Summary

Updated token expiry date in secrets/PAGE.md.
Edge propagation: gitlab/PAGE.md also updated (child WIKI-13).
Converged at depth 2, no cycles.
```

### Frozen Copies

PROMPT.md and WORKFLOW.md are copied into the run folder at run start. If the main copies evolve over time, past runs retain the exact version that was active. This enables:

- **Reproducibility:** You know exactly what the agent was told to do
- **Process auditing:** Compare how WORKFLOW.md was followed across runs
- **DSPy-style optimization:** Crawl runs, score step quality, find patterns, improve the process

### manifest.json

```json
{
  "id": "2026-03-20T15-30",
  "ticket": "WIKI-12",
  "trigger": { "type": "commit", "ref": "abc123", "file": "lib/secrets.js" },
  "topics_touched": ["secrets", "gitlab"],
  "edges_followed": [
    { "from": "secrets", "to": "gitlab", "reason": "token expiry referenced", "stale": true },
    { "from": "secrets", "to": "home", "reason": "navigation link", "stale": false }
  ],
  "children": [
    { "ticket": "WIKI-13", "run": "2026-03-20T15-32", "topic": "gitlab", "reason": "edge: token expiry" }
  ],
  "depth": 2,
  "converged": true,
  "cycles": [],
  "duration_ms": 4200
}
```

### Auto-Compaction

- Runs older than 30 days: keep manifest.json, ticket.md, step files. Remove snapshots/.
- Runs older than 90 days: keep manifest.json and ticket.md only. LOG.md per topic has the permanent audit trail.
- Never delete manifest.json or ticket.md.

---

## The Wiki Agent

One agent for the entire wiki panel. Not one per topic.

### Why One Agent

- Edge propagation crosses topic boundaries. One agent sees the whole graph.
- No orchestration overhead coordinating multiple agents.
- Each run is a clean, self-contained loop — no accumulated conversation state.

### Scope

```
Reads:   entire project (code, git history, other panel threads, other wikis)
Writes:  only within ai/views/wiki-viewer/ and ai/STATE.md
```

### Session Lifecycle

**At session start, the agent loads:**
1. PROMPT.md (identity)
2. ai/STATE.md (cross-panel breadcrumbs)
3. index.json (topic graph — lightweight)
4. Recent ticket.md files from runs/ (what happened lately)

**During a run:**
- Creates run folder with frozen PROMPT.md, WORKFLOW.md, index-before.json
- Documents every step in steps/ with full reasoning
- Reads PAGE.md files on demand as the loop traverses edges
- Never preloads all pages
- Snapshots before/after for every edit
- Spawns child tickets for stale edges

**After a run:**
- manifest.json finalized
- ticket.md updated with summary and all TODOs checked
- index.json rebuilt from current PAGE.md files
- LOG.md updated per topic touched
- STATE.md updated
- Ticket closed
- Session can stub fresh — next run starts clean

### What the Agent Does

1. **Ticket arrives** tagged `@wiki @wiki-{slug}`
2. **Creates a run** — folder, frozen copies, manifest
3. **Enters the loop** — gather, propose, check edges, execute
4. **Documents every step** — each step gets its own file
5. **Spawns child tickets** for stale edges
6. **Converges** — no more stale edges, all children closed
7. **Closes the run** — manifest, ticket summary, index, logs, state

### What the Agent Does NOT Do

- Modify code
- Commit or push
- Sync to GitLab (manual via sync script)
- Make architectural decisions
- Preload all pages
- Skip documenting steps

---

## GitLab Sync

### How It Works

`scripts/sync-wiki.sh` walks all topic folders, copies `PAGE.md` files into a staging area with the correct GitLab slug as filename, and pushes to the wiki repo.

```
wiki/secrets/PAGE.md     → Secrets.md  (on GitLab)
wiki/gitlab/PAGE.md      → GitLab.md   (on GitLab, via .slug override)
wiki/home/PAGE.md        → Home.md     (on GitLab)
wiki/wiki-system/PAGE.md → Wiki-System.md (on GitLab)
```

### Slug Resolution

1. If `{topic}/.slug` file exists → use its content as the slug
2. Otherwise → auto-titlecase the folder name (`secrets` → `Secrets`, `wiki-system` → `Wiki-System`)

Use `.slug` for cases where auto-titlecase is wrong (e.g., `gitlab` → `Gitlab` is wrong, `.slug` says `GitLab`).

### Running Sync

```bash
./scripts/sync-wiki.sh "describe changes"
```

Sync is manual. The wiki agent does not push to GitLab. This keeps the publish step explicit and reviewable.

### What Syncs

Only `PAGE.md` files. `LOG.md`, `.slug`, manifests, index.json, and agent files are local-only. GitLab sees clean wiki pages with no metadata.

---

## Creating a New Topic

1. Create the folder:
   ```bash
   mkdir -p ai/views/wiki-viewer/{topic-name}
   ```

2. Create the two files:
   ```bash
   touch ai/views/wiki-viewer/{topic-name}/PAGE.md
   echo "# Change Log" > ai/views/wiki-viewer/{topic-name}/LOG.md
   ```

3. (Optional) Add `.slug` if auto-titlecase is wrong:
   ```bash
   echo "CustomSlug" > ai/views/wiki-viewer/{topic-name}/.slug
   ```

4. Write the page content in `PAGE.md`

5. Run the wiki agent (or manually sync):
   ```bash
   ./scripts/sync-wiki.sh "Add {topic-name} wiki page"
   ```

The agent will pick up the new topic on its next run and add it to index.json.

---

## Cross-Panel Reading

The wiki agent routinely reads from other panels and project locations:

| Source | What it reads | Why |
|--------|--------------|-----|
| `ai/views/code-viewer/threads/` | Recent coding conversations | Capture decisions made during development |
| `kimi-ide-server/lib/` | Source code | Verify wiki accuracy against implementation |
| `git log` | Recent commits | Detect what changed since last wiki update |
| `ai/STATE.md` | Cross-panel activity | Know what other panels did recently |
| `docs/` | Specs and architecture docs | Cross-reference with wiki content |

This is read-only. The wiki agent writes only within its panel and to ai/STATE.md.

---

## Relationship to Progressive Disclosure

The wiki panel is **Layer 3** in the progressive disclosure model:

```
Layer 1: CLAUDE.md        → "a wiki exists at ai/views/wiki-viewer/"
Layer 2: Skills           → "check wiki/secrets for auth details"
Layer 3: Wiki (PAGE.md)   → full documentation, living truth
Layer 4: Upstream docs    → external references linked from PAGE.md
```

Skills point to wiki topics. Wiki topics contain the depth. The agent traverses on demand — loading only the pages the current run needs.

---

## Design Decisions

### Why one agent, not one per topic?

Edge propagation crosses topic boundaries. A per-topic agent editing "secrets" can't also update "gitlab" — that needs coordination. One agent sees the whole graph and handles propagation in a single loop.

### Why tickets drive runs?

Tickets give cross-panel visibility, priority ordering, and natural human intervention (leave a ticket open = block the edit). The wiki agent is a consumer of the issues panel, not its own task manager. Edge propagation spawns child tickets — the same system handles routing and lifecycle.

### Why freeze PROMPT.md and WORKFLOW.md in each run?

Process evolves. When you crawl past runs to audit quality, you need to know what the agent was told to do at that time, not what the current instructions say. Frozen copies enable DSPy-style optimization: score step quality across runs, find patterns where the process fails, improve WORKFLOW.md, and verify the improvement in future runs.

### Why document every step as a file?

Each step file is a discrete decision point you can inspect. "Did the gather step miss relevant source material?" "Did the edge check over-trigger?" You can't answer these from a manifest alone. Step files make the agent's reasoning transparent and auditable.

### Why ticket.md as progressive disclosure?

The ticket is the summary — read it and know what happened in 10 seconds. Step links take you to full detail. This matches the project's progressive disclosure model: orientation first, depth on demand.

### Why runs, not accumulated conversation?

Conversations accumulate context that becomes stale. A run is a clean loop — trigger, traverse, edit, converge, done. Next run starts fresh with just the index and recent tickets. No context window bloat.

### Why index.json, not preload all pages?

A project could have 30+ wiki topics. Loading all PAGE.md files into context wastes tokens on pages the agent won't touch. The index is ~20 tokens per topic. The agent reads full pages only when the loop reaches them.

### Why PAGE.md, not {TopicName}.md?

Every topic folder has the same filenames. You never guess which file is the published page. `PAGE.md` is always the page. The topic name is the folder.

### Why LOG.md per topic, not per run?

The audit trail belongs with the page it describes. When you open `secrets/`, you see the page and its complete change history side by side. Run manifests capture the agent's work; LOG.md captures the page's evolution.

### Why .wiki-repo instead of the folder being the clone?

The wiki panel has files that don't belong in the GitLab wiki (LOG.md, SPEC.md, index.json, runs/, agent files). The sync script assembles only PAGE.md files. The `.wiki-repo` is git plumbing; the panel folders are the user interface.

### Why manual sync, not auto-push?

Publishing should be deliberate. The agent writes locally. A human (or orchestrator) reviews and syncs. This prevents half-finished agent edits from appearing on GitLab.

---

## For New Projects

When the kimi-claude IDE opens a new project:

1. Create `ai/views/wiki-viewer/` in the project
2. Clone the project's `.wiki.git` repo into `.wiki-repo/`
3. Add PROMPT.md, TOOLS.md, WORKFLOW.md, panel.json (copy from template)
4. Create `home/PAGE.md` with project overview
5. Create initial `index.json` (empty topics object)
6. Create `runs/` directory
7. Each feature/domain that needs documentation gets a wiki topic

The secrets manager, GitLab auth, and credential helpers are shared infrastructure — they work for any project's wiki, not just kimi-claude's.
