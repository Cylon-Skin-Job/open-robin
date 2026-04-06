# SQLite: system layer and clipboard

**Current server code:** `kimi-ide-server/lib/db.js` opens **`{projectRoot}/ai/system/robin.db`** (Knex + better-sqlite3, migrations under `lib/db/migrations/`). All persistent state lives in this one file: threads, exchanges, system_config, system_wiki, system_theme, system_tabs, workspaces, workspace_themes, cli_registry, and any future tables.

See **`ai/system/README.md`** for scope, git policy, and the Electron migration path.

---

## 1. Architecture: one DB, workspace-scoped

There is **one** SQLite file per workspace: `{projectRoot}/ai/system/robin.db`. The server runs one Node process per project; `initDb(projectRoot)` receives the path and creates `ai/system/` if missing.

There is **no host-level database**. New features (clipboard, metadata, etc.) are added as tables to this same file via Knex migrations. When the app wraps in Electron, only the caller of `initDb` changes — the Knex layer, migrations, and queries stay unchanged.

---

## 2. Schema organization

Two strategies for new data, used together:

- **Dedicated tables** for structured, row-heavy, query-heavy domains (clipboard, threads, etc.). These get their own columns, indexes, and pagination.
- **`system_config`** (existing key/value table) for low-volume flags and settings that don't need their own table.

When adding a table, put it in the next numbered migration (`005_clipboard.js`, etc.). Follow the existing pattern: `exports.up` / `exports.down`, receive `knex`, create/seed/drop.

---

## 3. Clipboard table

**Retention:** Cap at **500** rows by `last_used_at`; prune oldest on insert past cap.

**RAM / UI:** Client holds **30–50** items in memory for the popover; **"See more"** fetches the next page from the server.

**Suggested schema:**

| Column | Notes |
|--------|--------|
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT |
| `text` | Full payload (consider rejecting or truncating above 1MB) |
| `type` | `link` \| `text` \| `code` \| `icon` \| `emoji` \| `contents` \| `context` \| `unknown` |
| `preview` | Denormalized one-line preview for list UI |
| `content_hash` | SHA-256 of `text` for dedup (unique constraint or app-level) |
| `created_at` | INTEGER — first time seen (ms timestamp) |
| `last_used_at` | INTEGER — MRU sort key; updated on re-copy |
| `source` | Optional: `manual` \| `api` \| `file_viewer` |

**Indexes:** `(last_used_at DESC)` for listing; `(content_hash)` for dedup.

**Dedupe:** On insert, check `content_hash`. If duplicate exists, update its `last_used_at` instead of inserting a new row — same MRU behavior as the Fusion implementation.

---

## 4. API shape (client <-> server)

Clipboard uses **dedicated WS message types**, not the Kimi wire `switch`:

| Message | Direction | Payload |
|---------|-----------|---------|
| `clipboard:list` | client -> server | `{ offset, limit }` |
| `clipboard:list` | server -> client | `{ items[], total }` |
| `clipboard:append` | client -> server | `{ text, type }` (server generates preview, hash, timestamps) |
| `clipboard:touch` | client -> server | `{ id }` (bump `last_used_at` on re-copy from history) |
| `clipboard:clear` | client -> server | `{}` (truncate table) |

The client `clipboard-api` module sends these; the RAM cache merges responses.

---

## 5. Client memory model

| Layer | Holds |
|-------|--------|
| **SQLite (robin.db)** | Authoritative history (hundreds of rows), MRU order |
| **In-memory window** | Last 30–50 rows for fast keyboard nav and render |
| **Pagination** | Fetch older chunks on demand; "See more" in popover footer |

Selection index and the CLOSED/PREVIEW/LOCKED/LEAVING popover state machine stay in `interaction-controller` / small store. List fetch is one call: `clipboardRepository.listPage()`.

---

## 6. Security / size

- Clipboard may contain secrets. The DB file should have normal user-data permissions (same as keychain-adjacent config). `ai/system/` is `.gitignore`d.
- Reject or truncate payloads above a size cap (e.g. 1MB) with a `truncated` flag, so a single accidental paste doesn't balloon the DB.

---

## 7. Electron-era layout (git, system folder, backups)

| Path | Role |
|------|------|
| `ai/system/` | System data — SQLite and local IDE state. Created programmatically by the app. `.gitignore`d. |
| `ai/views/` | View/panel assets — optional subrepo or template. |

**Policy:**
- Do not commit `*.db` files to Git — they churn, conflict, and may contain sensitive data.
- Use a **backup folder** with versioned exports (JSON, markdown snapshots) for GitHub — not the raw database file.

---

*Aligns with `docs/CLIPBOARD_INTEGRATION_ARCHITECTURE.md`, `docs/CLIPBOARD_MANAGER_SPEC.md`, and `ai/system/README.md`.*
