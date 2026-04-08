---
title: Phase 0 — Stabilize What Exists
created: 2026-03-28
status: active
parent: ROADMAP.md
---

# Phase 0: Stabilize What Exists

Fix bugs, rename files, expand SESSION.md, populate triggers. No new features — just get the existing system clean and consistent.

**Prerequisites:** None. Can start immediately.
**Parallel with:** Phase 1 and Phase 2 (no dependencies between them).

---

## Context for This Session

### Project Location
`/Users/rccurtrightjr./projects/kimi-claude`

### What This Phase Does
1. Fix 3 known bugs (workspace loading, chat bubble double-render, parser stall)
2. Rename PROMPT.md → PROMPT.md across 10 files (17 references mapped below)
3. Expand SESSION.md frontmatter to include tool permissions, DB access scoping, and CLI profile fields
4. Write TRIGGERS.md content for code-manager and ops-manager agents

### Key Architecture Decisions (already made)
- **PROMPT.md** is the universal file name — agent root (identity), workflow folder (instructions), chat folder (chat persona). Same name, context determines meaning.
- **SESSION.md** is the single permission surface — tools, DB access, CLI profile, session behavior. All in one file's YAML frontmatter.
- **DB is invisible to agents** — agents never query SQLite directly. They use skills (node scripts) or read markdown files.
- **Prompt-based trust** — SESSION.md tells the agent its boundaries in the system context. Server bounces restricted tool calls.

### Key Files
- `kimi-ide-server/lib/session/session-loader.js` — parses SESSION.md
- `kimi-ide-client/src/state/agentStore.ts` — AGENT_CONFIG_FILES array
- `kimi-ide-client/src/components/agents/AgentTiles.tsx` — FILE_ICONS map
- `kimi-ide-client/src/components/agents/PromptCardView.tsx` — configNames filter
- `ai/views/agents-viewer/System/*/SESSION.md` — 3 agent session configs
- `ai/views/agents-viewer/System/*/PROMPT.md` — 3 files to rename

---

## 0.1 Fix Known Bugs

### Workspace Loading Bug
Wiki, Agents, Issues, Skills workspaces stuck on "Loading".
- [ ] Diagnose: is it a WebSocket message not being sent, a client-side routing issue, or a data loading failure?
- [ ] Fix and verify all workspaces render

### Chat Bubble Double-Render
User chat bubble renders twice on refresh.
- [ ] Trace the render path on refresh
- [ ] Fix duplicate mount

### Line-Break Parser Stall
Tool segments using line-break parser won't emit a chunk until `\n` arrives. Slow-streaming thinking content stalls.
- [ ] Add timeout fallback: release partial content after N ms with no boundary
- [ ] Test with slow-streaming thinking content

---

## 0.2 Rename PROMPT.md → PROMPT.md

17 references across 10 files. Mechanical rename.

### Code Changes (4 files)

| File | Line | Current | Change to |
|------|------|---------|-----------|
| `kimi-ide-server/lib/session/session-loader.js` | 46 | `['PROMPT.md', 'MEMORY.md']` (JSDoc example) | `['PROMPT.md', 'MEMORY.md']` |
| `kimi-ide-client/src/state/agentStore.ts` | 24 | `'PROMPT.md',` | `'PROMPT.md',` |
| `kimi-ide-client/src/components/agents/PromptCardView.tsx` | 120 | `'IDENTITY'` in configNames array | `'PROMPT'` |
| `kimi-ide-client/src/components/agents/AgentTiles.tsx` | 68 | `'PROMPT.md': 'badge',` | `'PROMPT.md': 'badge',` |

### Session Config Changes (3 files)

| File | Line | Change |
|------|------|--------|
| `ai/views/agents-viewer/System/code-manager/SESSION.md` | 5 | `system-context: ["PROMPT.md", "MEMORY.md"]` |
| `ai/views/agents-viewer/System/ops-manager/SESSION.md` | 5 | `system-context: ["PROMPT.md", "MEMORY.md"]` |
| `ai/views/agents-viewer/System/wiki-manager/SESSION.md` | 5 | `system-context: ["PROMPT.md", "MEMORY.md"]` |

### File Renames (3 files)

```bash
mv ai/views/agents-viewer/System/code-manager/PROMPT.md ai/views/agents-viewer/System/code-manager/PROMPT.md
mv ai/views/agents-viewer/System/ops-manager/PROMPT.md ai/views/agents-viewer/System/ops-manager/PROMPT.md
mv ai/views/agents-viewer/System/wiki-manager/PROMPT.md ai/views/agents-viewer/System/wiki-manager/PROMPT.md
```

### Wiki Page Updates (10 references across 3 files)

| File | Lines | Action |
|------|-------|--------|
| `ai/wiki-data/system/setup/PAGE.md` | 40, 53, 143 | Replace PROMPT.md with PROMPT.md |
| `ai/wiki-data/system/panel-rename/PAGE.md` | 84, 170 | Replace PROMPT.md with PROMPT.md |
| `ai/wiki-data/system/agent-folder-structure/PAGE.md` | 73, 88, 138, 183, 201, 286, 324, 339 | Replace PROMPT.md with PROMPT.md, update section header "PROMPT.md — Who the Agent Is" → "PROMPT.md — Who the Agent Is" |

