/**
 * HistoryFile - Exchange CRUD against SQLite
 *
 * One job: read/write exchange data in the exchanges table.
 * The assistant column stores { parts: [...] } as JSON text.
 * JSON.parse on read must return the exact shape the client expects.
 */

const { getDb } = require('../db');

const SCHEMA_VERSION = '1.0.0';

class HistoryFile {
  /**
   * @param {string} threadId
   */
  constructor(threadId) {
    this.threadId = threadId;
  }

  /**
   * No-op — thread row already exists, exchanges start empty.
   * Kept for caller compatibility.
   * @param {string} threadId
   * @returns {Promise<object>}
   */
  async create(threadId) {
    const now = Date.now();
    return {
      version: SCHEMA_VERSION,
      threadId,
      createdAt: now,
      updatedAt: now,
      exchanges: [],
    };
  }

  /**
   * Read all exchanges for this thread.
   * Reconstructs the HistoryData shape that callers expect.
   * @returns {Promise<object|null>}
   */
  async read() {
    const db = getDb();
    const rows = await db('exchanges')
      .where('thread_id', this.threadId)
      .orderBy('seq', 'asc');

    if (rows.length === 0) return null;

    return {
      version: SCHEMA_VERSION,
      threadId: this.threadId,
      createdAt: rows[0].ts,
      updatedAt: rows[rows.length - 1].ts,
      exchanges: rows.map(this._toExchange),
    };
  }

  /**
   * Add a complete exchange.
   * @param {string} threadId
   * @param {string} userInput
   * @param {Array} parts - Assistant response parts
   * @param {object} [metadata] - Optional metadata (contextUsage, tokenUsage, etc.)
   * @returns {Promise<object>} Exchange object
   */
  async addExchange(threadId, userInput, parts, metadata = null) {
    const db = getDb();
    const seq = (await this.countExchanges()) + 1;
    const ts = Date.now();
    const assistant = JSON.stringify({ parts: parts.map((p) => ({ ...p })) });

    await db('exchanges').insert({
      thread_id: threadId,
      seq,
      ts,
      user_input: userInput,
      assistant,
      metadata: JSON.stringify(metadata || {}),
    });

    return {
      seq,
      ts,
      user: userInput,
      assistant: { parts: parts.map((p) => ({ ...p })) },
      metadata: metadata || {},
    };
  }

  /**
   * Check if any exchanges exist for this thread.
   * @returns {Promise<boolean>}
   */
  async exists() {
    const db = getDb();
    const row = await db('exchanges')
      .where('thread_id', this.threadId)
      .first();
    return !!row;
  }

  /**
   * Get exchange count.
   * @returns {Promise<number>}
   */
  async countExchanges() {
    const db = getDb();
    const result = await db('exchanges')
      .where('thread_id', this.threadId)
      .count('* as count')
      .first();
    return result?.count || 0;
  }

  /**
   * Get the last exchange (for continuation).
   * @returns {Promise<object|null>}
   */
  async getLastExchange() {
    const db = getDb();
    const row = await db('exchanges')
      .where('thread_id', this.threadId)
      .orderBy('seq', 'desc')
      .first();

    return row ? this._toExchange(row) : null;
  }

  /**
   * Map a DB row to the Exchange shape the client expects.
   * @private
   */
  _toExchange(row) {
    // Parse metadata - handle both old array format '[]' and new object format '{}'
    let parsedMetadata;
    try {
      parsedMetadata = JSON.parse(row.metadata || '{}');
      // Handle legacy array format
      if (Array.isArray(parsedMetadata)) {
        parsedMetadata = {};
      }
    } catch {
      parsedMetadata = {};
    }

    return {
      seq: row.seq,
      ts: row.ts,
      user: row.user_input,
      assistant: JSON.parse(row.assistant),
      metadata: parsedMetadata,
    };
  }
}

module.exports = { HistoryFile, SCHEMA_VERSION };
