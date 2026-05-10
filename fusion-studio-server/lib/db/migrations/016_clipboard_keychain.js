/**
 * Migration 016 — Clipboard keychain redesign
 *
 * Drops the legacy `clipboard_items` table (plaintext value column).
 * Creates `clipboard_index` — metadata only; values move to macOS Keychain at
 * service = "clipboard:<id>", account = "fusion-studio".
 *
 * Per §4 of CLIPBOARD_KEYCHAIN_REDESIGN.md: nuke, do not migrate. Existing
 * rows are pre-leak and not preserved.
 */

exports.up = async function (knex) {
  await knex.schema.dropTableIfExists('clipboard_items');
  await knex.schema.createTable('clipboard_index', (t) => {
    t.increments('id').primary();
    t.text('type');                   // 'text' | 'link' | 'code' | 'secret' | ...
    t.text('preview');                // first 80 chars (display preview), or fingerprint for type='secret'
    t.text('content_hash').notNullable();
    t.integer('created_at').notNullable();
    t.integer('last_used_at').notNullable();
    t.text('source');                 // 'auto' | 'manual' | 'api' | ...
    t.unique(['content_hash']);
    t.index(['last_used_at'], 'clipboard_index_lru');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('clipboard_index');
  // Recreate legacy table shape so the migration is reversible. Data is not
  // recoverable — the original values lived in the dropped plaintext column.
  await knex.schema.createTable('clipboard_items', (t) => {
    t.increments('id').primary();
    t.text('text').notNullable();
    t.text('type').notNullable().defaultTo('text');
    t.text('preview').notNullable();
    t.text('content_hash').notNullable();
    t.integer('created_at').notNullable();
    t.integer('last_used_at').notNullable();
    t.text('source').defaultTo('manual');
    t.unique(['content_hash']);
    t.index(['last_used_at']);
  });
};
