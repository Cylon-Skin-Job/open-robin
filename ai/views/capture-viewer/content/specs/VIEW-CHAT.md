---
title: View Spec — Chat
created: 2026-03-28
updated: 2026-03-28
status: active
parent: MASTER_SYSTEM_SPEC.md
absorbs: SPEC.md (thread management), thread-system-README.md, RICH_STORAGE_FORMAT.md, chat-renderer-rebuild.md, CHAT_RENDER_SPEC.md
---

# Chat View

Chat is not a standalone workspace — it attaches to workspaces. Every workspace can have a chat. The chat type and display mode depend on the workspace.

---

## Chat Folder Structure

A `chat/` folder anywhere defines chat behavior. The folder contains:

```
ai/views/{workspace}/chat/
  chat.json              ← chat type config
  MEMORY.md              ← persistent memory (agent can write)
  TRIGGERS.md            ← chat-specific triggers (agent can write)
  settings/
    PROMPT.md            ← agent identity (human-deployed only)
    SESSION.md           ← CLI profile, tools, DB access (human-deployed only)
    archive/             ← prior versions auto-archived on replacement
      PROMPT-2026-03-28T14-30-00.md
      SESSION-2026-03-27T10-00-00.md
  threads/
    index.json           ← sort/filter config (by date, name, last-active, custom)
    {username}/
      refactor-auth.md   ← human-readable thread receipt
      fix-deploy-bug.md
    {collaborator}/
      review-endpoints.md
```

`threads/index.json` is the single source of truth for how threads appear — drives both the UI sidebar thread list and the markdown folder ordering. Sort by date, name, last-active, or custom order.

### Settings Folder (Human-Only Zone)

**Any folder named `settings/` is permanently write-locked for AI.** This is a system-wide enforcement rule hardcoded in the server — not configurable, not trigger-driven. The AI can read from settings/ but can never write to it.

PROMPT.md and SESSION.md live inside `settings/` to ensure the AI cannot modify its own identity or permissions without human review.

**Deploy flow:**
1. AI generates a new PROMPT.md or SESSION.md and drops it in the `chat/` folder (not settings/)
2. A trigger detects the new file and shows a drag-to-deploy modal overlay
3. The user drags the file from the preview panel to the settings/ drop target
4. The server archives the prior copy to `settings/archive/` and moves the new file in
5. The modal dismisses and the new configuration is live

**Archive pattern:** When a file is deployed to settings/, any existing file with the same name is moved to `settings/archive/FILENAME-{ISO-date}.md`. This creates an immutable audit trail.

### Chat-Level Files

For **daily-rolling** chats, PROMPT.md and SESSION.md in `settings/` define the agent's behavior. MEMORY.md and TRIGGERS.md live in the chat root where the agent can write to them. MEMORY.md is written to at nightly rollover when the day transitions.

For **threaded** chats, MEMORY.md is loaded before context compression when resuming a thread — it acts as a refresher of key context.

---

## Two Storage Layers

### SQLite (machine layer)
- Wire protocol structural data
- Session state and resource tracking
- Renders the live chat UI
- Source of truth for the running app

### Markdown (human layer, in repo)
- Human-readable receipt of each thread
- Lives in per-user folders inside the chat's `threads/` directory
- Portable — push repo, collaborators pull your threads
- Format matches existing CHAT.md (frontmatter + User/Assistant blocks)
- `threads/index.json` controls sort order for both UI and folder

```
ai/views/code/chat/threads/
  index.json            ← sort config
  rcc/
    refactor-auth.md
    fix-deploy-bug.md
  collaborator/
    review-endpoints.md
```

---

## Chat Types

### Three Thread Strategies (all built)

| Strategy | Folder Convention | Behavior | Used By |
|----------|-------------------|----------|---------|
| `daily-rolling` | `chat/` | One thread per day, auto-created, date-named. Old threads viewable but not resumable. | Agent personas, issues panel |
| `multi-thread` | `threads/` | Named conversations, MRU ordered, manual creation. User picks or creates. | Explorer panel, code workspace |
| `single-persistent` | (auto) | One thread always. No list, no creation UI. | Project-root agent (future) |

Configured in SESSION.md via `thread-model` field. Strategy modules in `lib/thread/strategies/`.

### Thread Lifecycle

```
Create -> Active (CLI process spawned)
  -> 9min idle -> Suspended (SIGTERM, graceful)
  -> User clicks thread -> Resumed (CLI restored with --session {threadId})
  -> FIFO eviction at warm pool cap -> Evicted (DOM dropped, re-renders instant on next visit)
```

