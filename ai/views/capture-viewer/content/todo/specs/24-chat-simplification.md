# SPEC-24 — Chat Simplification (Parent)

**Goal:** Unify the thread model. Kill the daily-rolling vs threaded-session split. Make thread IDs timestamps, make filenames immutable, make display names optional (null by default) and populated later by Mario's enrichment pipeline. Rename `thread:create`/`thread:open` to a single unified `thread:open-assistant` verb that reflects the Chat Assistant vs Background Worker taxonomy from `agents-viewer/`. Delete the orphaned `thread:open-agent` handler chain (395 lines of dead code with zero callers).

**Phases:**

| Phase | File | Scope |
|---|---|---|
| **24a** | `24a-chat-simplification-id-format.md` | Timestamp IDs, null default name, delete `handleThreadOpenDaily` + `newChatName()`, unify `thread:create`/`thread:open` → `thread:open-assistant`, delete `thread:open-agent` orphan chain (3 files, 395 lines), delete `TicketBoard.tsx` hijack. |
| 24b | (future) | Filename = `<id>.md` (immutable) + YAML frontmatter in markdown. |
| 24c | (future) | Relocate chats to `ai/views/chat/threads/<username>/<id>.md`. |
| 24d | (future) | Delete legacy strategies (`daily-rolling.js`, `auto-rename.js`) and collapse to single flow. |
| 24e | (future) | Client UI: display-name fallback = ID with milliseconds stripped. |
| 24f | (future) | **Deep code sweep** — final safety pass to catch any orphans or stale references missed by earlier phases. |

**Explicitly out of scope for the 24x series:**
- Global "chat follows you across views" pointer
- Maeve (memory agent) and Mario (enrichment agent) implementations
- Idle checkpoint pipeline
- TRIGGERS.md integration
- `harness_session_id` column migration (will land as 008+ — slot 007 taken by 24a's `threads.name` nullability migration)
- `lib/harness/kimi/index.js:52` `--session` flag coupling (separate followup)

**Pre-production note:** All existing threads are disposable test data. Migrations may delete rows and files without preserving user content.

**Naming rationale:** `thread:open-assistant` was chosen (over plain `thread:open` or `thread:chat`) to explicitly match the `Chat Assistants/` vs `Background Workers/` distinction already established in `ai/views/agents-viewer/`. Background workers use the runner path (`lib/runner/`) and never touch `thread:*` messages. The name enforces that separation at the wire protocol level.
