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
 *   + project_id TEXT      (new — app-layer NOT NULL; nullable in SQL for migration safety)
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
 *     This purges the orphaned exchanges rows left behind by earlier CLI-based validation wipes.
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
  //    Wrapped in try/catch in case they don't exist on some dev DBs.
  try {
    await knex.schema.alterTable('threads', (t) => t.dropIndex('panel_id', 'threads_panel_id_index'));
  } catch { /* may not exist */ }
  try {
    await knex.schema.alterTable('threads', (t) => t.dropIndex('date', 'threads_date_index'));
  } catch { /* may not exist */ }

  // 4. Rename panel_id → view_id (table rebuild under the hood).
  await knex.schema.alterTable('threads', (t) => {
    t.renameColumn('panel_id', 'view_id');
  });

  // 5. Drop NOT NULL on view_id, drop the dead `date` column, add
  //    project_id and scope columns. Split from the renameColumn above
  //    as a precaution against knex ordering issues within a single
  //    alterTable block.
  await knex.schema.alterTable('threads', (t) => {
    t.text('view_id').nullable().alter();  // drop NOT NULL — project threads are NULL here
    t.dropColumn('date');
    t.text('project_id');                   // new — app-layer NOT NULL; allowing NULL in SQL keeps migration safe
    t.text('scope');                        // new — app-layer CHECK; values: 'project' | 'view'
  });

  // 6. Add the composite index that covers both query patterns:
  //    - Project chat list: WHERE project_id=? AND scope='project'
  //    - View chat list:    WHERE project_id=? AND scope='view' AND view_id=?
  await knex.schema.alterTable('threads', (t) => {
    t.index(['project_id', 'scope', 'view_id'], 'threads_project_scope_view_idx');
  });

  await knex.raw('PRAGMA foreign_keys = ON');
};

exports.down = async function (knex) {
  await knex.raw('PRAGMA foreign_keys = OFF');

  // Reverse composite index
  try {
    await knex.schema.alterTable('threads', (t) => t.dropIndex(['project_id', 'scope', 'view_id'], 'threads_project_scope_view_idx'));
  } catch { /* may not exist */ }

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
