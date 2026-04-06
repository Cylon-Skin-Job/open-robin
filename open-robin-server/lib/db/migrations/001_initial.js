/**
 * Initial schema — threads, exchanges, system_config, system_wiki
 *
 * This migration is dialect-neutral (works with SQLite and Postgres).
 * Note: db.js has a SQLite-specific pragma (foreign_keys = ON) that
 * would need to be removed when switching to Postgres.
 */

exports.up = function (knex) {
  return knex.schema
    .createTable('threads', (t) => {
      t.text('thread_id').primary();
      t.text('panel_id').notNullable();
      t.text('name').notNullable().defaultTo('New Chat');
      t.text('created_at').notNullable();
      t.text('resumed_at');
      t.integer('message_count').notNullable().defaultTo(0);
      t.text('status').notNullable().defaultTo('suspended');
      t.text('date'); // YYYY-MM-DD for daily-rolling
      t.integer('updated_at').notNullable().defaultTo(0); // ms timestamp for MRU
      t.index(['panel_id']);
      t.index(['date']);
    })
    .createTable('exchanges', (t) => {
      t.increments('id').primary();
      t.text('thread_id')
        .notNullable()
        .references('thread_id')
        .inTable('threads')
        .onDelete('CASCADE');
      t.integer('seq').notNullable();
      t.integer('ts').notNullable();
      t.text('user_input').notNullable();
      t.text('assistant').notNullable(); // JSON: { parts: [...] }
      t.text('metadata').defaultTo('[]');
      t.unique(['thread_id', 'seq']);
      t.index(['thread_id', 'seq']);
    })
    .createTable('system_config', (t) => {
      t.text('key').primary();
      t.text('value').notNullable();
      t.integer('updated_at').notNullable().defaultTo(0);
    })
    .createTable('system_wiki', (t) => {
      t.text('slug').primary();
      t.text('title').notNullable();
      t.text('content').notNullable();
      t.text('context');
      t.integer('updated_at').notNullable().defaultTo(0);
    });
};

exports.down = function (knex) {
  return knex.schema
    .dropTableIfExists('exchanges')
    .dropTableIfExists('threads')
    .dropTableIfExists('system_config')
    .dropTableIfExists('system_wiki');
};
