---
title: Master Roadmap — Open Robin
created: 2026-03-28
status: active
parent: MASTER_SYSTEM_SPEC.md
---

# Master Roadmap

Implementation phases for the Open Robin system. Each phase builds on the previous. Work within a phase can be parallelized. Dependencies are noted.

---

## Phase 0: Stabilize What Exists

**Goal:** Fix known bugs, clean up renames, and get the existing system working reliably before adding new features.

### 0.1 Fix Known Bugs
- [ ] Wiki, Agents, Issues, Skills workspaces stuck on "Loading"
- [ ] User chat bubble renders twice on refresh
- [ ] Line-break parser stall on thinking content

### 0.2 File Renames
- [ ] PROMPT.md → PROMPT.md across codebase (~15 touch points: session-loader.js, agentStore.ts, AgentTiles.tsx, PromptCardView.tsx, 3 SESSION.md files, specs, wiki pages)
- [ ] Rename actual PROMPT.md files in code-manager, ops-manager, wiki-manager

### 0.3 SESSION.md Expansion
- [ ] Absorb TOOLS.md fields into SESSION.md frontmatter (tool permissions)
- [ ] Add DB access scoping to SESSION.md (`db: { read, write, denied }`)
- [ ] Add CLI profile fields (`cli`, `profile`, `model`, `endpoint`)
- [ ] Extend `parseSessionConfig()` in session-loader.js to parse new fields
- [ ] Delete standalone TOOLS.md (only exists for wiki-viewer)

### 0.4 Populate Missing Triggers
- [ ] Write TRIGGERS.md for code-manager (source changes → code review, weekly test scan)
- [ ] Write TRIGGERS.md for ops-manager (weekly dependency audit, package.json changes, doc drift)

**Dependencies:** None. Can start immediately.
**Spec refs:** VIEW-AGENTS.md, VIEW-CHAT.md

---

## Phase 1: SQLite Foundation

**Goal:** Introduce SQLite as the machine layer. Redirect existing JSON writers to SQLite while keeping markdown writers in the repo.

### 1.1 SQLite Setup
- [ ] Add `better-sqlite3` to server dependencies
- [ ] Create database schema: threads, exchanges, thread_metadata, system_config
- [ ] Database file location: `/system/` folder (ships with app, not in repo)
- [ ] Startup migration: create tables if not exist

### 1.2 Redirect HistoryFile.js
- [ ] Same interface (`addExchange`, `read`, `getLastExchange`, etc.)
- [ ] Backend swaps from JSON file to SQLite table
- [ ] Migration: import existing history.json files on first run

### 1.3 Redirect ThreadIndex.js
- [ ] Same interface (`list`, `create`, `update`, `activate`, `suspend`, etc.)
- [ ] Backend swaps from threads.json to SQLite table
- [ ] MRU ordering via SQL query instead of in-memory sort
- [ ] Migration: import existing threads.json on first run

### 1.4 ChatFile.js → Per-User Folders
- [ ] Detect username (Robin profile > git config user.name > "local")
- [ ] Write to `ai/views/{workspace}/chat/threads/{username}/THREAD_NAME.md`
- [ ] Create `threads/index.json` for sort configuration

**Dependencies:** None. Can start immediately. Parallel with Phase 0.
**Spec refs:** VIEW-CHAT.md, SPEC-COLLABORATION.md

---

## Phase 2: Event Bus Core

**Goal:** Central event emitter that all modules fire into. Extend trigger-loader for new event types.

### 2.1 Event Bus
- [ ] Create `lib/event-bus.js` (~60 lines: emit, on, bus)
- [ ] Add emit calls to server.js wire handler (`chat:turn_begin`, `chat:turn_end`, `chat:tool_call`)
- [ ] Add emit calls to dispatch.js (`ticket:created`, `ticket:dispatched`, `ticket:closed`)
- [ ] Add emit calls to runner (`agent:run_started`, `agent:run_completed`, `agent:run_failed`)

### 2.2 Extended Trigger Loader
- [ ] Extend trigger-loader.js to handle `type: chat` blocks (listen on event bus)
- [ ] Extend for `type: ticket` blocks
- [ ] Extend for `type: agent` blocks
- [ ] `registerBusListener()` function: subscribe to event, check filters, execute action

### 2.3 New Action Types
- [ ] `send-message` action (auto-send to a chat — enables crons on any chat)
- [ ] `webhook-post` action
- [ ] `drop-file` action
- [ ] Extend `createActionHandlers(deps)` factory

### 2.4 Loop Prevention
- [ ] Max chain depth (5)
- [ ] Extend hold-registry pattern to all event types
- [ ] Same-event suppression

**Dependencies:** Existing watcher/trigger infrastructure (built). Phase 0.3 (SESSION.md) recommended first.
**Spec refs:** SPEC-EVENT-SYSTEM.md

---

## Phase 3: Server-Side Enforcement + Skills + Change Ledger

