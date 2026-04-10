# SPEC-26a — Dual Chat Data Model (project_id + scope + view_id)

**Parent:** SPEC-26 (dual chat paradigm — left = project-scoped, right = view-scoped, per-view)
**Position:** Phase 1 of 4 in the 26 series. Foundation — schema migration + ThreadIndex rewrite. The later phases add the actual dual-chat routing (26b), the client state + layout (26c), and the chat header + harness wizard (26d).
**Depends on:**
- All of 24x committed (through `8e265cc` SPEC-24f)
- SQLite is healthy, `threads` table exists, `exchanges` table exists with FK to `threads.thread_id`
**Model recommendation:** **Opus 4.6** or equivalent. SQLite table rebuild + column rename + data wipe + index rebuild + orphan cleanup is high-stakes work where a partial run can corrupt the DB. Strong preference for a careful model here.
**Estimated blast radius:** **Medium.** Touches a live SQLite table that other subsystems (wiki, system_wiki, workspaces, etc.) share. The migration uses the same transaction-disabled + PRAGMA toggle pattern as migration 007, which is known to work on this DB. Behavioral risk is low because ThreadIndex updates keep existing single-scope behavior (every thread still acts as view-scoped); the dual-scope routing waits for 26b.

---

## Your mission

Lay down the data model that will support the dual-chat paradigm. The mission is explicitly NOT to build the dual chat itself — that's 26b+. Mission here:

