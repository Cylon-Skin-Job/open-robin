# Multi-Repo Workspace Architecture

## Problem Statement

The IDE currently assumes a single repo context — the cwd where the backend runs. To be useful as a daily driver, users need to switch between projects seamlessly, with each project maintaining its own threads, settings, and state. This is analogous to how Cursor/VS Code treats each project as an isolated workspace.

---

## Design Principles

1. **Repo is the top-level organizational unit** — everything (threads, tabs, settings, mode preferences) lives under a repo context
2. **Per-repo config lives in the repo** — a `.kimi-ide/` folder in each repo is the source of truth for repo-specific configuration
3. **Backend manages the registry** — a lightweight index of known repos so the UI can present them without scanning the filesystem
4. **Threads are repo-scoped** — switching repos swaps the entire thread list; no cross-repo thread mixing
5. **No lock-in** — the `.kimi-ide/` folder is self-contained and portable; deleting it doesn't break the repo, just loses IDE config

---

## Core Concepts

### Workspace

A **workspace** = one git repo + its `.kimi-ide/` config + all associated threads/state. The user is always "in" exactly one workspace. Switching workspaces is a full context switch.

### Repo Registry

A backend-maintained index of all known repos. Stored in Firestore (or a local JSON file on the backend). Contains just enough to populate the menu:

```javascript
// Firestore: users/{userId}/repos/{repoId}
{
  name: "kimi-claude",                    // Display name (editable)
  path: "/Users/you/projects/kimi-claude", // Absolute path on backend machine
  remote_url: "git@github.com:user/kimi-claude.git", // For identity/dedup
  added_at: Timestamp,
  last_accessed: Timestamp,
  pinned: false,                          // Pin to top of menu
}
```

**Why `remote_url`?** Two clones of the same repo at different paths are the same logical project. The remote URL is the canonical identity. This prevents duplicates and enables future features like syncing config across machines.

### `.kimi-ide/` Folder

Lives in the repo root. Committed or `.gitignore`'d — user's choice.

```
.kimi-ide/
├── config.json          # Repo-specific settings
├── context.md           # Persistent context/instructions for this repo
└── .gitkeep
```

**`config.json`:**
```javascript
{
  "display_name": "Kimi Claude IDE",      // Override for menu display
  "default_mode": "vibe",                 // Default mode when opening this repo
  "kimi_flags": [],                       // Extra CLI flags for this repo
  "auto_yolo": true,                      // Override yolo behavior per repo
  "ignore_patterns": [],                  // Files to exclude from context
}
```

**`context.md`:**
Free-form markdown that gets injected into every new thread's initial prompt for this repo. Think of it as a repo-level system prompt — project conventions, architecture notes, "always use TypeScript", etc.

---

## Firestore Schema Evolution

### Current (Single Repo)
```
users/{userId}/threads/{threadId}/messages/{messageId}
```

### Proposed (Multi Repo)
```
users/{userId}/repos/{repoId}                          ← Repo registry
users/{userId}/repos/{repoId}/threads/{threadId}       ← Threads scoped to repo
users/{userId}/repos/{repoId}/threads/{threadId}/messages/{messageId}
```

**`repoId` generation:** Deterministic hash of `remote_url` (normalized). For local-only repos with no remote, hash the absolute path as fallback, with a flag indicating it's path-based (fragile).

### Thread Document (Updated)
```javascript
{
  title: "string",
  created_at: Timestamp,
  last_modified: Timestamp,
  session_alive: boolean,
  mode: "riff" | "vibe" | "plan",
  repo_id: "string",                     // Denormalized for queries
  metadata: {
    open_tabs: [...],
    active_tab_index: number,
    pipeline_state: {...},
    branch: "string",                     // Git branch when thread was active
  }
}
```

---

## UI: Repo Switcher

### Menu Button (Hamburger `≡`)

The existing stubbed menu button becomes the workspace switcher:

```
┌──────────────────────────┐
│  ★ kimi-claude        ← │  ← Current (highlighted)
│  ─────────────────────── │
│    raven-os              │
│    launchpad             │
│    personal-site         │
│  ─────────────────────── │
│  + Add Repository...     │
│    Settings              │
└──────────────────────────┘
```