**What's built:**
- [x] All 3 thread strategies implemented (daily-rolling.js, multi-thread.js, single-persistent.js)
- [x] ThreadManager with session lifecycle (active/suspended, FIFO at 10)
- [x] ThreadIndex (threads.json) with MRU ordering
- [x] Idle timeout (9min default, configurable via SESSION.md)
- [x] Wire process spawn with `--session {threadId}` for resume

---

## Structured History (history.json)

Dual-write: CHAT.md (human-readable) + history.json (structured). history.json is the source of truth. CHAT.md can be regenerated from it.

```json
{
  "version": "1.0.0",
  "threadId": "uuid",
  "createdAt": 1712345678901,
  "updatedAt": 1712345682345,
  "exchanges": [
    {
      "seq": 1,
      "ts": 1712345679200,
      "user": "What files are in this project?",
      "assistant": {
        "parts": [
          { "type": "text", "content": "..." },
          { "type": "tool_call", "name": "Glob", "arguments": {...}, "result": {...} },
          { "type": "text", "content": "..." }
        ]
      }
    }
  ]
}
```

**What's built:**
- [x] ChatFile.js — CHAT.md parser and writer
- [x] HistoryFile.js — history.json structured format with exchange/parts model
- [x] Dual-write on every message
- [x] Auto-rename after first response (spawns kimi for summary generation)

**What's needed:**
- [ ] SQLite storage for machine layer
- [ ] Markdown generation from history.json into per-user thread folders
- [ ] Per-user folder creation on first chat (username from git config or Robin profile)

---

## MEMORY.md in Chat Context

### Daily-Rolling
When the day rolls over (nightly), the system summarizes key points from the day's conversation into MEMORY.md. Next day's session loads this as context — continuity across days without loading the full history.

### Threaded (multi-thread)
When resuming a thread after context compression, MEMORY.md is loaded as a refresher. Contains key decisions, user preferences, and patterns discovered across all threads in that workspace.

**What's built:**
- [x] MEMORY.md loaded as system context at session start (via SESSION.md `system-context`)
- [x] Session invalidation checks MEMORY.md mtime (`checkSessionInvalidation()`)

**What's needed:**
- [ ] Nightly rollover summarization (fire at day transition, summarize -> write MEMORY.md)
- [ ] Pre-compact loading for threaded chats
- [ ] Agent self-write capability (agents update MEMORY.md with discovered preferences)

---

## SESSION.md in Chat Context

SESSION.md in a chat folder defines:
- Which CLI and model profile to use
- Thread model (daily-rolling, multi-thread, single-persistent)
- Idle timeout
- What files load as system context
- Tool permissions (allowed, restricted, denied)

```yaml
---
thread-model: daily-rolling
session-invalidation: memory-mtime
idle-timeout: 9m
system-context: ["PROMPT.md", "MEMORY.md"]
cli: kimi
profile: default
tools:
  allowed: [read_file, glob, grep]
  denied: [shell_exec]
---
```

**What's built:**
- [x] `parseSessionConfig()` in session-loader.js
- [x] `buildSystemContext()` loads files from `system-context` list
- [x] Thread strategy selection based on `thread-model`
- [x] Session invalidation based on `session-invalidation`
- [x] System context injection on first prompt in server.js

**What's needed:**
- [ ] CLI profile fields (cli, profile, model, endpoint)
- [ ] Tool permissions parsing and server-side enforcement

---

## Render Pipeline

Two render modes from the same segment catalog:

### Live Streaming
Segments animate one at a time: shimmer -> typing blitz -> collapse -> next.
- Orb bridges gap between user action and first token (dynamic, holds until token arrives)
- Speed attenuator (fast/slow binary based on buffer depth — 2 chunks ahead)
- Chunk boundaries: paragraphs, headers, code fences, list items

### Instant Render (history / thread switch)
Everything renders collapsed immediately. Same visual identity from catalog. No animation. Active threads keep DOM alive (`display: none` when not visible).

### Key Modules
```
segmentCatalog.ts           ← single source of truth (icons, colors, labels, renderMode)
LiveSegmentRenderer.tsx     ← animation lifecycle
InstantSegmentRenderer.tsx  ← collapsed, no animation
ToolCallBlock.tsx           ← shared shell (header + collapsible content)
transforms/markdown.ts      ← ONE configured marked instance
transforms/code.ts          ← ONE escapeHtml, codeBlockHtml
text/                       ← chunk boundary detection, sub-renderers (paragraph, header, code-fence, list)
```

