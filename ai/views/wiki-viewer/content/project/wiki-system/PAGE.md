# Wiki System

Every project built with the kimi-claude IDE gets its own wiki workspace. Wiki pages live locally as markdown in topic folders and sync to GitLab for a browser-readable UI.

## How It Works

Each wiki topic is a folder inside `ai/workspaces/wiki/`. Every folder contains two files:

| File | Purpose |
|------|---------|
| `PAGE.md` | The published wiki page — syncs to GitLab |
| `LOG.md` | Append-only change trail (who, what, why, when) |

```
ai/workspaces/wiki/
├── SPEC.md              ← full specification
├── workspace.json       ← workspace metadata
├── .wiki-repo/          ← GitLab wiki git clone (gitignored)
├── home/
│   ├── PAGE.md          ← GitLab: "Home"
│   └── LOG.md
├── secrets/
│   ├── PAGE.md          ← GitLab: "Secrets"
│   └── LOG.md
└── {topic-name}/
    ├── PAGE.md
    └── LOG.md
```

## Page Conventions

- **Folder name** → GitLab slug. `secrets/` → `Secrets`, `wiki-system/` → `Wiki-System`
- **First `# heading`** in PAGE.md → page title in GitLab sidebar
- Use kebab-case folder names: `wiki-system`, not `wikiSystem`
- Link between pages: `[Secrets](Secrets)` (slug only, no `.md`)
- Override auto-casing with a `.slug` file (e.g., `gitlab/.slug` contains `GitLab`)

## Syncing to GitLab

```bash
./scripts/sync-wiki.sh "describe your changes"
```

Only `PAGE.md` files sync. `LOG.md` and other files stay local. GitLab sees clean wiki pages.

## Setup for a New Project

1. Create `ai/workspaces/wiki/` in the project
2. Clone the wiki repo:
   ```bash
   git clone https://gitlab.com/<namespace>/<project>.wiki.git ai/workspaces/wiki/.wiki-repo
   ```
3. Add `ai/workspaces/wiki/.wiki-repo/` to `.gitignore`
4. Create topic folders with PAGE.md and LOG.md
5. Run `./scripts/sync-wiki.sh "Initial wiki"`

## Why Local-First

- Edit wiki pages in the same IDE session as code
- Claude instances can read and write wiki pages directly
- Browse topic folders to see page + conversation + history together
- No context-switching to a browser
- Git history on all wiki changes
- Works offline — sync when ready
