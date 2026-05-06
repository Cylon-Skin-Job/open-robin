/**
 * clipboard_index CRUD — Knex data access for the clipboard metadata table.
 *
 * One job: read and write clipboard_index rows. No keychain logic, no event
 * emission, no validation beyond the schema.
 *
 * Schema lives in migration 016_clipboard_keychain. Columns:
 *   id, type, preview, content_hash, created_at, last_used_at, source
 */

'use strict';

const { getDb } = require('../../db');

const TABLE = 'clipboard_index';
const COLUMNS = [
  'id',
  'type',
  'preview',
  'content_hash',
  'created_at',
  'last_used_at',
  'source',
];

async function list({ offset = 0, limit = 50 } = {}) {
  const items = await getDb()(TABLE)
    .select(COLUMNS)
    .orderBy('last_used_at', 'desc')
    .limit(limit)
    .offset(offset);
  const totalRow = await getDb()(TABLE).count('* as count').first();
  return { items, total: totalRow ? Number(totalRow.count) : 0 };
}

async function get(id) {
  const row = await getDb()(TABLE).select(COLUMNS).where({ id }).first();
  return row || null;
}

async function getByContentHash(contentHash) {
  const row = await getDb()(TABLE).select(COLUMNS).where({ content_hash: contentHash }).first();
  return row || null;
}

async function insert(row) {
  const [id] = await getDb()(TABLE).insert(row);
  return id;
}

async function touch(id, last_used_at) {
  const count = await getDb()(TABLE).where({ id }).update({ last_used_at });
  return count > 0;
}

async function remove(id) {
  const count = await getDb()(TABLE).where({ id }).del();
  return count > 0;
}

async function removeByContentHash(contentHash) {
  return getDb()(TABLE).where({ content_hash: contentHash }).del();
}

async function listOldestIds(count) {
  const rows = await getDb()(TABLE)
    .select('id')
    .orderBy('last_used_at', 'asc')
    .limit(count);
  return rows.map((r) => r.id);
}

async function removeMany(ids) {
  if (!ids || ids.length === 0) return 0;
  return getDb()(TABLE).whereIn('id', ids).del();
}

async function count() {
  const row = await getDb()(TABLE).count('* as count').first();
  return row ? Number(row.count) : 0;
}

async function clearAll() {
  return getDb()(TABLE).del();
}

async function listAllIds() {
  const rows = await getDb()(TABLE).select('id');
  return rows.map((r) => r.id);
}

module.exports = {
  list,
  get,
  getByContentHash,
  insert,
  touch,
  remove,
  removeByContentHash,
  listOldestIds,
  removeMany,
  count,
  clearAll,
  listAllIds,
  TABLE,
  COLUMNS,
};