**Goal:** Enforce permissions, build skills-as-scripts model, create audit trail.

### 3.1 Tool Enforcement
- [ ] Intercept tool calls in server.js — check against SESSION.md allowed/restricted/denied
- [ ] Bounce denied/restricted calls as `tool_result` with `isError: true`
- [ ] Agent sees restriction message, adjusts approach

### 3.2 Skills as Node Scripts
- [ ] `skills.json` manifest — any node script becomes a callable "tool"
- [ ] Built-in skills: read-history, trace-change, search-threads, return-message
- [ ] Skill registry loads on startup, handles tool_calls for registered skill names

### 3.3 Message IDs in Thread Markdown
- [ ] `<!-- msg:ex-N-role -->` HTML comments injected by ChatFile.js
- [ ] Parseable by skill scripts for precise message references

### 3.4 Change Ledger
- [ ] `ai/system/change-ledger.json` — every agent file change logged with thread + message ID
- [ ] trace-change skill reads ledger to find why a file was changed

### 3.5 User App Databases
- [ ] `{project}/apps/*.db` — separate from system DBs
- [ ] tools.json with develop/production mode toggle
- [ ] Locked writes bounce in production mode

### 3.6 CLI Profile Resolution
- [ ] Profiles in robin.db → resolve SESSION.md `profile` field to spawn args

**Dependencies:** Phase 0.3 (SESSION.md expansion), Phase 1 (SQLite).
**Spec refs:** VIEW-AGENTS.md, CLIs.md, ROADMAP-PHASE-3.md

---

## Phase 4: Ticketing UI + Cron Integration

**Goal:** Ticket board renders, crons work on chats, the calendar view exists.

### 4.1 Ticket Board UI
- [ ] Three-column board (INBOX / OPEN / COMPLETED)
- [ ] Ticket cards with title, assignee, state, blocking indicators
- [ ] Filtered views: All, Local Hub, Public Exchange

### 4.2 Ticket Enhancements
- [ ] `visibility` field (local / public) in create-ticket.js and sync
- [ ] `fires-at` field support in dispatch watcher (hold until clock hits)
- [ ] `tags` field and tag-based filtering
- [ ] `schedule` + `blocks: [self]` for repeating crons
- [ ] `index.json` view configuration

### 4.3 Cron-Chat Pattern
- [ ] Self-blocking ticket with countdown (fires → sends gray system message → re-blocks)
- [ ] Agent can create cron tickets mid-conversation
- [ ] System events can postpone (reset countdown)
- [ ] UI: countdown timer on ticket card

### 4.4 Calendar View
- [ ] Month view rendering tickets with `fires-at` or `schedule` fields
- [ ] Countdown display
- [ ] Click ticket → detail view

**Dependencies:** Phase 2 (event bus for cron-chat messaging).
**Spec refs:** VIEW-TICKETING.md

---

## Phase 5: Robin System Panel

**Goal:** Robin's icon in the header opens the system panel with tabs and contextual chat.

### 5.1 Panel Shell
- [ ] Robin icon in upper right of header
- [ ] Full-width overlay with tab bar + content area + chat sidebar
- [ ] Toggle between Robin's space and current project

### 5.2 System Tabs
- [ ] **Skills**: discover and list installed skills
- [ ] **Connectors**: secrets manager UI (form-based, not markdown)
- [ ] **Profiles**: CLI config editor (virtual markdown over DB)
- [ ] **Triggers**: aggregated dashboard of all discovered TRIGGERS.md files
- [ ] **Appearance**: theme editor (CSS variable picker)

### 5.3 Robin's Chat
- [ ] One contiguous chat history persisted in SQLite
- [ ] Contextually scoped to active tab
- [ ] Gray system messages for notifications (bot finished, ticket closed, cron fired)

### 5.4 Resource Dashboard
- [ ] Track `process.memoryUsage()` per spawned CLI
- [ ] Display session counts, RAM usage per workspace, background bot count
- [ ] Resource policy editor (virtual markdown over DB)
- [ ] RAM pressure alerts

### 5.5 Notification System
- [ ] Robin surfaces notifications (run complete, ticket closed, cron fired)
- [ ] Toast overlay when Robin's panel is closed
- [ ] Inline in Robin's chat when panel is open

