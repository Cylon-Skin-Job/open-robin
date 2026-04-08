---
title: Master System Spec — Open Robin
created: 2026-03-27
updated: 2026-03-28
status: master
supersedes: DECLARATIVE_WORKSPACE_SYSTEM_SPEC, scope-and-chat-architecture, MASTER_ROADMAP
sub-specs:
  - VIEW-ROBIN.md
  - VIEW-CAPTURE.md
  - VIEW-FILE-EXPLORER.md
  - VIEW-WIKI.md
  - VIEW-TICKETING.md
  - VIEW-AGENTS.md
  - VIEW-CHAT.md
  - SPEC-COLLABORATION.md
  - SPEC-EVENT-SYSTEM.md
  - SPEC-SKILLS.md
  - CLIs.md
  - VIEW-TABLE.md
  - ROADMAP.md
---

# Open Robin — Master System Spec

The definitive reference. Sub-specs cover individual views and domains.

---

## 1. What Robin Is

Robin is the app. Everything else is stuff Robin manages.

She is the system-level AI, the external messaging gateway (Signal, Telegram), and the admin layer. Her icon lives in the upper right of the header. Clicking it leaves project context and enters Robin's space — a full-width overlay with her own persistent chat and system tabs.

See **VIEW-ROBIN.md** for full details.

---

## 2. Core Principle

**The app is dumb plumbing. Intelligence lives in agents and scripts.**

The app discovers files, parses configs, renders views. It does not validate, resolve conflicts, or enforce business logic. If something needs intelligence, an agent handles it. The app provides hooks and visuals — nothing more.

No plugin architecture. No content-type registry. No runtime-loaded submodules. The views that ship are the views. If the user wants something different, they build it. AI generates code on the fly; extension points are pre-AI thinking.

---

## 3. The Hierarchy

```
Robin (system layer — above everything)
  │
  ├── Project: kimi-claude (IDE/app development)
  │     ├── Code         → file-explorer
  │     ├── Wiki         → wiki
  │     ├── Issues       → ticket-board
  │     ├── Capture      → tile-grid
  │     └── Agents       → agent-cards
  │
  ├── Project: home-office (bookkeeping/life management)
  │     ├── Dashboard    → custom view
  │     ├── Invoices     → tile-grid (reused) + invoices.db
  │     ├── Customers    → table + customers.db
  │     ├── Expenses     → table + expenses.db
  │     ├── Wiki         → wiki (tax rules, vendor notes)
  │     ├── Issues       → ticket-board / calendar
  │     ├── Agents       → invoice-generator, expense-logger, tax-prep
  │     ├── Files        → file-explorer (receipts, PDFs, symlinks)
  │     └── Email        → symlinked view
  │
  └── System (Robin's domain)
        ├── robin.db (system config, Robin's chat, profiles)
        ├── Templates (project scaffolds)
        └── System-level TRIGGERS.md
```

Every project is the same architecture — different content. A code IDE and a bookkeeping app are both just folders in `ai/views/` with workspaces, agents, triggers, and scripts. The views that ship with the app get reused across domains.

### Project Switching

Upper-left menu hot-swaps between projects. The sidebar rebuilds with the new project's workspaces. Background bots and crons are **project-scoped but run independently** — switching projects does not kill bots in the project you left.

### Table Panel — Apps as Views

Any workspace can have its own `.db` file right in the folder. The table panel view renders SQLite data as a scrollable, sortable, filterable table GUI. Scripts in the workspace's `scripts/` folder provide the business logic. `tools.json` lists them as callable skills for agents.

```
ai/views/customers/
  index.json          ← { type: "table", icon: "people" }
  customers.db        ← the data, right here
  PROMPT.md           ← agent identity for this panel's chat
  SESSION.md          ← permissions
  tools.json          ← scripts → callable tools
  scripts/
    import-contacts.js
    merge-duplicates.js
  chat/
    threads/...
```

This means any user can build any SaaS-equivalent locally: bookkeeping, CRM, inventory, project management. Robin helps scaffold it, agents automate it, triggers connect it to email/calendar/bank notifications. No monthly fees, no cloud dependency, data stays on your machine.

### Per-View Databases

Each workspace owns its data. No single monolithic project.db.

```
ai/system/robin.db           ← Robin's. System config. Invisible to agents.
ai/system/project.db         ← Thread metadata, exchanges. Invisible to agents.
ai/views/invoices/invoices.db    ← Workspace data. Accessible via scripts.
ai/views/customers/customers.db  ← Workspace data. Accessible via scripts.
ai/views/expenses/expenses.db    ← Workspace data. Accessible via scripts.
```

### Project Templates

