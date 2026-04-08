# Wiki Interface — Build Plan

The user-facing wiki interface for the kimi-claude IDE. Three-column layout rendered in the wiki workspace tab. Read-only for wiki files — all mutations flow through the ticketing system.

---

## Layout

```
┌──────────────┬─────────────────────────────┬──────────────────┐
│              │                             │                  │
│  Topic List  │     PAGE.md (rendered)      │  Links / Edges   │
│  (persistent │                             │                  │
│   sidebar)   │  Rendered markdown with     │  Incoming:       │
│              │  syntax highlighting        │  → Secrets       │
│  ● Home     │                             │  → Wiki-System   │
│  ○ Secrets  │                             │                  │
│  ◉ GitLab   │                             │  Outgoing:       │
│  ○ Wiki-Sys │                             │  → Secrets       │
│  ○ ...      │                             │  → Home          │
│              │                             │                  │
│              │                             ├──────────────────┤
│              │                             │                  │
│              │                             │  Chat            │
│              │                             │                  │
│              │                             │  Read-only Q&A + │
│              │                             │  ticket creation │
│              │                             │                  │
│              │                             │  > ask something │
└──────────────┴─────────────────────────────┴──────────────────┘
```

---

## Core Principle: Read-Only Wiki, Write-Only Tickets

The wiki interface never writes to wiki files. The chat agent in the right column can:

- **Read** any wiki topic, code file, git history, STATE.md — broad read access
- **Answer questions** about any topic — "what does the secrets page say about token rotation?"
- **Create tickets** — "the secrets page needs to update the token expiry" → creates `@wiki @wiki-secrets` ticket
- **Explain history** — read LOG.md and run manifests, explain what changed and why

The chat agent can NOT:

- Edit PAGE.md directly
- Write to any wiki file
- Skip the ticket → run → workflow pipeline

All wiki mutations go through tickets:

```
User notices issue → tells chat agent → agent creates ticket
  → Ticket flows to issues workspace
  → Wiki agent (separate session) picks it up
  → Full workflow loop runs (gather, propose, edges, execute)
  → PAGE.md updated with full audit trail
  → User sees update in the interface
```

This separation means:
- The UI is always safe — no accidental writes
- Every wiki change has a ticket, a run, and a full audit trail
- WORKFLOW.md injection happens in the wiki agent's session, not the chat session
- The chat agent's TOOLS.md is trivially simple

---

## Build Phases

### Phase 1: Topic List + Page Viewer (Static)

Get the three-column layout rendering with wiki content. No chat, no live edges yet.

**Files to create/modify:**

| File | Action | What |
|------|--------|------|
| `src/components/wiki/WikiExplorer.tsx` | Create | Top-level wiki workspace component (like FileExplorer) |
| `src/components/wiki/TopicList.tsx` | Create | Left sidebar — lists topic folders, highlights active |
| `src/components/wiki/PageViewer.tsx` | Create | Center — renders PAGE.md as formatted markdown |
| `src/components/wiki/EdgePanel.tsx` | Create | Right column — shows incoming/outgoing edges |
| `src/state/wikiStore.ts` | Create | Zustand store for wiki state (topics, active topic, edges) |
| `src/components/ContentArea.tsx` | Modify | Add `workspace === 'wiki'` branch, render WikiExplorer |

**Data flow:**
1. WikiExplorer mounts → sends `file_content_request` for `ai/workspaces/wiki/index.json`
2. Server returns index.json → wikiStore populates topic list and edge graph
3. User clicks a topic → sends `file_content_request` for `{topic}/PAGE.md`
4. Server returns markdown → PageViewer renders it with `marked` + `highlight.js` (already in deps)
5. EdgePanel reads edges from index.json for the active topic

**Server changes:** None. Uses existing `file_content_request` protocol.

**Deliverable:** Browse wiki topics, read rendered pages, see edge links.

---

### Phase 2: Wiki-Internal Navigation

Clicking a wiki link `[Secrets](Secrets)` navigates within the interface instead of opening a URL.

**Files to modify:**

| File | Action | What |
|------|--------|------|
| `src/components/wiki/PageViewer.tsx` | Modify | Intercept markdown link clicks |
| `src/components/wiki/TopicList.tsx` | Modify | Highlight active topic on navigate |
| `src/state/wikiStore.ts` | Modify | Add `navigateToTopic(slug)` action |

**How it works:**
1. PageViewer renders markdown with `marked`
2. Custom renderer intercepts `<a>` tags where href matches a known slug (from index.json)
3. Instead of browser navigation, calls `wikiStore.navigateToTopic(slug)`
4. Store updates active topic → PageViewer fetches new PAGE.md → EdgePanel updates