### Verification
- [ ] `grep -r "IDENTITY" --include="*.js" --include="*.ts" --include="*.tsx" --include="*.md" ai/ kimi-ide-server/ kimi-ide-client/src/` returns zero matches (excluding .claude/worktrees/)
- [ ] All 3 agents load correctly with PROMPT.md in system-context
- [ ] Agent detail Settings tab shows PROMPT.md in sidebar

---

## 0.3 SESSION.md Expansion

Extend the SESSION.md frontmatter to absorb TOOLS.md and add CLI profile + DB access.

### Current SESSION.md Format
```yaml
---
thread-model: daily-rolling
session-invalidation: memory-mtime
idle-timeout: 9m
system-context: ["PROMPT.md", "MEMORY.md"]
---
```

### Target SESSION.md Format
```yaml
---
thread-model: daily-rolling
session-invalidation: memory-mtime
idle-timeout: 9m
system-context: ["PROMPT.md", "MEMORY.md"]

# CLI profile
cli: kimi
profile: default
model: claude-sonnet-4-6
endpoint: https://api.anthropic.com/v1/messages

# Tool permissions
tools:
  allowed: [read_file, glob, grep, git_log, git_diff, git_show, list_directory, todo_read, todo_write]
  restricted:
    write_file: ["ai/wiki-data/project/**", "ai/views/wiki-viewer/runs/**"]
    edit_file: ["ai/wiki-data/project/**"]
  denied: [shell_exec, git_commit, git_push]

# DB access
db:
  read: [tickets, wiki_topics, chat_history]
  write: [tickets]
  denied: [system_config, secrets]
---
```

### Implementation Steps

1. **Extend session-loader.js** `parseSessionConfig()`:
   - [ ] Parse `cli`, `profile`, `model`, `endpoint` fields
   - [ ] Parse `tools: { allowed, restricted, denied }` object
   - [ ] Parse `db: { read, write, denied }` object
   - [ ] Return all fields from `parseSessionConfig()` (backward compatible — missing fields return defaults)

2. **Update 3 agent SESSION.md files** with tool permissions:
   - [ ] wiki-manager: migrate from standalone TOOLS.md content
   - [ ] code-manager: define appropriate read/write scope
   - [ ] ops-manager: define appropriate read/write scope

3. **Delete standalone TOOLS.md**:
   - [ ] Remove `ai/views/wiki-viewer/TOOLS.md` (content now in SESSION.md)

4. **Verification**:
   - [ ] `parseSessionConfig()` returns all new fields
   - [ ] Missing fields return sensible defaults (no breaking changes)
   - [ ] Existing session loading still works (backward compatible)

**Note:** Server-side enforcement of tool/DB permissions is Phase 3, not Phase 0. This phase just gets the config into SESSION.md and parseable.

---

## 0.4 Populate Missing Triggers

### code-manager TRIGGERS.md

```yaml
---
name: source-file-change
type: file-change
events: [modify, create, delete]
match: "kimi-ide-server/lib/**/*.js"
exclude: ["ai/views/**"]
prompt: PROMPT.md
message: |
  Server source changed: {{filePath}} ({{event}})
---

---
name: client-source-change
type: file-change
events: [modify, create, delete]
match: "kimi-ide-client/src/**/*.ts"
exclude: ["kimi-ide-client/src/**/*.test.ts"]
prompt: PROMPT.md
message: |
  Client source changed: {{filePath}} ({{event}})
---

---
name: weekly-test-scan
type: cron
schedule: "0 6 * * 1"
prompt: PROMPT.md
message: |
  Weekly test coverage scan. Check for untested code paths.
---
```

### ops-manager TRIGGERS.md

```yaml
---
name: dependency-change
type: file-change
events: [modify]
match: "*/package.json"
prompt: PROMPT.md
message: |
  Package manifest changed: {{filePath}}
---

---
name: weekly-audit
type: cron
schedule: "0 6 * * 1"
prompt: PROMPT.md
message: |
  Weekly dependency audit. Check for vulnerabilities and outdated packages.
---
```

### Steps
- [ ] Write code-manager TRIGGERS.md
- [ ] Write ops-manager TRIGGERS.md
- [ ] Verify trigger-loader picks them up on server restart
- [ ] Verify cron-scheduler registers the cron jobs

---

## Issues / Discussion Points

### Backward Compatibility of SESSION.md
The parser must handle both old format (4 fields) and new format (4 + cli + tools + db). `parseSessionConfig()` should return defaults for any missing field. No breaking changes.

### PROMPT.md Name Collision — Resolved
Agent root has PROMPT.md (identity) and each workflow now has WORKFLOW.md (instructions). The rename from workflow PROMPT.md to WORKFLOW.md eliminates the name collision entirely. PROMPT.md is only the agent identity file at the root level. WORKFLOW.md is the workflow instruction file inside `workflows/*/`. No ambiguity.

### Tool Permissions — Trust vs Enforcement
Phase 0 parses the config. Phase 3 enforces it. In between, tool permissions are advisory — the agent could still call denied tools. This is acceptable for now since agents are internally controlled. Document this gap.

---

## Completion Criteria

- [ ] All 3 known bugs fixed
- [ ] Zero references to PROMPT.md in main project tree
- [ ] SESSION.md parses all new fields without breaking existing behavior
- [ ] All 3 agents have populated TRIGGERS.md
- [ ] Server starts cleanly, all workspaces load
