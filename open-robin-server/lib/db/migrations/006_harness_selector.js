/**
 * Migration 006 — Harness Selector
 *
 * Adds: harness_id column to threads table for storing AI backend selection
 * Adds: harness_config column for BYOK (Bring Your Own Key) settings
 */

exports.up = async function (knex) {
  // Add harness_id column to threads table
  await knex.schema.alterTable('threads', (t) => {
    t.text('harness_id').defaultTo('kimi');
    t.text('harness_config'); // JSON for BYOK settings
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('threads', (t) => {
    t.dropColumn('harness_id');
    t.dropColumn('harness_config');
  });
};