**Edge panel links also navigate** — clicking an edge link in the right column triggers the same `navigateToTopic`.

**Breadcrumb trail:** Track navigation history for back/forward within the wiki.

**Deliverable:** Seamless wiki browsing — click links to navigate between topics.

---

### Phase 3: Chat Panel (Read-Only + Ticket Creation)

Wire the right-column chat to the wiki workspace's CLI session. The agent reads wiki content and creates tickets — it never writes to wiki files.

**Files to create/modify:**

| File | Action | What |
|------|--------|------|
| `src/components/wiki/WikiChat.tsx` | Create | Chat input + message list, scoped to wiki |
| `src/state/wikiStore.ts` | Modify | Add chat state (messages, streaming) |
| `kimi-ide-server/server.js` | Modify | Handle wiki workspace session with api.json config |

**How it works:**
1. WikiChat component renders in the right column below EdgePanel
2. User types a message → sends via existing WebSocket `prompt` protocol
3. Server routes to wiki workspace's CLI `--wire` session
4. Session loaded with wiki PROMPT.md + STATE.md as system context
5. Agent responds: answers questions, explains history, or creates tickets

**Chat agent TOOLS.md (simplified):**
```
Allowed:  read_file, glob, grep, git_log, git_diff, git_show, list_directory
Allowed:  create_ticket (write to issues workspace only)
Denied:   write_file, edit_file, shell_exec, git_commit, git_push
```

The chat agent is a reader and ticket creator. Nothing else.

**Session scoping (server-side):**
1. Server reads `ai/workspaces/wiki/api.json` → creates config overlay (thinking off, fast model)
2. Server reads `ai/workspaces/wiki/PROMPT.md` → system prompt
3. Server spawns CLI with `--wire` flag and wiki-specific config
4. TOOLS.md enforcement: server blocks all write/edit tool calls to wiki files

**Ticket creation flow:**
1. User: "The secrets page has the wrong token expiry date"
2. Chat agent reads secrets/PAGE.md, confirms the issue
3. Chat agent creates ticket: `@wiki @wiki-secrets — token expiry date incorrect (2026-03-22 → 2026-06-20)`
4. Ticket appears in issues workspace
5. Wiki agent (separate session) picks it up and runs the full workflow

**FloatingChat pattern:** The chat panel can also be rendered as a FloatingChat — a draggable floating chat bubble anchored to the bottom-right as a FAB (floating action button). FloatingChat is a reusable container that wraps the existing ChatArea component, not a rebuilt chat. It can be used in any workspace to provide a persistent, non-intrusive chat interface that stays out of the way until needed.

**Deliverable:** Ask questions about wiki content. Request updates via tickets. All mutations go through the audited pipeline.

---

### Phase 4: LOG.md Viewer + Run History

Show the change trail and run history in the interface.

**Files to create/modify:**

| File | Action | What |
|------|--------|------|
| `src/components/wiki/LogViewer.tsx` | Create | Renders LOG.md below the page, collapsible |
| `src/components/wiki/RunList.tsx` | Create | Lists recent runs with ticket links |
| `src/components/wiki/RunViewer.tsx` | Create | Renders a run's ticket.md + step links |
| `src/components/wiki/PageViewer.tsx` | Modify | Add tabs: Page / Log / Runs |

**How it works:**
1. PageViewer gets a tab bar: **Page** | **Log** | **Runs**
2. Page tab = rendered PAGE.md (default)
3. Log tab = rendered LOG.md for the active topic
4. Runs tab = list of runs that touched this topic (filtered from `runs/*/manifest.json`)
5. Clicking a run opens RunViewer showing ticket.md with step links
6. Clicking a step link renders the step file as markdown

**Data flow for runs:**
1. On Runs tab activate → send `file_tree_request` for `runs/`
2. For each run dir → send `file_content_request` for `manifest.json`
3. Filter manifests where `topics_touched` includes active topic
4. Display as list sorted by date
5. Click run → fetch `ticket.md` → render with step links
6. Click step → fetch step file → render

**Deliverable:** Full audit trail visible in the UI. Progressive disclosure — summary (ticket.md) → detail (steps/) → raw data (snapshots/).

---

## Component Architecture