Robin scaffolds entire projects from templates:
- "Blank" — empty ai/views/ with code, wiki, issues, agents
- "Home Office" — bookkeeping, invoices, expenses, customers, trips
- "Research" — capture, wiki, agents, files
- User-created templates from existing projects

---

## 4. Two Layers: System and Repo

### System Layer (not in repo)

```
ai/system/
  robin.db           ← System config, system wiki, Robin's chat, profiles
  project.db         ← Thread metadata, exchanges, ticket index
```

Invisible to agents. Managed by Robin. In `.gitignore`.

### Repo Layer (portable, shareable)

Everything in the repo is collaboration-ready:
```
ai/views/{workspace}/
  *.db               ← workspace app data (if table panel)
  scripts/           ← business logic
  tools.json         ← skill manifest
  chat/threads/
    {username}/      ← your thread markdown
    {collaborator}/  ← their thread markdown
  wiki/
  agents/
```

The DB renders the live chat. Markdown is the **human-readable receipt** — lives in the repo under the user's name. Push the repo, collaborators pull, and their thread markdown appears in their user folder. No merge conflicts.

Per-view .db files are in the repo by default (they ARE the app data). Users can .gitignore them if the data is private.

The repo becomes a knowledge artifact AND an application. Not just code — the conversations, the data, and the automations that power the app all travel together.

See **SPEC-COLLABORATION.md** for full details.

---

## 5. Session Management

### Per-Workspace Warm Pool

Each workspace keeps a warm pool of recent sessions (default 5, user-adjustable 3-7). These sessions retain DOM cache, scroll position, and agent state for instant resume when you switch back.

### Global Cap

Hard ceiling on total active sessions across all projects (default 20).

### Eviction Priority

1. **Never kill mid-turn** — if an agent is generating, it finishes
2. **Never kill background bots** — they're workspace-agnostic, always running
3. **Never kill cron-initiated turns** — the turn completes, then normal FIFO applies
4. Evict oldest idle sessions **outside** the per-workspace warm pool first
5. Under RAM pressure, shrink warm pools toward 3 even if user set it higher

### RAM-Aware Management

Robin tracks `process.memoryUsage()` per spawned CLI process. The dashboard shows:

```
Sessions: 14 active (3.2 GB)
├── kimi-claude:  3 warm (820 MB)
├── fusion-vault: 2 warm (540 MB)
├── background:   9 bots  (1.8 GB)
│
Per-workspace pool: 5 (adjustable)
Global cap: 20
RAM ceiling: 8 GB
```

### Resource Policy (virtual markdown over DB)

Policies live in SQLite but render as editable markdown in Robin's panel. The file never exists on disk — it's a virtual document. Edit the markdown, it writes back to the DB.

```markdown
# Session Policy

## Global
ram-ceiling: 8GB
global-cap: 20
mid-turn: protected
background-bots: protected

## Per-Workspace Defaults
warm-pool: 5
idle-timeout: 9min

## Overrides
### kimi-claude
warm-pool: 7
exempt-from-flush: true

## Conditionals
when ram-pressure > 80%:
  reduce-all-pools: 3
  notify: robin

when workspace-idle > 2h:
  flush-except: last-1
```

Robin helps you write these. The syntax is flexible and forgiving — Robin parses what she can, flags what she doesn't understand.

---

## 6. Crons on Any Chat

Any conversation can have a cron attached that auto-sends a message on a schedule. The chat is the interface, the cron is the heartbeat.

- Daily "check wiki freshness" sent to a wiki agent chat
- Weekly "summarize open tickets" sent to Robin
- Hourly "check deployment status" sent to a monitoring agent

Crons interact with the ticketing system and blocking tickets. Details in **VIEW-TICKETING.md**.

---

## 7. Views That Ship

| View | Workspace | Spec |
|------|-----------|------|
| Robin's System Panel | System (above projects) | VIEW-ROBIN.md |
| Tile Grid | Capture, Invoices, etc. | VIEW-CAPTURE.md |
| File Explorer | Code, Files | VIEW-FILE-EXPLORER.md |
| Wiki | Wiki | VIEW-WIKI.md |
| Ticket Board / Calendar | Issues | VIEW-TICKETING.md |
| Agent Cards | Agents/Bots | VIEW-AGENTS.md |
| Table | Any data workspace | VIEW-TABLE.md |
| Chat | Any (attached to workspaces) | VIEW-CHAT.md |

No content-type registry. No plugin system. These are the views. Views get reused across projects and domains — the tile grid that renders capture docs also renders invoices. The table view renders any SQLite database. If you want something truly custom, build it — AI generates code.

---

## 8. Agents

### Definition by Folder Contents

