---
title: Spec — Open Robin System Panel + System Wiki
created: 2026-03-29
status: draft
parent: MASTER_SYSTEM_SPEC.md
---

# Open Robin System Panel

Robin is the system supervisor. She sits above workspaces. The system panel is a full-screen overlay accessed via the raven icon in the app header. It has Robin's chat on the left and a tabbed settings/wiki interface on the right.

---

## Panel Structure

```
┌─ Header: [raven] Open Robin — System Panel ────────── [X] ─┐
├─────────────┬──────────────────────────────────────────────┤
│             │  Tab Header: icon + title + description      │
│             │  FAQ links (bulleted, right column)          │
│             ├──────────────────────────────────────────────┤
│             │  [CLIs] [Connectors] [Secrets] [Enforcement]  │
│  Robin Chat ├────────────┬─────────────────────────────────┤
│             │  Item List │  Wiki Detail / Registry         │
│             │  (cards)   │  (from robin.db)                │
│             │            │                                 │
│             │  [+ Add]   │                                 │
│ [input]     │            │                                 │
└─────────────┴────────────┴─────────────────────────────────┘
```

### Tabs (left to right)

1. **CLIs** — Installed AI assistants + add from registry
2. **Connectors** — External service integrations
3. **Secrets** — API keys and tokens (encrypted, never exposed to agents)
4. **Enforcement** — Safety rules (hardcoded guardrails, human-only)

> **Note:** Skills, Triggers, and Appearance have moved to the **Settings Viewer** (`ai/views/settings-viewer/`), which is a project-specific view in the left nav. Robin's system panel only contains global, system-level settings that live in robin.db. Project-specific configuration (skills, triggers, sessions, prompts, workflows, theme) is managed through the Settings Viewer, which reads from the project filesystem.

### Layout per tab

- **Header area**: Tab icon + title (left), FAQ links as bulleted column (right), description paragraph below title
- **Tab bar**: Pill buttons, horizontal
- **Split below**: Item list (left, 300px) + wiki detail (right, fills)
- **CLIs tab special**: "+ Add CLI" button below list; clicking replaces wiki with registry view

---

## Data Model

### robin.db schema (migration 002)

```sql
-- system_config: settings with metadata
ALTER TABLE system_config ADD COLUMN tab TEXT;          -- which tab this belongs to
ALTER TABLE system_config ADD COLUMN section TEXT;      -- grouping within tab
ALTER TABLE system_config ADD COLUMN icon TEXT;         -- Material icon name
ALTER TABLE system_config ADD COLUMN description TEXT;  -- 2-3 line summary
ALTER TABLE system_config ADD COLUMN surface_when TEXT;  -- when to surface to user/Robin
ALTER TABLE system_config ADD COLUMN wiki_slug TEXT REFERENCES system_wiki(slug);
ALTER TABLE system_config ADD COLUMN sort_order INTEGER DEFAULT 0;

-- system_wiki: locked documentation pages
ALTER TABLE system_wiki ADD COLUMN description TEXT;     -- 2-3 line summary
ALTER TABLE system_wiki ADD COLUMN surface_when TEXT;    -- when to surface
ALTER TABLE system_wiki ADD COLUMN category TEXT;        -- cli, skill, connector, enforcement, etc.
ALTER TABLE system_wiki ADD COLUMN locked INTEGER DEFAULT 1;  -- 1 = ships with app, immutable

-- system_faq: questions linked to wiki answers
CREATE TABLE system_faq (
  id INTEGER PRIMARY KEY,
  tab TEXT NOT NULL,           -- which tab this FAQ appears on
  question TEXT NOT NULL,      -- the clickable question text
  wiki_slug TEXT REFERENCES system_wiki(slug),  -- wiki page with the answer
  sort_order INTEGER DEFAULT 0
);

-- cli_registry: available CLIs that can be added
CREATE TABLE cli_registry (
  id TEXT PRIMARY KEY,         -- e.g. 'claude', 'qwen', 'codex'
  name TEXT NOT NULL,
  author TEXT NOT NULL,
  description TEXT NOT NULL,
  version TEXT,
  installed INTEGER DEFAULT 0,
  active INTEGER DEFAULT 0,
  config TEXT                  -- JSON: { cli, flags, model, endpoint }
);
```

### Universal metadata contract

Every entity in the system carries:
1. **name** — what it is
2. **description** — what it does (2-3 lines)
3. **surface_when** — when to bring it up to the user or Robin

This applies to: config entries, wiki pages, FAQ items, triggers, skills, CLI profiles.

---

## Robin's Context Model

Robin runs on a CLI with a harness. She does NOT get wiki content pre-injected.