```
ContentArea (workspace === 'wiki')
└── WikiExplorer
    ├── TopicList              ← left column (persistent sidebar)
    │   ├── topic items
    │   └── active indicator
    ├── PageViewer             ← center column
    │   ├── breadcrumb trail
    │   ├── tab bar (Page | Log | Runs)
    │   ├── rendered markdown (Page tab)
    │   ├── LogViewer (Log tab)
    │   └── RunList + RunViewer (Runs tab)
    └── RightPanel             ← right column
        ├── EdgePanel
        │   ├── incoming edges
        │   └── outgoing edges
        └── WikiChat
            ├── message list
            └── input
```

All components are pure renderers. State lives in `wikiStore.ts`. Data arrives via WebSocket using the existing `file_content_request` protocol.

---

## State (wikiStore.ts)

```typescript
interface WikiState {
  // Topics
  topics: Record<string, TopicMeta>;   // from index.json
  activeTopic: string | null;          // currently viewed topic slug
  navigationHistory: string[];         // for back/forward
  historyIndex: number;                // current position in history

  // Page content
  pageContent: string;                 // raw markdown of active PAGE.md
  pageLoading: boolean;
  activeTab: 'page' | 'log' | 'runs'; // current tab

  // Edges
  edgesIn: string[];                   // topics linking TO active topic
  edgesOut: string[];                  // topics active topic links TO

  // Log
  logContent: string;                  // raw markdown of active LOG.md

  // Runs
  runs: RunSummary[];                  // manifests filtered to active topic
  activeRun: string | null;            // currently viewed run ID
  runContent: string;                  // ticket.md or step content

  // Chat
  chatMessages: ChatMessage[];
  chatStreaming: boolean;

  // Actions
  loadIndex: () => void;
  navigateToTopic: (slug: string) => void;
  goBack: () => void;
  goForward: () => void;
  setActiveTab: (tab: 'page' | 'log' | 'runs') => void;
  openRun: (runId: string) => void;
}
```

---

## Server Protocol

No new message types needed. Reuse existing:

| Client → Server | Purpose |
|----------------|---------|
| `file_content_request { workspace: 'wiki', path: 'index.json' }` | Load topic graph |
| `file_content_request { workspace: 'wiki', path: '{topic}/PAGE.md' }` | Load page content |
| `file_content_request { workspace: 'wiki', path: '{topic}/LOG.md' }` | Load change log |
| `file_content_request { workspace: 'wiki', path: 'runs/{id}/manifest.json' }` | Load run manifest |
| `file_content_request { workspace: 'wiki', path: 'runs/{id}/ticket.md' }` | Load run ticket |
| `file_content_request { workspace: 'wiki', path: 'runs/{id}/steps/{file}' }` | Load step detail |
| `file_tree_request { workspace: 'wiki', path: 'runs/' }` | List all runs |
| `prompt { workspace: 'wiki', ... }` | Chat with wiki agent |

| Server → Client | Purpose |
|----------------|---------|
| `file_content_response { ... }` | Page/log/index/run content |
| `content`, `thinking`, `turn_begin`, `turn_end` | Chat streaming (existing) |

---

## Styling

Wiki workspace color: **pink** (`--wiki-primary`).

- Topic list: dark sidebar, pink highlight on active topic, dim text for inactive
- Page viewer: clean rendered markdown, comfortable reading width, code blocks highlighted
- Tab bar: subtle, underline-style active indicator in pink
- Edge panel: compact link list, grouped by incoming/outgoing, clickable
- Chat panel: same styling as existing ChatArea but sized for right column
- Breadcrumb trail: `Home > Secrets > GitLab` with clickable segments
- Run list: compact, sorted by date, ticket ID + summary visible
- Visual indicator of current position: active topic highlighted in sidebar + breadcrumb

---

## Dependencies

Already in the project:
- `marked` (v17) — markdown rendering
- `highlight.js` (v11) — syntax highlighting
- `zustand` (v5) — state management
- WebSocket protocol — file_content_request/response

Nothing new needed.

---

## Build Order

```
Phase 1: Topic List + Page Viewer     ← browse and read wiki
Phase 2: Wiki-Internal Navigation     ← click links to navigate
Phase 3: Chat Panel (read + tickets)  ← ask questions, create tickets
Phase 4: LOG + Run History            ← audit trail in the UI
```

Each phase is independently shippable. Phase 1 is the minimum viable wiki interface. Phase 3 is where it becomes interactive. Phase 4 is full observability.

---

## What This Does NOT Do

- **No direct wiki editing from the UI.** All mutations flow through tickets.
- **No WORKFLOW.md injection in the chat session.** The chat agent is read-only. WORKFLOW.md is used by the wiki agent when it processes tickets in its own separate session.
- **No new server protocols.** Everything uses existing `file_content_request` and `prompt` messages.
- **No new dependencies.** All rendering libraries already in the project.
