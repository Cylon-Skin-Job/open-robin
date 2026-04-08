# Script Distribution Model

## Concept

Scripts are stored in the SQLite database as a library of templates, samples, and community scripts. They flow from the library to the filesystem via one-click install. Agents access scripts through their folder structure. Symlinks grant cross-agent access without duplication.

## Architecture

```
robin.db (script library)
  → Sample scripts, templates, patterns
  → AI reads these for reference when writing new ones
  → "One-click install" copies from DB to filesystem

ai/views/{viewer}/settings/scripts/
  → Scripts available to this view's agents
  → Symlink scripts from other views or from the library
  → Agent sees what's in its folder, nothing more

ai/views/agents-viewer/System/{agent}/scripts/
  → Agent-specific scripts
  → Symlinked from view scripts or library
  → Orchestrator agent can point sub-agents at scripts in their folders
```

## Flow

1. **Library** (DB) has script templates and community scripts
2. **User browses** scripts in the Connectors tab or a scripts panel
3. **One-click install** drops it into the view's `settings/scripts/` folder
4. **Agent creation** propagates the folder structure — every agent gets a `scripts/` folder
5. **User symlinks** specific scripts into specific agent folders to grant access
6. **AI writing new scripts** reads the library for patterns and inspiration
7. **Orchestrator agent** can reference scripts in sub-agent folders when delegating tasks

## Why Symlinks

- One script serves multiple agents without duplication
- Removing access = deleting the symlink
- Agent's folder is its complete context — no hidden dependencies
- Server already resolves symlinks with security checks

## Reinforcement Pattern

When AI writes a new script, it can:
- Read the library for existing patterns and similar scripts
- Follow the established script contract (structured input → structured output)
- Submit the new script back to the library if the user approves
- The library grows organically from real usage