### What Robin gets in her system context

```
The user has the System Panel open.
Active tab: CLIs
Selected item: Kimi

You can query the system knowledge base using the lookup-system skill.
Available topics: [compact list of slugs]
```

That's it. Minimal. Robin knows:
- What the user is looking at (tab + selected item)
- That topics exist and where to find them
- How to read more when she needs to (skill call)

### How Robin reads on demand

```
User: "What is this?"
Robin calls: lookup-system({ slug: 'kimi' })
Robin gets: { title, description, content (full wiki markdown) }
Robin answers using the content.

User: "What other CLIs are there?"
Robin calls: lookup-system({ tab: 'clis' })
Robin gets: [{ name, description, surface_when }, ...]
Robin answers with the list.
```

No pre-loading, no wasted tokens. Robin reads when the conversation requires it, same as any agent reads a file when relevant.

### Context update on navigation

When the user changes tabs or selects a different item, the client sends:

```json
{ "type": "robin:context", "tab": "enforcement", "item": "settings-write-lock" }
```

The server updates Robin's awareness: "user is now looking at Settings Protection on the Enforcement tab." Robin doesn't automatically read the page — she just knows what's visible.

---

## The lookup-system Skill

```json
{
  "name": "lookup-system",
  "description": "Query Open Robin's system knowledge base",
  "script": "ai/system/skills/lookup-system.js",
  "args": {
    "slug": "Specific page slug to read in full",
    "tab": "List all items for a tab (returns name + description)",
    "search": "Search across all wiki content by keyword"
  },
  "inject": ["dbPath"],
  "access": "read"
}
```

Progressive disclosure through the skill:
- `{ tab: 'clis' }` → returns names + descriptions (directory level)
- `{ slug: 'kimi' }` → returns full wiki page content (detail level)
- `{ search: 'write lock' }` → returns matching pages with snippets

---

## FAQ System

FAQs are clickable questions displayed in the tab header. Each FAQ links to a wiki page that contains the answer.

When the user clicks a FAQ:
1. The wiki page loads in the detail panel (user sees it)
2. Robin is notified: "user clicked FAQ: What is a CLI?"
3. Robin can reference the same page if the user asks follow-up questions

FAQ answers ARE wiki pages. The question is just the entry point.

---

## System Wiki Philosophy

The system wiki is **locked documentation that ships with the app**. It describes what the code does.

- Changes when code changes, not when users edit
- Stored in robin.db, not as files on disk
- Source material: existing GitLab wiki pages (gitlab_wikis.json) get distilled into system entries
- Written in approachable, non-technical language (Open Robin voice)
- Each page follows the metadata contract: name, description, surface_when
- Robin reads pages on demand via skill calls, not pre-injection

The system wiki is distinct from any future project wiki (user-authored, editable, lives in the repo).

---

## WebSocket Messages

### Client → Server

```
robin:context    — { tab, item }           User navigated in the panel
robin:tab-items  — { tab }                 Request items for a tab
robin:wiki-page  — { slug }                Request full wiki page
robin:faq-click  — { tab, question }       User clicked a FAQ
file:move        — { source, target }      Drag-to-deploy (existing)
```

### Server → Client

```
robin:items      — [{ id, name, desc, badge, icon, section }]   Tab items
robin:wiki       — { slug, title, content, description }         Wiki page
robin:faqs       — [{ question, wiki_slug }]                     FAQ list for tab
modal:show       — { modalType, config, styles, data }           Deploy modal (existing)
file:moved       — { archived, moved }                           Deploy result (existing)
```

---

## CLI Registry Flow

### Left panel: installed CLIs only

Cards showing active CLIs with status badges. Below the list, a dashed "+ Add CLI" button.

### Right panel: registry (when + Add clicked)

Populated from cli_registry table. Each entry shows:
- Name + version
- Author
- Description (approachable, 1-2 lines)
- "Add" button

### Add flow

1. User clicks "Add" on a registry entry
2. Server checks if the CLI binary is installed locally (`which kimi`, `which claude`, etc.)
3. If found: mark as installed, add to left panel
4. If not found: show instructions for installing (wiki page for that CLI)
5. Once installed: user can set it as active or assign to specific agents

### Current registry (initial seed)

| ID | Name | Author |
|----|------|--------|
| kimi | Kimi | Kimi AI |
| qwen | Qwen Code | Alibaba / QwenLM |
| claude | Claude Code | Anthropic |
| opencode | OpenCode | SST |
| codex | Codex CLI | OpenAI |
| gemini | Gemini CLI | Google |

---

## Settings Enforcement (reference)

See lib/enforcement.js. Hardcoded, not configurable via triggers.