---

## Crons on Chat

Any conversation can have a cron attached. Implemented as a self-blocking ticket (see VIEW-TICKETING.md):

- Cron fires -> sends **gray system message** to the chat
- Agent sees it as a system directive, responds naturally
- The ticket re-blocks itself with countdown to next fire
- System events can postpone (reset the countdown)
- User or agent can set up crons conversationally ("remind me to check deployments every afternoon")

---

## WebSocket Protocol

```
Client -> Server:
  thread:create, thread:open, thread:rename, thread:delete, thread:list
  prompt (requires open thread)

Server -> Client:
  thread:created, thread:opened, thread:renamed, thread:deleted, thread:list
  turn_begin, content, thinking, tool_call, tool_result, turn_end
  message:sent
```

See STREAMING_RENDER_SPEC.md for wire protocol details.

---

## Existing Implementation

The thread/chat system is **fully built and file-based**. No SQLite yet — all persistence is markdown + JSON + in-memory session tracking.

### Built Modules

| Module | What it does |
|--------|-------------|
| `ChatFile.js` | CHAT.md writer — serialize/parse markdown with User/Assistant blocks + `**TOOL CALL(S)**` markers |
| `HistoryFile.js` | history.json writer — structured exchanges with parts (text/think/tool_call), metadata, sequential numbering |
| `ThreadIndex.js` | threads.json manager — MRU ordering, CRUD, activate/suspend, date tagging (daily-rolling), rebuild from filesystem |
| `ThreadManager.js` | Orchestrator — combines ChatFile + HistoryFile + ThreadIndex. Session lifecycle, FIFO eviction (max 10), idle timeout (9min default), auto-rename after first response via kimi summary |
| `ThreadWebSocketHandler.js` | Per-connection WS state, panel switching, thread CRUD, message send/receive, global threadManagers Map |
| `daily-rolling.js` | One thread per day, auto-selected by YYYY-MM-DD date tag |
| `multi-thread.js` | Manual selection from thread list, user creates new |
| `single-persistent.js` | One thread always, no list, no switching |
| `session-loader.js` | Parses SESSION.md frontmatter, builds system context from file list, checks MEMORY.md mtime for invalidation |

### SQLite Migration Path

The code already separates concerns cleanly:
- **ChatFile.js** writes markdown (stays in repo as human-readable receipts)
- **HistoryFile.js** writes structured JSON (redirects to SQLite)
- **ThreadIndex.js** writes metadata JSON (redirects to SQLite)

The migration is: redirect HistoryFile and ThreadIndex to read/write SQLite instead of .json files. ChatFile continues writing .md to per-user thread folders in the repo. Same interfaces, different storage backend.

---

## TODO

### Built (working)
- [x] Three thread strategies (daily-rolling, multi-thread, single-persistent)
- [x] ThreadManager with FIFO eviction (max 10), idle timeout (9min)
- [x] ChatFile (CHAT.md) markdown writer + parser
- [x] HistoryFile (history.json) structured JSON writer with exchange/parts model
- [x] ThreadIndex (threads.json) with MRU ordering, CRUD, activate/suspend
- [x] ThreadWebSocketHandler with per-connection state and panel switching
- [x] Session loader: parseSessionConfig, buildSystemContext, checkSessionInvalidation
- [x] Wire process spawn with --session for resume
- [x] WebSocket protocol (thread:create, thread:open, thread:rename, thread:delete, message:send)
- [x] Render pipeline: orb, live streaming, instant render, segment catalog
- [x] Auto-rename threads after first response (kimi summary generation)
- [x] Dual-write: CHAT.md + history.json on every message

### Needed
- [ ] Redirect HistoryFile.js + ThreadIndex.js to SQLite (same interfaces, new backend)
- [ ] ChatFile.js writes to per-user `threads/{username}/` folders (currently writes to thread UUID folders)
- [ ] threads/index.json sort config (by date, name, last-active, custom)
- [ ] Chat folder with chat.json config
- [ ] PROMPT.md + SESSION.md + MEMORY.md in chat folders
- [ ] Nightly MEMORY.md rollover (daily rolling day transition)
- [ ] Pre-compact MEMORY.md loading (threaded chat resume)
- [ ] CLI profile fields in SESSION.md
- [ ] Tool + DB permissions in SESSION.md + server-side enforcement
- [ ] Cron attachment UI (self-blocking ticket pattern)
- [ ] Thread search (full-text via SQLite)
- [ ] Thread import/export
- [ ] Cross-thread citations