1. **Migration 008** — schema change for multi-project + multi-scope threads:
   - Add `project_id TEXT NOT NULL` column
   - Add `scope TEXT NOT NULL` column with values `'project'` | `'view'`
   - Rename `panel_id` → `view_id` (and drop its NOT NULL — project threads will have NULL here)
   - Drop the dead `date` column left over from 24d
   - Drop the `threads_date_index` (references the dead column)
   - Drop the `threads_panel_id_index` (we're adding a composite index that replaces it)
   - Add `threads_project_scope_view_idx` composite index on `(project_id, scope, view_id)`
   - Wipe existing `threads` rows (pre-prod, consistent with all prior specs in this project)
   - One-time orphan cleanup: `DELETE FROM exchanges WHERE thread_id NOT IN (SELECT thread_id FROM threads)` — purges the 22+ orphans from earlier CLI-based validation wipes
   - Uses the same `transaction: false` + `PRAGMA foreign_keys = OFF/ON` pattern as migration 007

2. **ThreadIndex rewrite** — take `(projectId, scope, viewId)` instead of just `(panelId)`:
   - Constructor stores all three
   - `list()` filters by `project_id`, then by `scope`, then by `view_id` (if scope === 'view')
   - `create()` inserts with the new columns; `view_id` is the view name for view scope, `NULL` for project scope
   - `_toEntry()` passes through `scope` and `view_id` so downstream code can see them
   - All existing methods (`get`, `update`, `rename`, `activate`, etc.) stay with their current signatures

3. **ThreadManager bridge** — derive the three scoping fields for the existing caller:
   - Constructor accepts `config.projectRoot` (already passed today)
   - Derives `projectId = path.basename(projectRoot)` (per your answer to Q1: "project folder name")
   - Constructs its `ThreadIndex` with `(projectId, 'view', panelId)` — hardcoded scope='view' in 26a so current behavior is preserved
   - When 26b lands, ThreadManager will be split into project-scoped and view-scoped variants (or one class with scope branching); 26a sets it up for that split without doing it.

4. **Clean up the `setDate` / `date` residue** in ThreadIndex:
   - The `date` column is being dropped. ThreadIndex should no longer reference it in `update()` (already cleaned up in 24d's inline pass) or `_toEntry()` (also cleaned). Verify both are clean and no new references exist.
   - The `threads_date_index` gets dropped in the migration automatically via `dropIndex`.

**After this phase:**
- New `threads` schema: `(thread_id, project_id, scope, view_id, name, created_at, resumed_at, message_count, status, updated_at, harness_id, harness_config)`.
- All existing behavior preserved: every new thread created through the current flow is scope='view', view_id = the current panel name, project_id = basename(projectRoot).
- Each panel's sidebar still shows only its own threads (same experience as today, because scope='view' everywhere).
- SQLite is ready for 26b to start creating scope='project' threads alongside scope='view' threads.
- The 22 orphaned `exchanges` rows are gone.
- Smoke test still passes (47/0).

**You are not touching:**
- Dual chat UI, layout, routing, or state management — all of that is 26b/26c/26d
- `ThreadWebSocketHandler.setPanel()` signature or `getThreadManager()` cache key — no changes in 26a
- Wire protocol — `thread:open-assistant`, `thread:list`, etc. stay identical
- `ChatFile.js` / `ChatHeader` / layout components — zero client changes
- `_getViewsDir()` — 26b will make it scope-aware; in 26a it still returns the single unified path from SPEC-24c
- `lib/views/index.js resolveChatConfig` — unchanged
- Knex pool config (`pool.afterCreate` already sets foreign_keys=ON, confirmed working at runtime)
- Agent prompts / workflows — saved feedback says don't audit
- CSS architecture migration — separate future spec

---

## Context before you touch code

Read these in order:

1. **`ai/views/wiki-viewer/content/enforcement/code-standards/PAGE.md`** — house rules.
2. **`ai/views/capture-viewer/content/todo/specs/24-chat-simplification.md`** — parent of the 24x series (note that 24x is DONE as of commit 8e265cc).
3. **`open-robin-server/lib/db.js`** — the knex config. Note the `pool.afterCreate` hook sets `PRAGMA foreign_keys = ON` (lines 28-33). This is confirmed working — no change needed here in 26a.
4. **`open-robin-server/lib/db/migrations/007_thread_name_nullable.js`** — the precedent for `transaction: false` + PRAGMA foreign_keys OFF/ON around a table-rebuild alter. Your migration 008 follows the same pattern.
5. **`open-robin-server/lib/thread/ThreadIndex.js`** (all 200+ lines) — the file you rewrite the most.
6. **`open-robin-server/lib/thread/ThreadManager.js`** (lines 22-52 constructor, plus any call sites that construct ThreadIndex) — the bridge layer.
7. **`open-robin-server/lib/thread/ThreadWebSocketHandler.js`** (lines 29-74 — getThreadManager + setPanel) — verify unchanged; no edits needed in 26a.

### Line-number drift verification

```bash
cd /Users/rccurtrightjr./projects/open-robin/open-robin-server
wc -l lib/thread/ThreadIndex.js lib/thread/ThreadManager.js lib/db.js
```

Expected (±5 lines):
- `ThreadIndex.js` ≈ 200
- `ThreadManager.js` ≈ 365
- `db.js` ≈ 65

### Pre-flight — current SQLite state

Confirm the starting schema:
```bash
sqlite3 /Users/rccurtrightjr./projects/open-robin/ai/system/robin.db ".schema threads"
```

Expected (the current shape):
```sql
CREATE TABLE IF NOT EXISTS "threads" (
  thread_id text,
  panel_id text NOT NULL,
  name text,
  created_at text NOT NULL,
  resumed_at text,
  message_count integer NOT NULL DEFAULT '0',
  status text NOT NULL DEFAULT 'suspended',
  date text,
  updated_at integer NOT NULL DEFAULT '0',
  harness_id text DEFAULT 'kimi',
  harness_config text,
  PRIMARY KEY (thread_id)
);
CREATE INDEX threads_panel_id_index ON threads(panel_id);
CREATE INDEX threads_date_index ON threads(date);
```

And count the orphans that 26a will clean up:
```bash
sqlite3 /Users/rccurtrightjr./projects/open-robin/ai/system/robin.db "SELECT COUNT(*) FROM exchanges WHERE thread_id NOT IN (SELECT thread_id FROM threads);"
```

Expected: a non-zero count (approximately 22 as of spec drafting; may vary if more validation wipes have happened). Record this number — you'll verify it goes to zero after migration.

If the schema doesn't match (e.g., someone ran a migration since this spec was drafted), stop and reconcile before proceeding.

---

## Changes — file by file

### 1. `open-robin-server/lib/db/migrations/008_project_scoped_threads.js` (new file)

Create the migration file. It follows the same transaction-disabled + PRAGMA pattern as migration 007.

```js
/**
 * Migration 008 — Project-scoped threads (SPEC-26a)
 *
 * Lays the data model foundation for the dual-chat paradigm. After this
 * migration, threads can be either project-scoped (shared across all views
 * in a project) or view-scoped (tied to a specific view within a project),
 * disambiguated by a `scope` column. Multi-project namespacing is handled
 * by a new `project_id` column so two projects with same-named views
 * won't collide when the workspace switcher ships.
 *
 * Schema changes:
 *   + project_id TEXT      (new — required once populated; nullable for migration safety, enforced at app layer)
 *   + scope      TEXT      (new — values: 'project' | 'view'; enforced at app layer)
 *   - panel_id   TEXT      (renamed → view_id; NOT NULL dropped since project threads have NULL here)
 *   + view_id    TEXT      (successor to panel_id; NULL when scope='project')
 *   - date       TEXT      (dropped — dead column from 24d; was only written by the deleted daily-rolling strategy)
 *   - threads_date_index   (dropped — referenced the dead column)
 *   - threads_panel_id_index (dropped — replaced by the composite index below)
 *   + threads_project_scope_view_idx (new composite — covers the common query patterns)
 *
 * Data changes:
 *   - DELETE FROM threads — wipes existing test data (pre-prod directive, consistent with 24a/24b/24c/24d)
 *   - One-time orphan cleanup: DELETE FROM exchanges WHERE thread_id NOT IN (SELECT thread_id FROM threads)
 *     This purges the 22+ orphaned exchanges rows left behind by earlier CLI-based validation wipes.
 *     Root cause: sqlite3 CLI doesn't enable foreign_keys by default, so cascade deletes from CLI-
 *     initiated DELETEs didn't fire. The knex runtime already enables foreign_keys via
 *     pool.afterCreate (lib/db.js:28-33), so app-level deletes have always cascaded correctly.
 *     Future validation should either go through the app OR prefix CLI DELETEs with
 *     `PRAGMA foreign_keys = ON;`.
 *
 * Downstream impact: ThreadIndex constructor signature changes to
 * (projectId, scope, viewId). ThreadManager derives projectId from
 * basename(projectRoot) and passes scope='view' in 26a to preserve
 * existing behavior. 26b activates project scope.
 */

// Disable knex's transaction wrapper — SQLite's PRAGMA foreign_keys
// cannot be toggled inside a transaction. Same reason as migration 007.
exports.config = { transaction: false };

exports.up = async function (knex) {
  // SQLite table-rebuild migrations require FK checks off — the DROP old /
  // RENAME new cycle triggers FK validation even with zero child rows, and
  // renaming panel_id → view_id is a table rebuild under the hood.
  await knex.raw('PRAGMA foreign_keys = OFF');

  // 1. Wipe existing threads rows (pre-prod directive — all threads are
  //    disposable test data per parent SPEC-24 and SPEC-26).
  await knex('threads').del();

  // 2. One-time orphan cleanup in exchanges. These rows accumulated from
  //    CLI-based validation wipes across the 24x series. Going forward,
  //    app-level deletes cascade correctly via pool.afterCreate setting
  //    foreign_keys=ON.
  await knex.raw(`
    DELETE FROM exchanges
    WHERE thread_id NOT IN (SELECT thread_id FROM threads)
  `);

  // 3. Drop stale indices that reference columns we're changing.
  //    dropIndex is idempotent-ish; wrap in try/catch in case they don't
  //    exist on some dev DBs.
  try { await knex.schema.alterTable('threads', (t) => t.dropIndex('panel_id', 'threads_panel_id_index')); } catch { /* may not exist */ }
  try { await knex.schema.alterTable('threads', (t) => t.dropIndex('date', 'threads_date_index')); } catch { /* may not exist */ }

  // 4. Rename panel_id → view_id, drop NOT NULL on it, drop the dead
  //    `date` column, add project_id and scope columns.
  //    knex on SQLite handles this via a table rebuild automatically.
  await knex.schema.alterTable('threads', (t) => {
    t.renameColumn('panel_id', 'view_id');
  });

  await knex.schema.alterTable('threads', (t) => {
    t.text('view_id').nullable().alter();  // drop NOT NULL — project threads are NULL here
    t.dropColumn('date');
    t.text('project_id');                   // new — app-layer NOT NULL; allowing NULL in SQL keeps migration safe
    t.text('scope');                        // new — app-layer CHECK; values: 'project' | 'view'
  });

  // 5. Add the composite index that covers both query patterns:
  //    - Project chat list: WHERE project_id=? AND scope='project'
  //    - View chat list:    WHERE project_id=? AND scope='view' AND view_id=?
  await knex.schema.alterTable('threads', (t) => {
    t.index(['project_id', 'scope', 'view_id'], 'threads_project_scope_view_idx');
  });

  await knex.raw('PRAGMA foreign_keys = ON');
};

exports.down = async function (knex) {
  await knex.raw('PRAGMA foreign_keys = OFF');

  // Reverse index
  try { await knex.schema.alterTable('threads', (t) => t.dropIndex(['project_id', 'scope', 'view_id'], 'threads_project_scope_view_idx')); } catch { /* may not exist */ }

  // Reverse column changes
  await knex.schema.alterTable('threads', (t) => {
    t.dropColumn('scope');
    t.dropColumn('project_id');
    t.text('date');
    t.text('view_id').notNullable().alter();  // restore NOT NULL
  });

  await knex.schema.alterTable('threads', (t) => {
    t.renameColumn('view_id', 'panel_id');
  });

  // Restore dropped indices
  await knex.schema.alterTable('threads', (t) => {
    t.index('panel_id', 'threads_panel_id_index');
    t.index('date', 'threads_date_index');
  });

  // Note: we do NOT restore the orphaned exchanges rows on down migration.
  // They were data corruption, not intended state.

  await knex.raw('PRAGMA foreign_keys = ON');
};
```

**Caveats to verify before running:**
- Does the knex version on this project support `t.renameColumn` on SQLite? Knex 0.21+ should; check `package.json`. If not, the migration needs a manual table rebuild: CREATE threads_new, INSERT...SELECT, DROP old, RENAME new.
- Does `t.text('view_id').nullable().alter()` work after a `renameColumn` in the same alterTable block? If not, split into two alterTable calls (the migration already does this as a precaution).
- The `dropIndex` calls use the old auto-generated knex index names. If these don't match, the try/catch will silently swallow — grep the DB schema to confirm the exact names before editing the migration if this happens.

### 2. `open-robin-server/lib/thread/ThreadIndex.js`

This is the biggest file edit. The constructor signature changes and every method that queries `threads` needs updating.

**2a. Rewrite the class docstring and constructor.**

Current:
```js
class ThreadIndex {
  /**
   * @param {string} panelId - Panel identifier for scoped queries
   */
  constructor(panelId) {
    this.panelId = panelId;
  }
```

New:
```js
class ThreadIndex {
  /**
   * @param {string} projectId - Project identifier (basename of projectRoot)
   * @param {'project'|'view'} scope - Thread scope
   * @param {string|null} viewId - View name when scope='view'; null when scope='project'
   */
  constructor(projectId, scope, viewId) {
    if (!projectId) throw new Error('ThreadIndex: projectId is required');
    if (scope !== 'project' && scope !== 'view') {
      throw new Error(`ThreadIndex: scope must be 'project' or 'view', got "${scope}"`);
    }
    if (scope === 'view' && !viewId) {
      throw new Error('ThreadIndex: viewId is required when scope="view"');
    }
    this.projectId = projectId;
    this.scope = scope;
    this.viewId = scope === 'view' ? viewId : null;
  }
```

**2b. Rewrite `list()`.**

Current:
```js
async list() {
  const db = getDb();
  const rows = await db('threads')
    .where('panel_id', this.panelId)
    .orderBy('updated_at', 'desc');

  return rows.map((row) => ({
    threadId: row.thread_id,
    entry: this._toEntry(row),
  }));
}
```

New:
```js
async list() {
  const db = getDb();
  const query = db('threads')
    .where('project_id', this.projectId)
    .where('scope', this.scope);

  if (this.scope === 'view') {
    query.where('view_id', this.viewId);
  }

  const rows = await query.orderBy('updated_at', 'desc');

  return rows.map((row) => ({
    threadId: row.thread_id,
    entry: this._toEntry(row),
  }));
}
```

**2c. Rewrite `create()`.**

Current:
```js
async create(threadId, name = null, options = {}) {
  const db = getDb();
  const now = Date.now();
  const createdAt = new Date().toISOString();
  const harnessId = options.harnessId || 'kimi';
  const harnessConfig = options.harnessConfig ? JSON.stringify(options.harnessConfig) : null;

  await db('threads').insert({
    thread_id: threadId,
    panel_id: this.panelId,
    name,
    created_at: createdAt,
    message_count: 0,
    status: 'suspended',
    updated_at: now,
    harness_id: harnessId,
    harness_config: harnessConfig,
  });

  return { name, createdAt, messageCount: 0, status: 'suspended', harnessId };
}
```

New:
```js
async create(threadId, name = null, options = {}) {
  const db = getDb();
  const now = Date.now();
  const createdAt = new Date().toISOString();
  const harnessId = options.harnessId || 'kimi';
  const harnessConfig = options.harnessConfig ? JSON.stringify(options.harnessConfig) : null;

  await db('threads').insert({
    thread_id: threadId,
    project_id: this.projectId,
    scope: this.scope,
    view_id: this.viewId,  // null when scope='project'
    name,
    created_at: createdAt,
    message_count: 0,
    status: 'suspended',
    updated_at: now,
    harness_id: harnessId,
    harness_config: harnessConfig,
  });

  return {
    name,
    createdAt,
    messageCount: 0,
    status: 'suspended',
    harnessId,
    scope: this.scope,
    viewId: this.viewId,
  };
}
```

The returned entry now carries `scope` and `viewId` so downstream consumers can distinguish project vs view threads later.

**2d. `get()` stays mostly the same — no scoping needed because `thread_id` is the PK.**

Current:
```js
async get(threadId) {
  const db = getDb();
  const row = await db('threads').where('thread_id', threadId).first();
  return row ? this._toEntry(row) : null;
}
```

This stays unchanged — `thread_id` is globally unique (it's the primary key, timestamp-based from 24a). No need to filter by project/scope/view when looking up by ID.

**2e. `update()` needs to remove the `date` branch (already gone in 24d, verify) and NOT accept project_id/scope/view_id updates.**

Current (post-24d):
```js
async update(threadId, updates) {
  const db = getDb();
  const dbUpdates = {};

  if (updates.name !== undefined) dbUpdates.name = updates.name;
  if (updates.status !== undefined) dbUpdates.status = updates.status;
  if (updates.messageCount !== undefined) dbUpdates.message_count = updates.messageCount;
  if (updates.resumedAt !== undefined) dbUpdates.resumed_at = updates.resumedAt;
  if (updates.updatedAt !== undefined) dbUpdates.updated_at = updates.updatedAt;

  if (Object.keys(dbUpdates).length === 0) return this.get(threadId);

  const count = await db('threads').where('thread_id', threadId).update(dbUpdates);
  if (count === 0) return null;

  return this.get(threadId);
}
```

This stays unchanged. Do NOT add `project_id`, `scope`, or `view_id` as update fields — those are immutable for the life of a thread (a view-scoped thread doesn't become a project-scoped thread mid-life; if the user wants that behavior, it's a new thread).

**2f. `delete()` stays unchanged.**

`thread_id` is globally unique; delete-by-id needs no scoping. The FK cascade to `exchanges` still works (via `pool.afterCreate` setting foreign_keys=ON).

**2g. `rebuild()` must scope by project_id + scope + view_id.**

Current:
```js
async rebuild() {
  const rows = await getDb()('threads').where('panel_id', this.panelId);
  return rows.length;
}
```

New:
```js
async rebuild() {
  const db = getDb();
  const query = db('threads')
    .where('project_id', this.projectId)
    .where('scope', this.scope);

  if (this.scope === 'view') {
    query.where('view_id', this.viewId);
  }

  const rows = await query;
  return rows.length;
}
```

Same filter shape as `list()`.

**2h. Update `_toEntry()` to pass through `scope` and `view_id`.**

Current (post-24d):
```js
_toEntry(row) {
  const entry = {
    name: row.name,
    createdAt: row.created_at,
    messageCount: row.message_count,
    status: row.status,
  };
  if (row.resumed_at) entry.resumedAt = row.resumed_at;
  if (row.harness_id) entry.harnessId = row.harness_id;
  if (row.harness_config) {
    try {
      entry.harnessConfig = JSON.parse(row.harness_config);
    } catch {
      entry.harnessConfig = null;
    }
  }
  return entry;
}
```

New:
```js
_toEntry(row) {
  const entry = {
    name: row.name,
    createdAt: row.created_at,
    messageCount: row.message_count,
    status: row.status,
    scope: row.scope,
    viewId: row.view_id,
  };
  if (row.resumed_at) entry.resumedAt = row.resumed_at;
  if (row.harness_id) entry.harnessId = row.harness_id;
  if (row.harness_config) {
    try {
      entry.harnessConfig = JSON.parse(row.harness_config);
    } catch {
      entry.harnessConfig = null;
    }
  }
  return entry;
}
```

Added: `scope` and `viewId`. Downstream consumers can read them to differentiate the two types of threads in 26b+. In 26a nothing actually reads these new fields, but they're passed through so the pipe is ready.

---

### 3. `open-robin-server/lib/thread/ThreadManager.js`

Small bridge update. The constructor derives `projectId` from `projectRoot` and passes the three-arg form to `ThreadIndex`.

**3a. Update the constructor at L31-48ish.**

Find the current lines (post-24c):
```js
  constructor(panelId, config = {}) {
    this.panelId = panelId;
    this.panelPath = config.panelPath || null;
    this.projectRoot = config.projectRoot || null;
    this.config = { ...DEFAULT_CONFIG, ...config };

    /** @type {ThreadIndex} */
    this.index = new ThreadIndex(panelId);

    /** @type {SessionManager} */
    ...
  }
```

*Note: after SPEC-24c, `this.panelPath = config.panelPath` was dropped. After SPEC-24d, the AutoRenamer construction was dropped. Your post-24c+24d constructor should be shorter than this snippet. Read the actual file before editing.*

New:
```js
  constructor(panelId, config = {}) {
    this.panelId = panelId;
    this.projectRoot = config.projectRoot || null;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // SPEC-26a: derive project_id from the project folder name. Multi-project
    // namespacing. When the workspace switcher lands, two projects with the
    // same view name won't collide because project_id differs.
    if (!this.projectRoot) {
      throw new Error(
        `ThreadManager: projectRoot is required. Panel: ${panelId}. ` +
        'SPEC-26a: project_id is derived from basename(projectRoot).'
      );
    }
    this.projectId = path.basename(this.projectRoot);

    /** @type {ThreadIndex} */
    // SPEC-26a: scope='view' in 26a preserves existing single-chat behavior.
    // 26b introduces project-scoped ThreadManagers alongside view-scoped ones.
    this.index = new ThreadIndex(this.projectId, 'view', panelId);

    /** @type {SessionManager} */
    ...
  }
```

Changes:
- Derive and store `this.projectId` from `path.basename(projectRoot)`.
- Pass three args to `ThreadIndex` (projectId, 'view', panelId).
- Hard-throw if `projectRoot` is missing — it's now required. Previously the code limped along with `this.projectId === null` and would fail further down.

**3b. Verify no other call sites in ThreadManager construct a ThreadIndex directly.**

```bash
grep -n "new ThreadIndex" lib/thread/
# Expected: exactly one hit, in ThreadManager.js:35ish, the constructor you just updated.
```

If there's another hit, flag it — 26a needs to update every construction site.

**3c. No other changes in ThreadManager.js.**

`_createChatFile`, `_getViewsDir`, `createThread`, `getThread`, `listThreads`, `renameThread`, `deleteThread`, `addMessage`, etc. all stay unchanged. They still operate on a single ThreadIndex instance that happens to be scoped to `(projectId, 'view', panelId)` — identical observable behavior to before.

---

### 4. `open-robin-server/lib/thread/ThreadWebSocketHandler.js`

**No changes required in 26a.** The `getThreadManager()` cache key stays panelId-based, `setPanel()` signature unchanged. The projectRoot flows through `config.projectRoot` just like today — you verified that in the 24c work.

Sanity-check after the ThreadManager change: the existing `setPanel` call sites in `server.js` and `client-message-router.js` pass `{ projectRoot, viewName }` in the config object. Your new ThreadManager constructor now throws if `projectRoot` is missing — make sure both call sites provide it. They should; 24c already guarantees it.

```bash
grep -rn "ThreadWebSocketHandler\.setPanel\b" lib server.js
# Both hits should include projectRoot in the config.
```

---

### 5. `open-robin-server/lib/thread/index.js`

No changes. `ThreadIndex` is re-exported from here; the re-export is just by reference, so the new constructor signature propagates automatically.

---

### 6. `open-robin-server/test/smoke-spec03-spec15.js`

No changes expected. The smoke test asserts `ThreadWebSocketHandler` exports, not `ThreadIndex` internals. Constructor signature changes don't affect the test. Run it to confirm.

---

## Test plan

### Pre-migration audit

Before running the server (and therefore the migration), capture the starting state:

```bash
cd /Users/rccurtrightjr./projects/open-robin

sqlite3 ai/system/robin.db "SELECT COUNT(*) FROM threads;" > /tmp/26a-pre-threads.txt
sqlite3 ai/system/robin.db "SELECT COUNT(*) FROM exchanges;" > /tmp/26a-pre-exchanges.txt
sqlite3 ai/system/robin.db "SELECT COUNT(*) FROM exchanges WHERE thread_id NOT IN (SELECT thread_id FROM threads);" > /tmp/26a-pre-orphans.txt

cat /tmp/26a-pre-*.txt
```

Record the numbers. Expected orphans > 0 (around 22 as of drafting).

### Static checks before running the migration

```bash
cd /Users/rccurtrightjr./projects/open-robin/open-robin-server

# The migration file exists and is well-formed
node -e "const m = require('./lib/db/migrations/008_project_scoped_threads'); console.log('up:', typeof m.up, 'down:', typeof m.down, 'config:', JSON.stringify(m.config));"
# Expected: up: function down: function config: {"transaction":false}

# ThreadIndex loads with the new constructor
node -e "
const { ThreadIndex } = require('./lib/thread/ThreadIndex');
try { new ThreadIndex('proj', 'view', 'code-viewer'); console.log('PASS: valid construction'); } catch (e) { console.log('FAIL:', e.message); }
try { new ThreadIndex(); console.log('FAIL: should have thrown'); } catch (e) { console.log('PASS: empty rejected'); }
try { new ThreadIndex('proj', 'bogus', 'code-viewer'); console.log('FAIL: bogus scope accepted'); } catch (e) { console.log('PASS: bogus scope rejected'); }
try { new ThreadIndex('proj', 'view'); console.log('FAIL: missing viewId accepted for view scope'); } catch (e) { console.log('PASS: missing viewId rejected'); }
try { new ThreadIndex('proj', 'project'); console.log('PASS: project scope does not need viewId'); } catch (e) { console.log('FAIL:', e.message); }
"
# Expected: all PASS

# ThreadManager loads and requires projectRoot
node -e "
const { ThreadManager } = require('./lib/thread/ThreadManager');
try { new ThreadManager('code-viewer', { projectRoot: '/tmp/fake-project' }); console.log('PASS: construction with projectRoot'); } catch (e) { console.log('FAIL:', e.message); }
try { new ThreadManager('code-viewer', {}); console.log('FAIL: no projectRoot accepted'); } catch (e) { console.log('PASS: missing projectRoot rejected'); }
"
# Expected: both PASS

# Module graph loads
node -e "require('./lib/thread')"
node -e "require('./lib/db')"
# Expected: no errors
```

### Run the migration

Start the server — this triggers `initDb()` which calls `migrate.latest()`.

```bash
cd /Users/rccurtrightjr./projects/open-robin/open-robin-server
pkill -9 -f "node.*server.js" 2>/dev/null; sleep 1
node server.js > /tmp/26a-boot.log 2>&1 &
sleep 4
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3001/
```

Expected: `HTTP 200`, no migration errors in the boot log.

### Post-migration audit

```bash
# Schema should now have project_id, scope, view_id (not panel_id); no date column
sqlite3 /Users/rccurtrightjr./projects/open-robin/ai/system/robin.db ".schema threads"

# Expected schema includes:
# - project_id text
# - scope text
# - view_id text  (renamed from panel_id, nullable now)
# - NO date column
# - NO panel_id column
# - composite index threads_project_scope_view_idx

# Migration log
sqlite3 /Users/rccurtrightjr./projects/open-robin/ai/system/robin.db "SELECT name, batch FROM knex_migrations ORDER BY batch, name;"
# Expected: 008_project_scoped_threads.js appears as the newest migration

# Threads wiped
sqlite3 /Users/rccurtrightjr./projects/open-robin/ai/system/robin.db "SELECT COUNT(*) FROM threads;"
# Expected: 0

# Orphans cleaned
sqlite3 /Users/rccurtrightjr./projects/open-robin/ai/system/robin.db "SELECT COUNT(*) FROM exchanges WHERE thread_id NOT IN (SELECT thread_id FROM threads);"
# Expected: 0

# Foreign keys still enabled on app connection (sanity check)
# Create a thread via the UI, then delete it, then check exchanges orphan count
# (see Live validation below)
```

### Live validation

1. **Hard refresh the browser** to pick up nothing (client hasn't changed) — just ensure the WebSocket reconnects.

2. **Create a thread on code-viewer** through the normal UI flow (harness picker → Kimi → send a message).

3. **Check SQLite — the new row has the 26a columns populated.**
   ```bash
   sqlite3 /Users/rccurtrightjr./projects/open-robin/ai/system/robin.db "SELECT thread_id, project_id, scope, view_id, name, message_count FROM threads;"
   ```
   Expected:
   - `thread_id` = a `YYYY-MM-DDTHH-MM-SS-mmm` timestamp
   - `project_id` = `open-robin` (the basename of your project folder)
   - `scope` = `view`
   - `view_id` = `code-viewer`
   - `name` = null or whatever you set
   - `message_count` = 2 (user + assistant)

4. **Create a thread on issues-viewer** and verify its `view_id` = `issues-viewer`, `project_id` = `open-robin`, `scope` = `view`. Each panel still scopes to its own thread list.

5. **Sidebar scoping still works.** Switch between code-viewer and issues-viewer; each shows only its own threads. This should be identical behavior to before — 26a doesn't change the routing, only the underlying column names.

6. **Delete a thread via the UI.** Then check the exchanges table:
   ```bash
   sqlite3 /Users/rccurtrightjr./projects/open-robin/ai/system/robin.db "SELECT COUNT(*) FROM exchanges WHERE thread_id NOT IN (SELECT thread_id FROM threads);"
   ```
   Expected: 0 (cascade fired correctly — this verifies `pool.afterCreate` is still working with the new schema).

7. **Smoke test.**
   ```bash
   cd /Users/rccurtrightjr./projects/open-robin/open-robin-server && node test/smoke-spec03-spec15.js
   ```
   Expected: 47 passed, 0 failed.

### What breaks if you get it wrong

| Failure | Root cause | Fix |
|---|---|---|
| Migration 008 fails with `no such column: panel_id` during dropIndex | Index names don't match; knex auto-generated a different name | Grep the DB for actual index names (`.schema threads`), adjust the dropIndex calls |
| Migration fails on renameColumn | Knex version too old for SQLite renameColumn | Fall back to manual table rebuild pattern (CREATE threads_new, INSERT, DROP, RENAME) |
| Server boot crash: `ThreadManager: projectRoot is required` | A call site is constructing ThreadManager without projectRoot | Grep for `new ThreadManager(`, find the offender, add projectRoot |
| Thread creation fails with `NOT NULL constraint failed: threads.project_id` | The column was created with NOT NULL and no default; backfill didn't happen | Migration should NOT use `.notNullable()` on project_id — app-layer enforces it |
| Thread list returns empty | The new scope/project_id filter is too strict | Check that `list()` is using the right values (projectId = basename, scope='view', viewId=panelId) |
| Cross-panel leak (code-viewer sees issues-viewer threads) | view_id column populated correctly but list() isn't filtering | Re-check `list()` — `scope='view'` branch must add `.where('view_id', this.viewId)` |
| Orphan exchanges count after delete > 0 | FK cascade not firing — `pool.afterCreate` broken or the new FK relationship was lost during renameColumn | Verify `PRAGMA foreign_key_list(exchanges)` still shows the FK to threads; verify `PRAGMA foreign_keys` returns 1 on a fresh app connection |

---

## Do not do

- **Do not** touch any client code. 26a is server-side only.
- **Do not** add project-scoped ThreadManagers or change `getThreadManager()`. That's 26b.
- **Do not** change the wire protocol (`thread:open-assistant`, `thread:list`, etc.). 26a preserves existing wire messages identically.
- **Do not** modify `_getViewsDir()`. The unified location from SPEC-24c stays as-is in 26a. 26b will split it into project path and view path.
- **Do not** create the per-view `<view>/chat/threads/<user>/` directories. That's 26b's job.
- **Do not** add a `project_id` column to any other table (exchanges, system_wiki, etc.). Only threads gets it in 26a.
- **Do not** add application-layer CHECK constraints via migration. SQLite's CHECK support is limited and knex doesn't consistently generate it. Use the app-layer validation in the ThreadIndex constructor (already included above).
- **Do not** try to populate `project_id` / `scope` / `view_id` for surviving rows — there aren't any, the migration wipes the table first.
- **Do not** rename or restructure the existing ThreadIndex methods beyond what's listed above. Keep `get`, `update`, `rename`, `activate`, `suspend`, `delete`, `touch`, `markResumed`, `incrementMessageCount` unchanged.
- **Do not** delete `ThreadIndex.setDate()` — it was already deleted in 24d. Don't recreate it.
- **Do not** bundle the cascade-fix discussion into the migration. The cascade is already working via `pool.afterCreate`; the orphan cleanup in the migration is a one-time historical cleanup, not a cascade fix.
- **Do not** touch `lib/runner/`, `lib/frontmatter/`, `lib/views/`, or any client code.

---

## Commit message template

```
SPEC-26a: dual-chat data model — project_id + scope + view_id

Foundation for SPEC-26 (dual-chat paradigm: left project-scoped,
right view-scoped). Lays the SQLite schema + ThreadIndex updates
needed to support both chat types. Does NOT activate dual-chat
routing — that's 26b.

Migration 008:
  - Wipes existing threads rows (pre-prod, consistent with 24a-24d)
  - One-time orphan cleanup: DELETE FROM exchanges WHERE thread_id
    NOT IN (SELECT thread_id FROM threads). Purged ~22 orphans left
    behind by earlier CLI-based validation wipes. Root cause: sqlite3
    CLI doesn't enable foreign_keys by default. The knex runtime is
    fine (pool.afterCreate sets PRAGMA foreign_keys=ON). Future
    validation wipes should go through the app or prefix with
    PRAGMA foreign_keys=ON;.
  - Renames panel_id → view_id (drops NOT NULL; project threads will
    have NULL view_id).
  - Adds project_id TEXT (app-layer NOT NULL via ThreadIndex
    constructor validation).
  - Adds scope TEXT with values 'project' | 'view' (app-layer
    validation in ThreadIndex constructor).
  - Drops dead `date` column from 24d.
  - Drops threads_date_index and threads_panel_id_index.
  - Adds composite threads_project_scope_view_idx for the two common
    query patterns.
  - Uses transaction: false + PRAGMA foreign_keys OFF/ON pattern,
    same as migration 007.

ThreadIndex:
  - Constructor now takes (projectId, scope, viewId). Throws on
    missing projectId, invalid scope, or missing viewId when
    scope='view'.
  - list() filters by project_id + scope, then adds view_id filter
    when scope='view'.
  - create() inserts with project_id, scope, and view_id (NULL for
    project scope).
  - rebuild() mirrors list() filter shape.
  - _toEntry() passes through scope and viewId so downstream
    consumers can distinguish thread types in 26b.
  - get(), update(), rename(), delete(), suspend(), activate(),
    touch(), markResumed(), incrementMessageCount() unchanged —
    they operate on the globally unique thread_id PK.

ThreadManager:
  - Constructor throws if projectRoot is missing (no more silent
    fallback). Derives projectId = basename(projectRoot).
  - Passes ('view', panelId) to ThreadIndex constructor — preserves
    existing single-scope behavior in 26a.

Wire protocol: unchanged.
Client: unchanged.
_getViewsDir: unchanged (still the 24c unified location).

Live-validated: create/rename/delete on code-viewer and
issues-viewer; new rows show project_id=open-robin, scope=view,
view_id=<panel>; delete cascade fires and orphan count stays 0;
smoke test 47/0.

Part of SPEC-26 (dual-chat paradigm). Unblocks 26b (dual
ThreadManager + wire protocol scope field + storage routing).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

## Report back

1. **Diff stats.** `git diff --stat main`. Expected: 1 new migration file, ThreadIndex.js meaningfully changed (~40 lines net), ThreadManager.js small change (~6 lines net). No client files touched.

2. **Pre-migration audit numbers.** The counts from `/tmp/26a-pre-*.txt` — how many threads existed before wipe, how many exchanges, how many orphans.

3. **Post-migration audit numbers.** Threads=0, exchanges may still have rows (for legitimate completed threads from before 26a, but orphans should be 0), new schema visible via `.schema threads`.

4. **Static check output.** Every node-e constructor validation, module load, and smoke test. All must PASS.

5. **Live validation evidence.**
   - The actual schema after migration — paste the full `.schema threads` output
   - SQLite row contents after creating one thread on code-viewer and one on issues-viewer — confirm project_id, scope, view_id fields are populated correctly
   - Orphan count after deleting a thread via UI — confirm still 0 (cascade works)

6. **Surprises.**
   - Did `t.renameColumn` work on this project's knex version, or did you need a manual table rebuild?
   - Did the dropIndex calls find their targets, or did they silently skip?
   - Any ThreadManager construction sites missing projectRoot that needed fixing?

7. **Files touched outside the change list.** Expected: zero. If any, explain.

8. **26b signals.** While touching ThreadIndex/ThreadManager, note anything that looks like it'll need changes in 26b when the dual-scope routing activates — e.g., methods that will need project-scope branches, places where panelId is still conflated with viewId, etc.

Hand the report back to the orchestrator before moving to 26b.
