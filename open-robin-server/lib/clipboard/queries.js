/**
 * Clipboard queries — data access for clipboard history
 *
 * All functions take a Knex instance as first arg.
 * Cap: 500 rows. Pruning happens on insert.
 */

const crypto = require('crypto');

const CLIPBOARD_CAP = 50;
const PREVIEW_LENGTH = 120;

/**
 * Generate a preview from text (first N chars, single line).
 * @param {string} text
 * @returns {string}
 */
function generatePreview(text) {
  if (!text) return '';
  const singleLine = text.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  return singleLine.slice(0, PREVIEW_LENGTH);
}

/**
 * Generate SHA-256 hash of content for deduplication.
 * @param {string} text
 * @returns {string}
 */
function generateHash(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * List clipboard items with pagination, ordered by last_used_at DESC.
 * @param {import('knex').Knex} db
 * @param {number} offset
 * @param {number} limit
 * @returns {Promise<{ items: Array, total: number }>}
 */
async function listItems(db, offset = 0, limit = 50) {
  const items = await db('clipboard_items')
    .orderBy('last_used_at', 'desc')
    .limit(limit)
    .offset(offset);

  const totalResult = await db('clipboard_items').count('* as count').first();
  const total = totalResult ? totalResult.count : 0;

  return { items, total };
}

/**
 * Append or touch an item. If content_hash exists, updates last_used_at.
 * If new, inserts and prunes to cap.
 * @param {import('knex').Knex} db
 * @param {Object} params - { text, type, source }
 * @returns {Promise<Object>} - The inserted or updated item
 */
async function appendItem(db, { text, type = 'text', source = 'manual' }) {
  const preview = generatePreview(text);
  const contentHash = generateHash(text);
  const now = Date.now();

  // Check for existing item by hash
  const existing = await db('clipboard_items')
    .where('content_hash', contentHash)
    .first();

  if (existing) {
    // Touch existing item
    await db('clipboard_items')
      .where('id', existing.id)
      .update({ last_used_at: now });

    return { ...existing, last_used_at: now };
  }

  // Insert new item
  const [id] = await db('clipboard_items').insert({
    text,
    type,
    preview,
    content_hash: contentHash,
    created_at: now,
    last_used_at: now,
    source,
  });

  // Prune to cap
  const countResult = await db('clipboard_items').count('* as count').first();
  const count = countResult ? countResult.count : 0;

  if (count > CLIPBOARD_CAP) {
    const toDelete = count - CLIPBOARD_CAP;
    const oldest = await db('clipboard_items')
      .orderBy('last_used_at', 'asc')
      .limit(toDelete)
      .select('id');

    if (oldest.length > 0) {
      await db('clipboard_items')
        .whereIn('id', oldest.map((r) => r.id))
        .del();
    }
  }

  return db('clipboard_items').where('id', id).first();
}

/**
 * Touch an item (update last_used_at to now, move to front).
 * @param {import('knex').Knex} db
 * @param {number} id
 * @returns {Promise<Object|undefined>} - Updated item or undefined if not found
 */
async function touchItem(db, id) {
  const now = Date.now();
  const updated = await db('clipboard_items')
    .where('id', id)
    .update({ last_used_at: now });

  if (updated === 0) {
    return undefined;
  }

  return db('clipboard_items').where('id', id).first();
}

/**
 * Clear all clipboard history.
 * @param {import('knex').Knex} db
 * @returns {Promise<number>} - Number of deleted rows
 */
async function clearAll(db) {
  return db('clipboard_items').del();
}

module.exports = {
  listItems,
  appendItem,
  touchItem,
  clearAll,
  generatePreview,
  generateHash,
};
