# ai/system/ — Local system data

This folder is **created programmatically** by the server on startup. It holds runtime state that belongs to **this workspace** — not to the IDE codebase, not to a specific user, not to a remote service.

## What lives here

| File | Purpose |
|------|---------|
| `robin.db` | SQLite database (Knex + better-sqlite3). All persistent state: threads, exchanges, system config, wiki, themes, workspaces, CLI registry, and any future tables (clipboard, metadata, etc.). |
| `skills/` | Locally generated skill artifacts. |

## Scope: one workspace, one database

`robin.db` is **workspace-scoped**. The server calls `initDb(projectRoot)` on startup, which resolves to `{projectRoot}/ai/system/robin.db`. When the IDE opens a different project, that project gets its own `ai/system/robin.db` with its own migration history.

This is intentional:

- Chat history for project A stays with project A.
- Workspace themes, wiki pages, and config are per-project.
- Features like clipboard history live here too — they are contextual to the workspace session.

There is **no separate host-level database**. If a future Electron wrapper needs truly global data (surviving across workspaces without restart), `initDb` accepts a path — point it at an app-data directory instead. The Knex instance, migrations, and query modules do not change; only the caller decides the path.

## Git policy

**Do not commit this folder or its contents.** Add to `.gitignore`:

```
ai/system/
```

The SQLite file is binary, churns on every interaction, and may contain sensitive data (chat history, clipboard, secrets references). It is **not** a versionable artifact.

If you want to preserve state for disaster recovery or sharing, use **exports/backups** (e.g. JSON dumps, markdown snapshots) in a separate folder that you do commit — not the raw `.db` file.

## How the database is initialized

```
kimi-ide-server/lib/db.js
  initDb(projectRoot)
    → ensures ai/system/ exists (mkdirSync recursive)
    → opens robin.db with better-sqlite3
    → runs Knex migrations from lib/db/migrations/
    → returns singleton Knex instance
```

Server startup (`server.js`):
```js
initDb(getDefaultProjectRoot())  // path comes from config or fallback
```

Migrations are numbered (`001_initial.js`, `002_system_panel.js`, etc.) and run automatically on startup. Adding a new table = adding a new migration file. The schema self-heals: opening an old database against newer server code runs any missing migrations.

## Do not

- Move or rename `robin.db` while the server is running.
- Propose a "host-level" database unless the product explicitly requires cross-workspace persistence without server restart.
- Store secrets as plaintext in the database (use macOS Keychain via `lib/secrets.js`).
- Commit `*.db` files to Git.
