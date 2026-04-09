/**
 * Migration 007 — Make threads.name nullable
 *
 * Part of SPEC-24a (chat simplification). New threads default to
 * name = null — the client falls back to the ID minus milliseconds
 * (Phase 24e) until Mario's enrichment pipeline fills one in.
 *
 * Drops the NOT NULL constraint and 'New Chat' default that
 * 001_initial.js set on threads.name.
 */

// Disable knex's transaction wrapper — SQLite's PRAGMA foreign_keys
// cannot be toggled inside a transaction.
exports.config = { transaction: false };

exports.up = async function (knex) {
  // SQLite table-rebuild migrations require FK checks off — the DROP old /
  // RENAME new cycle triggers FK validation even with zero child rows.
  await knex.raw('PRAGMA foreign_keys = OFF');
  await knex.schema.alterTable('threads', (t) => {
    t.text('name').nullable().alter();
  });
  await knex.raw('PRAGMA foreign_keys = ON');
};

exports.down = async function (knex) {
  await knex.raw('PRAGMA foreign_keys = OFF');
  await knex.schema.alterTable('threads', (t) => {
    t.text('name').notNullable().defaultTo('New Chat').alter();
  });
  await knex.raw('PRAGMA foreign_keys = ON');
};
