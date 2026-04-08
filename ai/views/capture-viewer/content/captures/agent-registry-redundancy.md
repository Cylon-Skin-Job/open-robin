# Agent Registry Redundancy: registry.json Should Not Exist

## Core Issue

`ai/views/agents-viewer/registry.json` hardcodes agent identity keys (`kimi-wiki`, `kimi-code`, `kimi-ops`) that map to folder paths (`System/wiki-manager`, `System/code-manager`, `System/ops-manager`). This defeats the purpose of the TRIGGERS.md system, which is designed to be self-describing and folder-driven.

## Current State

### registry.json (the problem)

```json
{
  "version": "1.0",
  "agents": {
    "kimi-wiki": {
      "folder": "System/wiki-manager",
      "status": "idle"
    },
    "kimi-code": {
      "folder": "System/code-manager",
      "status": "idle"
    },
    "kimi-ops": {
      "folder": "System/ops-manager",
      "status": "idle"
    }
  }
}
```

### TriggerLoader has TWO passes (the evidence)

**Pass 1** (`trigger-loader.js:124-141`): Iterates `registry.json` entries. Uses hardcoded `botName` keys to map to folders. Requires manual maintenance. Names are arbitrary strings decoupled from folder structure.

**Pass 2** (`trigger-loader.js:143-165`): Scans `ai/views/` and `ai/components/` recursively, finds TRIGGERS.md files, and derives the assignee from the folder name via `deriveAssignee()`. No registry needed. Self-describing. Folder name IS the identity.

Pass 2 already does what Pass 1 should be doing. The registry is redundant infrastructure.

## Why This Matters

1. **Hardcoded names create rename churn.** The `kimi-` prefix in agent IDs is a project-name artifact. If we rename these to `robin-*`, we're just creating the same problem for the next rename. The folder name should be the identity.

2. **Defeats the TRIGGERS.md paradigm.** The entire trigger system is designed so that dropping a TRIGGERS.md file into a folder is sufficient to register an agent. The registry adds a second registration step that shouldn't exist.

3. **Client coupling.** `TicketBoard.tsx` hardcodes `BOT_NAMES = new Set(['kimi-wiki', 'kimi-code', 'kimi-review', 'kimi-bot'])` to match registry keys. If agents were folder-derived, the client could receive agent names dynamically.

4. **Adding a new agent requires editing two places** (create folder with TRIGGERS.md + add entry to registry.json) instead of one (just create the folder).

## Proposed Fix

### 1. Delete registry.json

Remove `ai/views/agents-viewer/registry.json` entirely.

### 2. Unify TriggerLoader to scan-only

Modify `loadTriggers()` in `trigger-loader.js` to:
- Drop the `registry` parameter
- Scan `ai/views/agents-viewer/` the same way Pass 2 scans `ai/views/` — recursively find TRIGGERS.md files
- Derive assignee from folder name using `deriveAssignee()` (already implemented)
- Agent identity = folder name: `wiki-manager`, `code-manager`, `ops-manager`

### 3. Update client BOT_NAMES

Change `TicketBoard.tsx` to either:
- Receive bot names from the server (derived from folder scan) — preferred
- Or hardcode folder-derived names: `['wiki-manager', 'code-manager', 'ops-manager']`

### 4. Update ticket assignee references

Existing tickets assigned to `kimi-wiki` etc. will need their assignee fields updated to match new folder-derived names. This is a data migration in the issues-viewer markdown files.

## Files Affected

| File | Change |
|------|--------|
| `ai/views/agents-viewer/registry.json` | Delete |
| `kimi-ide-server/lib/triggers/trigger-loader.js` | Remove Pass 1, remove `registry` parameter |
| `kimi-ide-server/lib/runner/run-folder.js` | Check if it reads registry.json |
| `kimi-ide-client/src/components/tickets/TicketBoard.tsx` | Update BOT_NAMES |
| `kimi-ide-server/lib/tickets/dispatch.js` | Check if it reads registry.json |
| Callers of `loadTriggers()` | Remove registry parameter |
| Existing ticket .md files | Update assignee fields |

## Discovered During

Rename audit (Kimi Claude -> Open Robin), 2026-04-06. The question "should we rename kimi-wiki to robin-wiki?" revealed that these names shouldn't be hardcoded at all.

## Status

**Deferred to next session.** Bypass for current rename — do not rename agent IDs, fix the architecture instead.
