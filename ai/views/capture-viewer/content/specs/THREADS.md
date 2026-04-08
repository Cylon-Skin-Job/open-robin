---
title: Spec Threads — Open Questions and Future Topics
created: 2026-03-28
status: living document
---

# Spec Threads

Open questions, unresolved decisions, and future topics. Work through these one by one. Mark resolved with the decision and date.

---

## Past Threads (touched, not resolved)

### 1. Session FIFO idle definition
What resets the idle timer? Last user message? Last agent output? Does a cron-triggered turn reset it?
- **Status:** RESOLVED 2026-03-28
- **Decision:** Idle resets on message_send, message_end, or turn_end scoped to that session. Cron-triggered send-message counts as message_send and resets idle. Intentional — if you set up a cron, you want the session warm. RAM pressure valve overrides if needed.
- **Recorded in:** SPEC-EVENT-SYSTEM.md
- **Affects:** MASTER_SYSTEM_SPEC (session management), VIEW-CHAT

### 2. Cron-to-chat message type
Does the cron message appear as "user" or "system" in chat history? Affects how the agent interprets it and how it renders.
- **Status:** RESOLVED 2026-03-28
- **Decision:** Gray system message. Not a user bubble. Agent sees it as a system directive. Crons are self-blocking tickets — they re-block themselves after firing with a countdown to the next occurrence.
- **Recorded in:** VIEW-TICKETING.md, VIEW-CHAT.md
- **Affects:** VIEW-CHAT, VIEW-TICKETING

### 3. Cron scope: project-level vs system-level
Project crons live in the workspace. Robin can also have crons. Who owns what? Can Robin's crons target project chats?
- **Status:** RESOLVED 2026-03-28
- **Decision:** Two patterns. Repeating crons = TRIGGERS.md entries that generate fresh tickets on schedule. One-shot delayed = a single ticket with `fires-at` timestamp. Both are just tickets with time fields. Project-level crons live in project TRIGGERS.md. System-level crons are Robin's (in /system/TRIGGERS.md). Robin can target project chats because she sees everything.
- **Recorded in:** VIEW-TICKETING.md, SPEC-EVENT-SYSTEM.md
- **Affects:** VIEW-ROBIN, VIEW-CHAT, VIEW-TICKETING

### 4. Cron + blocking interaction
Does a cron check ticket blocks before sending? If a topic is blocked, should the cron skip its scheduled message?
- **Status:** RESOLVED 2026-03-28
- **Decision:** Crons ARE tickets. Blocking applies at dispatch time. If a cron-generated ticket has `blocked_by` or targets a blocked topic, it won't dispatch until the block clears. Self-blocking (`blocks: [self]`) is how repeating crons pace themselves. Agents can add blocks mid-conversation ("don't let wiki edits through before then" = `blocks: wiki-updates`). System events can postpone by resetting the countdown.
- **Recorded in:** VIEW-TICKETING.md
- **Affects:** VIEW-TICKETING, VIEW-CHAT