- Any `settings/` folder is write-locked for AI (case-insensitive, dot-prefix variants)
- Write tools (write_file, edit_file) are bounced with isError tool_result
- system:tool_bounced event fires on the bus
- Override toggle exists in the Enforcement tab (writes to system_config, labeled "this is a bad idea")

---

## Resolved: Database Philosophy

Decisions made 2026-03-30:

1. **robin.db scope**: One robin.db, global, lives in Electron app data (`~/.openrobin/` or equivalent). Holds: wiki, CLIs, connectors, secrets, appearance, enforcement, system events, and **all chat thread history** (cross-workspace searchable, read-only from any workspace). Nothing else.

2. **No per-workspace database.** Project-specific settings (triggers, sessions, prompts, styles, workflows) are files in the repo under `ai/views/*/`. The Settings Viewer reads them live from the filesystem.

3. **CLI registry source**: Static seed that ships with each release. Updatable registry is a future concern.

4. **Trigger aggregation**: Live from filesystem. The Settings Viewer's Triggers tab scans TRIGGERS.md files across the project. No DB indexing — always fresh.

5. **Multi-project**: One robin.db shared across all workspaces/projects. Chat history for all workspaces lives here. Project-specific config lives in each project's `ai/` folder.

6. **Skill registry**: Live from filesystem. Discovered from manifest files at startup.

7. **settings/ folders**: Gitignored globally (`**/settings/`). User config never syncs. Each user's SESSION.md, PROMPT.md, theme, and sort preferences stay local.

---

## Trigger System Access

Triggers need access to **both** the project filesystem and robin.db (system CRUD). This is because some trigger actions are repo-scoped (file operations, ticket creation) while others are system-scoped (show-modal, CLI status, event logging).

### Access tiers

| Trigger action | Scope | What it touches |
|----------------|-------|-----------------|
| create-ticket | repo | Creates/updates markdown in issues view |
| show-modal | system | Reads modal definition, broadcasts via WebSocket |
| reload-triggers | system | Re-scans filesystem, updates in-memory trigger registry |
| rename-collision | repo | Reads/renames markdown files in threads/ |
| thread-auto-rename | system + repo | Queries robin.db for thread metadata, renames markdown file |
| log-event | system | Writes to system_config or event log in robin.db |
| tool-bounced | system | Fires event on bus, logged in robin.db |

### How it works

The action handler factory (`lib/watcher/actions.js`) already receives `deps` — the dependency bag injected at startup. System CRUD is provided through deps:

```
deps.db          — robin.db connection (Knex instance)
deps.broadcast   — WebSocket broadcast to all clients
deps.broadcastModal — modal-specific broadcast
deps.getModalDefinition — reads modal config from filesystem
deps.eventBus    — system event bus
```

Trigger actions that need system access use `deps.db` to query or write robin.db. Trigger actions that need repo access use `deps.projectRoot` + filesystem operations.

### Security boundary

- **AI agents** never get direct DB access. They use skills, which are scoped node scripts.
- **Triggers** are human-authored (live in settings/ or TRIGGERS.md files). They run server-side with full deps access.
- **Skills** called by Robin get read-only DB access via `inject: ["dbPath"]` in the skill manifest.

The enforcement rule applies: AI can't write to settings/, so AI can't modify trigger definitions. Triggers are trusted code.

---

## Open Questions

1. **Secrets encryption**: robin.db stores secrets. For a local-only Electron app, is SQLite encryption sufficient, or do we need OS keychain integration (macOS Keychain, Windows Credential Manager)?

2. **CLI registry updates**: When the static seed becomes stale, what's the update path? App update only, or optional remote fetch?

3. **Cross-workspace thread search**: Skills like `search-threads` query robin.db across all workspaces. Should results indicate which workspace a thread belongs to? (Yes — panel_id already tracks this.)

---

## Implementation Order

1. Migration 002 (schema additions: system_faq, cli_registry tables + seed data)
2. Add `deps.db` to action handler factory for system CRUD access
3. lookup-system skill script (robin.db queries)
4. API/WebSocket handlers for robin:tab-items, robin:wiki-page, robin:faqs
5. RobinOverlay fetches from server instead of hardcoded arrays (4 tabs: CLIs, Connectors, Secrets, Enforcement)
6. Settings Viewer component (6 tabs: Skills, Triggers, Sessions, Prompts, Workflows, Theme — reads from filesystem)
7. Robin's SESSION.md with context awareness + skill registration
8. FAQ click → wiki page load + Robin notification
9. CLI registry from cli_registry table + binary detection
10. Global `**/settings/` gitignore rule
11. Thread identity: frontmatter with thread_id in markdown files
