---
title: View Spec — Robin (System Panel)
created: 2026-03-28
status: active
parent: MASTER_SYSTEM_SPEC.md
absorbs: OPEN_ROBIN_MASTER_VISION.md
---

# Robin — System Panel View

Robin is the app. This spec covers her panel, her chat, her tabs, and her role as the system AI.

---

## Layout

```
┌──────────────────────────────────────────────────────────┐
│  [Project Menu]  [App Header]                    [Robin] │
├──────────────────────────────────────────────────────────┤
│ Skills │ Connectors │ Profiles │ Triggers │ Appearance   │
├─────────────────────────────────┬────────────────────────┤
│                                 │                        │
│  Tab content                    │  Robin chat            │
│  (lists, settings, toggles)     │  (one contiguous chat) │
│                                 │  Signal msgs inline    │
│                                 │  Contextual to tab     │
│                                 │                        │
└─────────────────────────────────┴────────────────────────┘
```

- Full-width overlay, non-movable, not a workspace folder
- Clicking the Robin icon toggles between Robin's space and the current project
- Robin's chat is one contiguous history that persists across everything
- Whatever tab is open, Robin is contextually scoped to it

---

## Tabs

### Skills
Installed and available skills. Discovery list, enable/disable, documentation.

### Connectors
Secrets manager, API keys, auth tokens. One central vault that projects reference by name.

### Profiles
CLI configs + custom system prompts that persist into session records. Each profile is a distinct personality install:
- "KIMI CLI" (default)
- "Qwen3 Coder via KIMI CLI"
- Custom profiles with tailored prompts

A Profile may also lock in which model endpoint gets hit.

### Triggers
Aggregated view of every `TRIGGERS.md` found in `ai/views/` and `/system/`. Dashboard, not editor. Each entry links back to its source file. No validation baked in — a background agent audits if needed.

### Appearance
Theme, layout tweaks. System inherits defaults.

---

## Robin's Powers

### Can Do
- Open system tabs contextually
- See entire project structure across all projects
- Initiate agents via ticket dispatch (never direct file edits)
- Help build new agents
- Manage secrets, profiles, hooks, appearance
- Receive/respond to Signal/Telegram messages inline
- Surface resource usage (RAM, session counts) in dashboard
- Suggest policy changes based on usage patterns
- Help users write resource policies, trigger configs, agent prompts

### Cannot Do
- Touch project files directly
- Make changes without dispatching an agent
- Override agents the user didn't build or approve

### Trust Escalation
1. Robin sees everything, touches nothing directly
2. If you trust an agent, Robin can dispatch it
3. The agent does the work, Robin reports back
4. Always mediated through agents you built and approved

---

## System Wiki — Not Independent

The system wiki surfaces as:
- Contextual content within system areas
- Tooltips on settings and controls
- Inline help in Robin's chat responses

Stored in the System SQLite DB. Appears where relevant — never as its own browsable destination.

---

## External Gateway

Robin fronts Signal, Telegram, and future messaging channels. Messages appear inline in her chat. She manages things while you're away — dispatch agents, check status, relay updates.

---

## Resource Dashboard

Robin's panel shows system health:

```
Sessions: 14 active (3.2 GB)
├── kimi-claude:  3 warm (820 MB)  [■■■□□□□]
├── fusion-vault: 2 warm (540 MB)  [■■□□□□□]
├── background:   9 bots  (1.8 GB) [stable]
│
Per-workspace pool: 5 (adjustable 3-7)
Global cap: 20
RAM ceiling: 8 GB
```

---

## Virtual Markdown Config

System policies live in SQLite but render as editable markdown in Robin's panel. The file never exists on disk. Robin helps you write them with forgiving syntax and contextual suggestions.

---

## Notifications

Robin owns the notification system. When a bot finishes a run, a ticket closes, a cron fires, a sync completes — Robin surfaces it. Open design questions:
- Toast notifications vs inline in Robin's chat vs both?
- Notification priority levels (some are FYI, some need action)?
- Notification history (scrollback in Robin's chat covers this naturally)?
- Do notifications appear when Robin's panel is closed? (toast overlay on the project view?)

---

## TODO (not yet designed)

- [ ] Robin's chat persistence format in SQLite
- [ ] Signal/Telegram integration protocol
- [ ] Tab rendering implementation
- [ ] Resource monitoring granularity (per-process vs per-session)
- [ ] Policy syntax parser (how forgiving? error handling?)
- [ ] Notification UX (toast, inline, both, priority levels)
- [ ] File RAG / search integration (future — when JSON Reader is integrated)