**Behaviors:**
- Current repo shown at top with indicator
- Recent repos sorted by `last_accessed`
- Pinned repos float to top
- "Add Repository" opens a path input (backend validates it's a git repo)
- Switching repos triggers a full workspace swap (thread list, tabs, mode, header title all change)

### Header Update

```
[≡]  kimi-claude  (main)              [VIBE] [icons]
      ^^^^^^^^^    ^^^^
      repo name    current branch
```

The project name in the header now reflects the active workspace. Optionally show the current git branch.

---

## Backend: Workspace Manager

### New Module: `WorkspaceManager`

Responsible for:
1. **Registry CRUD** — add/remove/list repos
2. **Workspace switching** — update active workspace, notify frontend
3. **Path validation** — confirm path exists and is a git repo
4. **Config loading** — read `.kimi-ide/config.json` from the active repo
5. **Context injection** — read `.kimi-ide/context.md` and prepend to new threads

### Wire Process Spawning (Updated)

Currently: `spawn('kimi', ['--wire', '--yolo'])`

After: `spawn('kimi', ['--wire', '--yolo', ...repoConfig.kimi_flags], { cwd: repo.path })`

The `cwd` is the critical change — each wire process runs in the context of the active repo.

### Active Threads Across Repos

When switching repos, existing wire processes from the previous repo **keep running** in the background. They don't get killed. The frontend just stops showing them. When switching back, they reconnect.

This means the backend must track: `{ threadId → { repoId, wireProcess, alive } }`

---

## Edge Cases & Gotchas

### 1. Repo Moved or Deleted
- **Detection:** Backend checks path existence when loading workspace
- **Handling:** Show "Repository not found" state with option to re-locate or remove
- **Firestore data:** Preserved (keyed by repoId, not path). User can re-link.

### 2. Same Repo, Multiple Clones
- **Detection:** Same `remote_url`, different `path`
- **Handling:** Treat as separate workspaces (different working copies may have different branches/state). Warn user they have duplicates. Let them merge or keep separate.

### 3. Repo Renamed (Folder)
- Same as "Repo Moved" — path breaks, repoId (based on remote) survives.

### 4. No Remote URL (Local-Only Repo)
- Fall back to path-based repoId
- Warn user: "This workspace is tied to its current path. Moving the folder will disconnect it."
- Store a flag: `identity_source: "path" | "remote"`

### 5. Active Threads on Workspace Switch
- Wire processes keep running in background
- Thread list swaps to new repo
- Notification badge if a background thread in another repo needs attention (future feature)

### 6. `.kimi-ide/` Folder Missing
- First time opening a repo in the IDE: auto-create `.kimi-ide/` with defaults
- Prompt: "Initialize workspace config for this repository?"
- Or silently create with sensible defaults (less friction)

### 7. Config Conflicts (Multiple Users)
- If `.kimi-ide/` is committed, multiple users could have conflicting settings
- Recommendation: `.gitignore` the folder by default
- Offer a `.kimi-ide/shared/` subfolder for team-shared config (context.md, conventions) vs `.kimi-ide/local/` for personal settings
- This is a v2 concern — start with single-user assumption

### 8. Firestore Quota / Data Growth
- Each repo adds a collection layer
- Threads accumulate per repo over time
- Future: archive old threads, configurable retention

### 9. Backend Restart
- On restart, re-read repo registry from Firestore
- Wire processes are gone (they were child processes) — mark all threads as dead
- User can replay from `wire.jsonl` to restore sessions

### 10. Branch Awareness
- Store active branch when thread was created/last active
- When switching back to a workspace, show if branch has changed
- Future: thread-per-branch workflows (v2+)

---

## What Lives Where

| Data | Location | Why |
|------|----------|-----|
| Repo registry (list of repos) | Firestore `users/{userId}/repos/` | Survives backend restart, accessible from any frontend |
| Repo config (settings, flags) | `.kimi-ide/config.json` in repo | Portable, version-controllable, repo-specific |
| Repo context (system prompt) | `.kimi-ide/context.md` in repo | Same as above |
| Thread list + messages | Firestore under `repos/{repoId}/threads/` | Persistent, real-time sync |
| Active wire processes | Backend memory | Ephemeral by nature |
| Wire session logs | `~/.kimi/sessions/` (local) | Kimi CLI manages this |
| Tab state per thread | Firestore thread metadata | Persists across refreshes |
| Last active workspace | Firestore user preferences | Resume where you left off |

---

## Implementation Phases

### Phase A: Repo Registry + Switcher UI
- Add repo registry to Firestore schema
- Build workspace switcher dropdown (menu button)
- "Add Repository" flow (path input → validate → register)
- Update header to show repo name
- Backend: `WorkspaceManager` module with CRUD

### Phase B: Scoped Threads
- Migrate Firestore schema to nest threads under repos
- Thread list filters by active repo
- Wire process spawning uses `cwd: repo.path`
- "New Chat" creates thread under active repo

### Phase C: Per-Repo Config
- Create `.kimi-ide/` on first open
- Read `config.json` on workspace load
- Apply repo-specific settings (default mode, kimi flags)
- Inject `context.md` into new thread prompts

### Phase D: Polish + Edge Cases
- Handle missing/moved repos gracefully
- Background thread indicators
- Branch display in header
- "Last accessed" sorting in switcher

---

## Future Expansion Hooks

These aren't planned yet, but the architecture should not prevent them:

1. **Per-branch threads** — Associate threads with git branches, auto-switch thread context on branch change
2. **Repo templates** — Starter `.kimi-ide/` configs for different project types (React, Python, etc.)
3. **Team workspaces** — Shared repos where multiple users see the same thread history
4. **Cross-repo context** — "Reference the auth module from repo X in this conversation"
5. **Repo health dashboard** — CI status, open PRs, test coverage per workspace
6. **Auto-discovery** — Scan `~/projects/` and auto-register repos
7. **Remote repos** — Clone and work with repos not on the local machine (cloud workspaces)
8. **Workspace groups** — Group related repos (frontend + backend + shared libs)

---

## Open Questions

1. **Should `.kimi-ide/` be in `.gitignore` by default?**
   - Pro: No config conflicts between users
   - Con: Lose repo-specific context on fresh clone
   - Middle ground: `.kimi-ide/context.md` committed, rest gitignored

2. **One backend process or many?**
   - Current design: single Node server handles all repos
   - Alternative: separate backend per repo (heavier, more isolated)
   - Recommendation: single server, multiple workspaces

3. **Should workspace switch kill or pause threads?**
   - Recommendation: keep running in background (kill is destructive)
   - But what about resource limits with many repos open?

4. **How do we handle the first-run experience?**
   - User opens IDE with no repos registered
   - Auto-detect cwd? Prompt to add? Empty state with big "Add Repository" button?

5. **Repo identity: remote URL vs path vs user-assigned ID?**
   - Remote URL is most stable but not always available
   - Path is always available but fragile
   - User-assigned is flexible but manual
   - Recommendation: remote URL primary, path fallback, user can rename display name

---

*Last Updated: 2026-03-06*