### 5. CSS cascade and agent-by-folder survival check
DECLARATIVE_WORKSPACE_SYSTEM_SPEC was deleted. The CSS cascade, agent-definition-by-folder, and system/project split were absorbed partially. Verify nothing important was lost.
- **Status:** RESOLVED 2026-03-28
- **Decision:** CSS cascade simplified to 3 levels: ai/system (defaults) -> ai/views (workspace override) -> ai/views/**-viewer (component override). Settings in root settings/ folder. Agent folder restructured: IDENTITY.md renamed to PROMPT.md, TOOLS.md absorbed into SESSION.md, LESSONS.md moved to workflow-scoped only. Chat folders get their own PROMPT.md + SESSION.md + MEMORY.md. Content-type JSON definitions killed (no plugin registry). Icon-map.json consolidation deferred to implementation.
- **Recorded in:** MASTER_SYSTEM_SPEC.md, VIEW-AGENTS.md, VIEW-CHAT.md
- **Affects:** MASTER_SYSTEM_SPEC

### 6. Client architecture layering
How much layering does the client need? Event bus? Service layer? Or is the current structure fine given "layer as little code as possible"?
- **Status:** OPEN
- **Affects:** Implementation

### 7. File watcher ownership
DOMAIN-3 file watcher — runs as a server module or Robin's background process? Who starts it? Who sees its output?
- **Status:** RESOLVED 2026-03-28
- **Decision:** Server module. Stays in lib/watcher/index.js, starts on server boot. Robin surfaces its output via the Triggers tab dashboard but doesn't own or run it.
- **Recorded in:** SPEC-EVENT-SYSTEM.md (existing modules table)
- **Affects:** VIEW-WIKI, VIEW-ROBIN, DOMAIN-3-FILE-WATCHER

### 8. Virtual-markdown-over-DB pattern scope + DB access in SESSION.md
Defined for resource policies. Does it extend to ALL system configs? Also: how do agents access the DB?
- **Status:** RESOLVED 2026-03-28
- **Decision:** Virtual markdown for resource policies and profiles. Form-based UI for connectors/secrets and appearance/theme. Any system YAML config can be simulated via TRIGGERS.md syntax and pulled from DB. DB access is scoped in SESSION.md alongside tool permissions — `db: { read: [...], write: [...], denied: [...] }`. SESSION.md becomes the single permission surface: tools, DB tables, CLI profile, session behavior.
- **Recorded in:** VIEW-AGENTS.md (SESSION.md section), VIEW-ROBIN.md
- **Affects:** VIEW-ROBIN, VIEW-AGENTS

### 9. Thread markdown format
Per-user folders with .md files. What's the actual schema? Frontmatter? Simplified human view or mirrors history.json?
- **Status:** RESOLVED 2026-03-28
- **Decision:** Every chat folder uses `threads/` to hold markdown. Path: `ai/views/**/chat/threads/{username}/THREAD_NAME.md`. Format is same as existing CHAT.md (frontmatter with thread ID + workspace + title, then User/Assistant blocks). `threads/index.json` controls sort order (by date, name, last-active, custom) — same file drives both UI sidebar and folder ordering.
- **Recorded in:** VIEW-CHAT.md
- **Affects:** VIEW-CHAT, SPEC-COLLABORATION

### 10. User identity source
git config user.name? Robin profile? What if they differ?
- **Status:** RESOLVED 2026-03-28
- **Decision:** Fallback chain: Robin profile (if set) > git config user.name > "local". Git config is the default since it's on every dev machine. Robin profile overrides for users who want a different display name.
- **Recorded in:** SPEC-COLLABORATION.md
- **Affects:** SPEC-COLLABORATION

---

## Future Threads

### 11. Project creation flow
Upper-left menu shows projects. How do you create a new one? Clone a repo? Template? Empty scaffold? What does Robin do during onboarding?
- **Status:** DEFERRED
- **Decision:** Decide when building workspace switcher.

### 12. Project deletion / archival
Done with a project? Archive to SQLite? Remove from menu? What about its background bots?
- **Status:** DEFERRED
- **Decision:** Decide when building workspace switcher.

### 13. Workspace ordering and customization
Can the user reorder sidebar workspaces? Hide them? Create new ones? How?
- **Status:** DEFERRED
- **Decision:** Decide when building workspace switcher.

### 14. Agent lifecycle beyond runs
MEMORY.md and LESSONS.md grow over time. When pruned? Who reviews? lessons-review.md trigger exists but no full lifecycle spec.
- **Status:** DEFERRED
- **Decision:** Decide when building workspace switcher.

### 15. Search
Global search across threads, wiki, tickets, files. Robin owns it? Per-workspace? SQLite full-text search?
- **Status:** RESOLVED 2026-03-28
- **Decision:** Robin and other AIs have read access to everything. File RAG is a future feature (when JSON Reader is integrated). SQLite full-text search comes with the SQLite migration.
- **Affects:** VIEW-ROBIN

### 16. Notification system
Bot finishes a run, ticket closes, cron fires. Where do notifications appear? Robin's chat? Toast? Both?
- **Status:** RESOLVED 2026-03-28
- **Decision:** Add to Robin's spec as an open design question. Robin's domain — she surfaces notifications.
- **Affects:** VIEW-ROBIN

### 17. Offline behavior
GitLab sync fails, Signal down, no internet. What degrades gracefully? What blocks?
- **Status:** DEFERRED
- **Decision:** Future. Local-first by design, so most things work offline. Sync just pauses.

### 18. Mobile access via Robin
Robin fronts Signal/Telegram. What can you do from your phone? Read status? Create tickets? Approve agent work?
- **Status:** DEFERRED
- **Decision:** Future build. Gateway + Signal integration. Local only right now.

### 19. Onboarding / first-run experience
New user downloads the app. What do they see? Robin introduces herself? Setup wizard? Blank project?
- **Status:** DEFERRED
- **Decision:** Keep adding to wiki. Flesh out after initial first build is done.

### 20. Backup and recovery
SQLite DB corrupts. Backup strategy? Can you rebuild from repo markdown?
- **Status:** RESOLVED 2026-03-28
- **Decision:** Future dedicated feature. For now: GitLab + GitHub repos as backup, secrets manager for credentials.
- **Affects:** SPEC-COLLABORATION

### 21. Multi-user on same machine
Multiple user profiles locally, or one user per install?
- **Status:** RESOLVED 2026-03-28
- **Decision:** Nope. One user per install.

### 22. Agent permissions / sandboxing
Agents read broadly, write to scope. Enforced how? Trust? Filesystem perms? Server-side checks?
- **Status:** RESOLVED 2026-03-28
- **Decision:** SESSION.md is the permission surface. Tools, DB access, and file scope all defined there. Server-side enforcement when built.
- **Recorded in:** VIEW-AGENTS.md (SESSION.md section)

### 23. Wire protocol versioning
WebSocket protocol evolves. How handle version mismatches between client and server?
- **Status:** RESOLVED 2026-03-28
- **Decision:** Create CLIs.md spec to track this and other CLI/wire concerns.
- **Recorded in:** CLIs.md (to be created)

### 24. Theme sharing
Appearance is a system tab. Can users share themes? Export/import CSS variable sets?
- **Status:** RESOLVED 2026-03-28
- **Decision:** It's just a file. Export/import CSS variable files. No marketplace needed.

### 25. Terminal workspace
Marked as built (mockup). Actual plan? node-pty + xterm.js? Own VIEW spec?
- **Status:** DEFERRED
- **Decision:** Future. Create VIEW-TERMINAL.md when building.

---

## Event System Threads (from SPEC-EVENT-SYSTEM.md)

### 26. Event object schema
What does an event look like internally? `{type, source, data, timestamp, workspace?}` — need to nail down the shape.
- **Status:** OPEN
- **Affects:** SPEC-EVENT-SYSTEM

### 27. Built-in vs script actions
What actions ship with the app vs requiring a user script? send-signal, create-ticket, send-email — built-in? What about custom actions?
- **Status:** OPEN
- **Affects:** SPEC-EVENT-SYSTEM

### 28. Rate limiting / loop prevention
Trigger -> action -> event -> trigger -> ... How do we break infinite loops? Max chain depth? Cooldown period?
- **Status:** OPEN
- **Affects:** SPEC-EVENT-SYSTEM

### 29. Conditional logic depth
Simple `if` statements in TRIGGERS.md or a full expression language? How complex can conditions get?
- **Status:** OPEN
- **Affects:** SPEC-EVENT-SYSTEM

### 30. Trigger action error handling
Action fails — retry? Notify Robin? Dead letter queue? Silently log?
- **Status:** OPEN
- **Affects:** SPEC-EVENT-SYSTEM

### 31. OS hook discovery
How does the event bus know about AppleScript, calendar, email hooks? Auto-detect macOS? Config file? Platform-specific?
- **Status:** OPEN
- **Affects:** SPEC-EVENT-SYSTEM, VIEW-ROBIN

### 32. Privacy boundary for external actions
Which events/actions can leave the machine (send_email, webhook_post) vs must stay local? User consent model?
- **Status:** OPEN
- **Affects:** SPEC-EVENT-SYSTEM, VIEW-ROBIN

---

## Ticketing Threads

### 33. Cross-instance blocking via GitLab
blocks/blocked_by are local-only. Encode in GitLab description or labels for cross-instance blocking? What format?
- **Status:** DEFERRED
- **Decision:** To be determined when planning cross-instance features.
- **Affects:** VIEW-TICKETING, SPEC-COLLABORATION

### 34. Calendar view design
Month view with ticket countdowns. What renders in each day cell? Just dots/counts or full ticket cards? Drill-down on click?
- **Status:** OPEN
- **Affects:** VIEW-TICKETING

### 35. Tag system design
Free-form strings or predefined categories? Can tags drive filtered views beyond the built-in ones?
- **Status:** OPEN
- **Affects:** VIEW-TICKETING

### 36. PR ticket integration
GitHub/GitLab PRs as tickets. Webhook inbound -> ticket? Polling? How do PR tickets differ from regular tickets?
- **Status:** OPEN
- **Affects:** VIEW-TICKETING, SPEC-EVENT-SYSTEM

### 37. index.json view configuration
What goes in issues/index.json? Default view, visible views, saved filters, state persistence across sessions?
- **Status:** OPEN
- **Affects:** VIEW-TICKETING

### 38. Ticket pausing (without closing)
Can you pause a cron-chat ticket or any ticket without closing it? New state `paused`? Or just use blocking?
- **Status:** OPEN
- **Affects:** VIEW-TICKETING

### 39. Chat-created tickets
When an agent creates a ticket on behalf of the user mid-conversation, does it call create-ticket.js directly or emit an event that the system handles?
- **Status:** OPEN
- **Affects:** VIEW-TICKETING, VIEW-CHAT, SPEC-EVENT-SYSTEM