```
ai/agent-viewer/{folder}/{agentName}/
  PROMPT.md          ← personality, role, scope (was PROMPT.md)
  SESSION.md          ← harness config + CLI profile + tool permissions (absorbs TOOLS.md)
  MEMORY.md           ← persistent memory (grows through conversation)
  TRIGGERS.md         ← event-driven activation rules
  HISTORY.md          ← activity log
  workflows/
    {Workflow Name}/
      WORKFLOW.md     ← orchestrator instructions
      TRIGGERS.md     ← workflow-specific triggers
      LESSONS.md      ← workflow-scoped learnings (append-only)
  runs/               ← execution history (frozen snapshots)
  threads/            ← conversation threads
```

No type enum. The combination of files defines behavior. LESSONS.md is workflow-scoped, not agent-root. Run agents don't need MEMORY.md.

Robin is the system agent. She sees everything, dispatches via tickets, never touches files directly. Per-workspace agents handle project-level work.

See **VIEW-AGENTS.md** for full details.

---

## 9. Render Pipeline

### Orb (gatekeeper)
- 500ms delay -> 1500ms expand -> hold until first token -> 500ms disposal
- Dynamic, never leaves a gap, never appears twice

### Tool Segments
- LiveToolSegment -> skipShimmer (first) or shimmer (200ms)
- ToolCallBlock (header + icon) -> reveal -> typing cursor -> collapse

### Text Segments
- LiveTextSegment -> parseTextChunks() dispatcher
- Sub-renderers: paragraph, header, code-fence, list
- Chunk buffer + speed attenuator -> typing cursor

### Transforms (single source of truth)
```
src/lib/transforms/
  ├── markdown.ts     ← ONE configured marked instance
  └── code.ts         ← ONE escapeHtml, codeBlockHtml, preWrapHtml
```

---

## 10. CSS Cascade

```
ai/system/          ← defaults (ships with app)
  ↓
ai/views/            ← workspace-level overrides
  ↓
ai/views/**-viewer/  ← viewer-level overrides (specific component)
```

Same variable names at every level. Last definition wins. All settings live in a `settings/` folder at root.

### Core Variables
```css
--chrome-bg, --chrome-border, --chrome-text
--ws-bg, --ws-border, --ws-surface
--color-primary, --color-primary-rgb, --color-secondary, --color-accent
--text-primary, --text-secondary, --text-dim, --text-muted
--bg-card, --bg-card-hover, --bg-input, --bg-selected
--border-card, --border-input, --border-active, --border-glow
--card-radius, --card-padding, --card-shadow
--sidebar-width, --chat-width, --panel-gap
```

---

## 11. Triggers

`TRIGGERS.md` files can live anywhere in `ai/views/` or `/system/`. The app walks the tree, finds them all, aggregates them. Best practice: put them next to what they govern.

Robin's Triggers tab is a dashboard — read-only view of what was discovered. Each entry traces back to its source file. No validation engine baked in. If you need a trigger auditor, a background agent handles it.

---

## 12. Design Principles

1. **Surface, don't enforce.** The app discovers and renders. Intelligence lives in agents.
2. **Ticket-mediated action.** Robin never modifies project files directly.
3. **Dumb plumbing.** Walk the tree, parse, render, done.
4. **Layer as little code as possible.** If it needs intelligence, it's an agent's job.
5. **System is firmware, not a workspace.** Like `chrome://settings` vs a tab.
6. **No plugin architecture.** AI generates code. Extension points are obsolete.
7. **DB is truth, markdown is the window.** System state in SQLite, rendered as editable markdown.
8. **Repo is the collaboration surface.** Everything portable lives in the repo.

---

## 13. What's Built vs Planned

### Built (working today)
- [x] Dynamic orb with token-aware disposal
- [x] Shimmer skip for first segment
- [x] Typing cursor in tool + text segments
- [x] Text sub-renderer dispatch
- [x] Unified transforms
- [x] Image serving + thumbnails in capture
- [x] Single server on port 3001
- [x] Bot detail view (card layout, pill tabs)
- [x] Workflow folders
- [x] Timing instrumentation

### Planned (specced)
- [ ] Robin system panel + chat
- [ ] Multi-project switching
- [ ] Session FIFO with per-workspace warm pools
- [ ] RAM-aware resource management
- [ ] Crons on any chat
- [ ] Virtual-markdown-over-DB for system config
- [ ] Collaboration model (per-user thread folders)
- [ ] SQLite for chat structural data + system wiki
- [ ] Signal/Telegram gateway
- [ ] Ticket-mediated agent dispatch

### Known Bugs
- [ ] Wiki, Agents, Issues, Skills workspaces stuck on "Loading"
- [ ] User chat bubble renders twice on refresh
- [ ] Line-break parser stall on thinking content