**Dependencies:** Phase 1 (SQLite for Robin's chat and system config), Phase 2 (event bus for notifications).
**Spec refs:** VIEW-ROBIN.md

---

## Phase 6: Multi-Project Switching

**Goal:** Upper-left menu swaps between projects. Session management with per-workspace warm pools.

### 6.1 Project Registry
- [ ] Discover projects (folders with `ai/` directory? explicit registration?)
- [ ] Upper-left menu populated from registry
- [ ] Hot-swap: sidebar rebuilds, DB pointer shifts, views re-resolve

### 6.2 Session FIFO with Warm Pools
- [ ] Per-workspace warm pool (default 5, user-adjustable 3-7)
- [ ] Global session cap (default 20)
- [ ] Eviction priority: never mid-turn, never background bots, oldest idle first
- [ ] RAM pressure valve: shrink pools under pressure
- [ ] DOM caching for warm sessions (`display: none` when not visible)

### 6.3 Background State
- [ ] Background bots run workspace-agnostic (switching projects doesn't kill bots)
- [ ] Crons continue firing regardless of what you're looking at
- [ ] Frontend agents preserve until harness completes + turn ends

**Dependencies:** Phase 5 (Robin for resource dashboard), Phase 1 (SQLite for project registry).
**Spec refs:** MASTER_SYSTEM_SPEC.md (sections 3-5)

---

## Phase 7: Collaboration

**Goal:** Push repo, collaborators see your threads. Pull, you see theirs.

### 7.1 Per-User Thread Folders
- [ ] Username from Robin profile > git config > "local"
- [ ] ChatFile.js writes to `threads/{username}/THREAD_NAME.md`
- [ ] Thread viewer shows user folders, read-only for others' threads

### 7.2 GitLab Ticket Sync
- [ ] Push/pull tickets bidirectionally (built but needs visibility field support)
- [ ] Cross-instance claiming via GitLab assignee (built)
- [ ] Cross-instance blocking (encode in GitLab description/labels — deferred)

### 7.3 Thread Sharing
- [ ] Click thread → see markdown → copy link / send to someone
- [ ] Import: receive .md thread file → Robin offers to index into DB

**Dependencies:** Phase 1 (SQLite + per-user folders), Phase 4 (ticket visibility field).
**Spec refs:** SPEC-COLLABORATION.md

---

## Phase 8: Agent Execution

**Goal:** Agents actually run. First real ticket dispatch end-to-end.

### 8.1 First Run
- [ ] Trigger a ticket (manually or via cron)
- [ ] Dispatch → claim → create run folder → spawn wire → execute prompt → complete
- [ ] Verify: manifest updates, ticket closes, HISTORY.md appended, GitLab synced

### 8.2 Evidence Cards
- [ ] Render run step output in agent Runs tab
- [ ] Numbered evidence cards per step

### 8.3 MEMORY.md Rollover
- [ ] Daily-rolling: on day transition, summarize key points into MEMORY.md
- [ ] Threaded: load MEMORY.md before context compression on resume

### 8.4 LESSONS.md Lifecycle
- [ ] Token counting trigger (fires review ticket at ~500 tokens)
- [ ] Human review flow: read → promote to PROMPT.md → clear reviewed entries

### 8.5 Run Snapshot via Event Bus
- [ ] Wire run creation to `ticket:claimed` event
- [ ] TRIGGERS.md in agent parent folder responds to claim
- [ ] System eats its own dog food

**Dependencies:** Phase 2 (event bus), Phase 3 (enforcement). Runner code is built — this is about exercising it.
**Spec refs:** VIEW-AGENTS.md

---

## Future Phases (not sequenced)

### Signal/Telegram Gateway
- Robin fronts external messaging
- Messages appear inline in Robin's chat
- Dispatch agents from your phone
- **Spec ref:** VIEW-ROBIN.md

### Terminal View
- node-pty + xterm.js
- Own VIEW-TERMINAL.md spec when building

### File RAG / Search
- SQLite full-text search across threads
- JSON Reader integration for file-level RAG
- **Spec ref:** VIEW-ROBIN.md

### OS Hooks
- AppleScript bridge for Calendar, Reminders
- Event bus `type: os` triggers
- **Spec ref:** SPEC-EVENT-SYSTEM.md (Phase 5)

### Wiki Enhancements
- Edge graph visualization
- Freshness indicators
- Inline page editing
- **Spec ref:** VIEW-WIKI.md

### File Explorer Enhancements
- Syntax highlighting, markdown rendering
- File search (Ctrl+P), keyboard navigation
- File watching for auto-refresh
- **Spec ref:** VIEW-FILE-EXPLORER.md

### Onboarding
- First-run experience, setup wizard
- Flesh out after initial build
- **Spec ref:** Wiki pages

---

## Phase Dependencies Graph

```
Phase 0 (stabilize) ──────────────────────────────────────┐
    │                                                      │
Phase 1 (SQLite) ───────────── Phase 2 (event bus) ───────┤
    │                               │                      │
Phase 3 (enforcement) ─────────────┤                      │
    │                               │                      │
Phase 4 (ticketing UI) ────────────┤                      │
    │                               │                      │
Phase 5 (Robin panel) ─────────────┤                      │
    │                               │                      │
Phase 6 (multi-project) ───────────┤                      │
    │                               │                      │
Phase 7 (collaboration) ───────────┤                      │
    │                               │                      │
Phase 8 (agent execution) ─────────┘                      │
                                                           │
Future phases ─────────────────────────────────────────────┘
```

Phases 0, 1, and 2 can run in parallel. Phase 3 depends on 0+1. Phases 4-8 build incrementally. Future phases are independent.
