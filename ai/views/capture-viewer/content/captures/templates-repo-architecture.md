# Templates Repo Architecture

## Concept

A single public repo (`open-robin/templates`) serves as the source of truth for view templates, connector scripts, and the system wiki. Local installs cache from this repo. AI agents can pull from it for reference. Community contributes via PRs.

## Repo Structure

```
open-robin/templates
├── scripts/
│   ├── connectors/        ← AppleScript bridges, API wrappers
│   ├── webhooks/          ← Zapier, n8n, IFTTT webhook templates
│   └── applescript/       ← Raw AppleScript samples by app
├── views/
│   ├── tiled-rows/        ← Canonical template + default content.json + settings
│   ├── navigation/
│   ├── columns/
│   ├── file-explorer/
│   ├── library/
│   ├── terminal/
│   ├── browser/
│   └── calendar/
└── (repo wiki)            ← System wiki pages (CLIs, Connectors, Secrets, etc.)
```

## The Repo Wiki IS the System Wiki

- GitHub/GitLab repo wikis are separate git repos (e.g., `open-robin/templates.wiki.git`)
- System wiki pages (CLIs.md, Connectors.md, Secrets.md, etc.) live there
- On install or sync, the wiki repo is pulled and parsed into `robin.db system_wiki` table
- Robin reads from the local DB cache (fast, no network needed)
- Updates flow: edit on GitHub → pull → update DB rows
- Eliminates manual maintenance of wiki content in migrations and update scripts

## What This Solves

- **Wiki maintenance** — Edit on GitHub, every install picks it up. No migration scripts.
- **View creation** — "Add a library viewer" pulls the canonical template from the repo.
- **AI self-reference** — Agent can diff local view against the repo template to see what changed.
- **Drift detection** — Compare local state to canonical to see user customizations vs stock.
- **Script library** — Browse, search, one-click install from a versioned, community-maintained collection.
- **Updates** — New template version? Pull and diff before applying. No forced overwrites.
- **Community** — PRs for new view types, new scripts, improved wiki content.

## Local Cache

`ai/system/templates/` becomes a local cache of the repo's `views/` directory.
`~/.open-robin/scripts/` becomes a local cache of the repo's `scripts/` directory.
`robin.db system_wiki` becomes a local cache of the repo wiki.

The repo is the source of truth. Local copies are for speed and offline access.

## Sync Pattern

Already have the pattern from wikiHooks.js:
1. Watch/pull a directory
2. Parse files (markdown → content + metadata)
3. Update database rows
4. Serve from database

Same pattern, different source: repo wiki instead of local folder.
