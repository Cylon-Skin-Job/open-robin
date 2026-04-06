/**
 * Migration 005 — Clipboard history manager
 *
 * Adds: clipboard_items table for storing copy/paste history
 */

exports.up = async function (knex) {
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

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('clipboard_items');
};
