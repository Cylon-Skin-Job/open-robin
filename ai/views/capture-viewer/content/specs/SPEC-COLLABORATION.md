---
title: Collaboration Spec
created: 2026-03-28
status: active
parent: MASTER_SYSTEM_SPEC.md
---

# Collaboration Model

Everything in the repo is portable. The SQLite DB is local. This separation makes collaboration natural.

---

## What Syncs (repo)

```
ai/views/
  {workspace}/
    threads/{username}/*.md    ← your chat receipts
    wiki/                      ← shared knowledge
    agents/                    ← shared agent definitions
    tickets/                   ← shared work queue
```

- **Thread folders are per-user** — `git pull` adds their folder alongside yours. No merge conflicts.
- **Wiki pages** are shared — same truth for everyone.
- **Agent definitions** are shared — same bots, same prompts, same workflows.
- **Tickets** are shared — GitLab sync means anyone can create/assign/close.

## What Doesn't Sync (SQLite)

- Wire protocol session data
- Robin's chat history
- System wiki
- Resource policies
- RAM/session tracking

Each collaborator's local system is their own. The repo is the meeting point.

---

## Collaboration Flows

### Push your work
1. You work in a project, chat with agents, build code
2. Thread markdown accumulates in `threads/your-name/`
3. `git push` — your threads, wiki edits, and ticket changes go to remote

### Pull their work
1. `git pull` — their thread markdown appears in `threads/their-name/`
2. Their wiki edits merge with yours
3. Their tickets appear in your local issues view
4. You can browse their threads: what did they ask? What did the AI say?

### Browse someone's threads
1. Open a workspace, navigate to threads
2. See user folders: yours, theirs
3. Click a thread markdown — read-only view of their conversation
4. Link it, share it, reference it in a ticket

### Ticket handoff
1. Collaborator creates a GitLab issue, assigns to your bot
2. Next sync pulls it -> local ticket with `author: gitlab`
3. Your bot picks it up, runs, posts results as comments
4. Collaborator sees resolution on GitLab

---

## User Identity

Fallback chain: **Robin profile** (if set) > **git config user.name** > **"local"**

Git config is the default since it's on every dev machine. Robin profile overrides for users who want a different display name. Set once, used everywhere — thread folders, commit attribution, ticket authorship.

---

## Selective Sharing

- `.gitignore` your own threads if you want privacy
- Agent definitions and wiki are always shared (they're the project's intelligence)
- Tickets are always shared (they're the work queue)

---

## TODO

- [ ] Per-user thread folder creation on first chat
- [ ] Thread viewer (read-only for collaborator threads)
- [ ] Import flow (receive a .md thread file, index into DB)
- [ ] GitLab sync for tickets
- [ ] Conflict resolution for wiki (last-write-wins or merge?)
