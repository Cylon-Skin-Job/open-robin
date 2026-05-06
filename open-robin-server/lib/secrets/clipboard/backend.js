/**
 * Clipboard backend — coordinates keychain (values) and clipboard_index (metadata).
 *
 * One job: provide a clean API for the WS handler layer to call. Owns the
 * 30-row rolling FIFO, hash-based dedup, secret-pattern preview redaction,
 * and cross-store atomicity between the keychain and the SQLite metadata
 * table.
 *
 * No WS handling, no event emission, no DOM. The handlers layer above
 * orchestrates events and broadcasts.
 *
 * See CLIPBOARD_KEYCHAIN_REDESIGN.md §3c, §3e, §3g, §3k.
 */

'use strict';

const crypto = require('crypto');
const keychain = require('./keychain');
const indexTable = require('./index-table');
const { detect } = require('./secret-detector');

const CLIPBOARD_CAP = 30;

class ClipboardBackendError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ClipboardBackendError';
    this.code = code;
  }
}
ClipboardBackendError.NOT_FOUND = 'NOT_FOUND';
ClipboardBackendError.INVALID_VALUE = 'INVALID_VALUE';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function list({ offset = 0, limit = 50 } = {}) {
  return indexTable.list({ offset, limit });
}

/**
 * Insert a new clipboard item or touch an existing one if its content_hash
 * matches.
 *
 * Returns the metadata row that landed in the index (no value field). On
 * dedup-hit, the existing row is touched (last_used_at bumped) and returned;
 * no new keychain entry is written.
 *
 * Caps at CLIPBOARD_CAP rows; oldest-by-last_used_at are pruned.
 */
async function append({ text, source = 'manual' }) {
  if (typeof text !== 'string' || text.length === 0) {
    throw new ClipboardBackendError(
      ClipboardBackendError.INVALID_VALUE,
      'text must be a non-empty string'
    );
  }

  const contentHash = sha256(text);
  const now = Date.now();

  const existing = await indexTable.getByContentHash(contentHash);
  if (existing) {
    await indexTable.touch(existing.id, now);
    return { ...existing, last_used_at: now, deduped: true };
  }

  const { type, preview } = detect(text);

  const id = await indexTable.insert({
    type,
    preview,
    content_hash: contentHash,
    created_at: now,
    last_used_at: now,
    source,
  });

  try {
    await keychain.set(id, text);
  } catch (err) {
    // Roll back the index row — keychain write is the load-bearing step.
    await indexTable.remove(id).catch(() => {});
    throw err;
  }

  await pruneToCapacity();

  return await indexTable.get(id);
}

/**
 * Fetch the value for an item (the click-to-insert path) and bump
 * last_used_at. Returns { row, value } where value is the keychain payload.
 */
async function use(id) {
  const row = await indexTable.get(id);
  if (!row) {
    throw new ClipboardBackendError(
      ClipboardBackendError.NOT_FOUND,
      `clipboard item ${id} not found`
    );
  }
  const value = await keychain.get(id);
  if (value === null) {
    // Index/keychain divergence — clean up the orphan row and report missing.
    await indexTable.remove(id).catch(() => {});
    throw new ClipboardBackendError(
      ClipboardBackendError.NOT_FOUND,
      `clipboard item ${id} value not in keychain (orphan row removed)`
    );
  }
  const now = Date.now();
  await indexTable.touch(id, now);
  return { row: { ...row, last_used_at: now }, value };
}

async function touch(id) {
  const row = await indexTable.get(id);
  if (!row) {
    throw new ClipboardBackendError(
      ClipboardBackendError.NOT_FOUND,
      `clipboard item ${id} not found`
    );
  }
  const now = Date.now();
  await indexTable.touch(id, now);
  return { ...row, last_used_at: now };
}

async function remove(id) {
  const row = await indexTable.get(id);
  if (!row) return false;
  await indexTable.remove(id);
  await keychain.del(id).catch(() => {}); // best-effort; index row is gone, value is unreachable
  return true;
}

/**
 * Delete-by-hash. Used by lib/secrets.js after a successful secret save —
 * if any clipboard row's content_hash matches the saved value, purge it.
 *
 * Returns the row that was removed, or null if no match.
 */
async function deleteByContentHash(contentHash) {
  const row = await indexTable.getByContentHash(contentHash);
  if (!row) return null;
  await indexTable.remove(row.id);
  await keychain.del(row.id).catch(() => {});
  return row;
}

async function clear() {
  const ids = await indexTable.listAllIds();
  await indexTable.clearAll();
  // Best-effort keychain cleanup; index is the source of truth and is empty.
  await Promise.all(ids.map((id) => keychain.del(id).catch(() => {})));
  return ids.length;
}

async function pruneToCapacity() {
  const total = await indexTable.count();
  if (total <= CLIPBOARD_CAP) return [];
  const overflow = total - CLIPBOARD_CAP;
  const oldestIds = await indexTable.listOldestIds(overflow);
  if (oldestIds.length === 0) return [];
  await indexTable.removeMany(oldestIds);
  await Promise.all(oldestIds.map((id) => keychain.del(id).catch(() => {})));
  return oldestIds;
}

module.exports = {
  list,
  append,
  use,
  touch,
  remove,
  deleteByContentHash,
  clear,
  CLIPBOARD_CAP,
  ClipboardBackendError,
};
