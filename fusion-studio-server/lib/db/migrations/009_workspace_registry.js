/**
 * Migration 009 — Workspace registry (WORKSPACE_CONTROLLER_SPEC §3)
 *
 * Hardens the `workspaces` table so it can act as the authoritative registry
 * for multi-workspace support. The 7 placeholder rows from migration 003
 * (and their matching workspace_themes rows) are dropped — they were theme
 * baselines that never wired to real repos. `repo_path` becomes `NOT NULL
 * UNIQUE` so the controller can use it for dedup. A single dev-time row
 * pointing at the current project root is seeded, and
 * `system_config.last_active_workspace_id` is set so the restore-last-active
 * path has something to land on.
 *
 * Schema changes:
 *   workspaces.repo_path  text NOT NULL UNIQUE   (was: text, nullable)
 *
 * Data changes:
 *   - DELETE FROM workspace_themes WHERE workspace_id IN (... NULL repo_path)
 *   - DELETE FROM workspaces WHERE repo_path IS NULL
 *   - INSERT dev workspace ('fs-dev', realpath'd project root)
 *   - INSERT OR IGNORE system_config row ('last_active_workspace_id', 'fs-dev')
 *
 * Why a table rebuild: SQLite cannot add NOT NULL or UNIQUE to an existing
 * column via ALTER TABLE. Explicit rename → create → copy → drop matches
 * idioms and makes the intent clear. FK checks are disabled for the swap so
 * workspace_themes doesn't blow up mid-rebuild.
 */

// Disable knex's transaction wrapper — PRAGMA foreign_keys cannot be toggled
// inside a transaction. Same reason as migrations 007 and 008.
exports.config = { transaction: false };

exports.up = async function (knex) {
  const fs = require('fs');
  const path = require('path');

  await knex.raw('PRAGMA foreign_keys = OFF');

  // 1. Drop workspace_themes rows whose workspace will be removed
  //    (the FK has no CASCADE).
  await knex.raw(`
    DELETE FROM workspace_themes
    WHERE workspace_id IN (SELECT id FROM workspaces WHERE repo_path IS NULL)
  `);

  // 2. Drop the 7 placeholder workspace rows seeded by migration 003.
  await knex('workspaces').whereNull('repo_path').del();

  // 3. Table rebuild — the only way in SQLite to add NOT NULL + UNIQUE.
  await knex.raw('ALTER TABLE workspaces RENAME TO workspaces_old');

  await knex.schema.createTable('workspaces', (t) => {
    t.text('id').primary();
    t.text('label').notNullable();
    t.text('icon').defaultTo('folder');
    t.text('description');
    t.text('repo_path').notNullable().unique();
    t.integer('sort_order').defaultTo(0);
    t.text('created_at').defaultTo(knex.fn.now());
  });

  await knex.raw(`
    INSERT INTO workspaces (id, label, icon, description, repo_path, sort_order, created_at)
    SELECT id, label, icon, description, repo_path, sort_order, created_at FROM workspaces_old
  `);

  await knex.raw('DROP TABLE workspaces_old');

  // 4. Seed the dev-time workspace pointing at the open-robin project root.
  //    __dirname is .../fusion-studio-server/lib/db/migrations, so the project
  //    root is four levels up. Canonicalize the same way path-service will
  //    (realpath + lowercase on darwin) so dedup comparisons line up.
  const rawRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const resolvedRoot = fs.realpathSync(rawRoot);
  const projectRoot = process.platform === 'darwin' ? resolvedRoot.toLowerCase() : resolvedRoot;

  await knex('workspaces').insert({
    id: 'fs-dev',
    label: 'Open Robin',
    icon: 'code',
    description: 'Open Robin development workspace',
    repo_path: projectRoot,
    sort_order: 0,
  });

  // 5. Seed last_active_workspace_id so restoreLastActive has something to
  //    land on. Use INSERT OR IGNORE in case a prior migration attempt set it.
  await knex('system_config')
    .insert({
      key: 'last_active_workspace_id',
      value: 'fs-dev',
      updated_at: Date.now(),
    })
    .onConflict('key')
    .ignore();

  await knex.raw('PRAGMA foreign_keys = ON');
};

exports.down = async function (knex) {
  await knex.raw('PRAGMA foreign_keys = OFF');

  // 1. Drop the seeded config row.
  await knex('system_config').where('key', 'last_active_workspace_id').del();

  // 2. Rebuild the table without NOT NULL / UNIQUE on repo_path.
  await knex.raw('ALTER TABLE workspaces RENAME TO workspaces_old');

  await knex.schema.createTable('workspaces', (t) => {
    t.text('id').primary();
    t.text('label').notNullable();
    t.text('icon').defaultTo('folder');
    t.text('description');
    t.text('repo_path');
    t.integer('sort_order').defaultTo(0);
    t.text('created_at').defaultTo(knex.fn.now());
  });

  await knex.raw(`
    INSERT INTO workspaces (id, label, icon, description, repo_path, sort_order, created_at)
    SELECT id, label, icon, description, repo_path, sort_order, created_at FROM workspaces_old
  `);

  await knex.raw('DROP TABLE workspaces_old');

  // 3. Drop the dev workspace (it doesn't belong to the pre-009 world).
  await knex('workspaces').where('id', 'fs-dev').del();

  // 4. Restore the 7 placeholder rows so down truly undoes up. onConflict
  //    ignore keeps this safe if they've already been re-added somewhere.
  await knex('workspaces')
    .insert([
      { id: 'system',         label: 'System',          icon: 'settings',        description: 'System-level theme baseline',          sort_order: 0 },
      { id: 'chat',           label: 'Chat',            icon: 'chat',            description: 'Conversational workspace',              sort_order: 1 },
      { id: 'home-office',    label: 'Home Office',     icon: 'home',            description: 'Docs, sheets, email, calendar',         sort_order: 2 },
      { id: 'bookkeeping',    label: 'Bookkeeping App', icon: 'account_balance', description: 'Financial tracking and reporting',      sort_order: 3 },
      { id: 'media-center',   label: 'Media Center',    icon: 'play_circle',     description: 'Media library and playback',            sort_order: 4 },
      { id: 'code-editor',    label: 'Code Editor',     icon: 'code',            description: 'Development environment',               sort_order: 5 },
      { id: 'research-vault', label: 'Research Vault',  icon: 'science',         description: 'Papers, books, and reference material', sort_order: 6 },
    ])
    .onConflict('id')
    .ignore();

  await knex.raw('PRAGMA foreign_keys = ON');
};
