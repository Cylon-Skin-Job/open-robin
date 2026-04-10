/**
 * ThreadIndex - Thread metadata CRUD against SQLite
 *
 * One job: read/write thread metadata in the threads table.
 * MRU ordering via updated_at DESC (replaces JS object insertion-order trick).
 */

const { getDb } = require('../db');

class ThreadIndex {
  /**
   * @param {string} projectId - Project identifier (basename of projectRoot)
   * @param {'project'|'view'} scope - Thread scope
   * @param {string|null} viewId - View name when scope='view'; null when scope='project'
   */
  constructor(projectId, scope, viewId) {
    if (!projectId) throw new Error('ThreadIndex: projectId is required');
    if (scope !== 'project' && scope !== 'view') {
      throw new Error(`ThreadIndex: scope must be 'project' or 'view', got "${scope}"`);
    }
    if (scope === 'view' && !viewId) {
      throw new Error('ThreadIndex: viewId is required when scope="view"');
    }
    this.projectId = projectId;
    this.scope = scope;
    this.viewId = scope === 'view' ? viewId : null;
  }

  /**
   * No-op — kept for caller compatibility. Migrations handle schema.
   */
  async init() {}

  /**
   * Get all threads ordered by MRU (most recent first)
   * @returns {Promise<Array<{threadId: string, entry: object}>>}
   */
  async list() {
    const db = getDb();
    const query = db('threads')
      .where('project_id', this.projectId)
      .where('scope', this.scope);

    if (this.scope === 'view') {
      query.where('view_id', this.viewId);
    }

    const rows = await query.orderBy('updated_at', 'desc');

    return rows.map((row) => ({
      threadId: row.thread_id,
      entry: this._toEntry(row),
    }));
  }

  /**
   * Get a single thread by ID
   * @param {string} threadId
   * @returns {Promise<object|null>}
   */
  async get(threadId) {
    const db = getDb();
    const row = await db('threads').where('thread_id', threadId).first();
    return row ? this._toEntry(row) : null;
  }

  /**
   * Create a new thread entry
   * @param {string} threadId
   * @param {string|null} [name=null] - Display name; null means "fall back to ID" in the UI
   * @param {object} [options]
   * @param {string} [options.harnessId='kimi']
   * @param {object} [options.harnessConfig]
   * @returns {Promise<object>}
   */
  async create(threadId, name = null, options = {}) {
    const db = getDb();
    const now = Date.now();
    const createdAt = new Date().toISOString();
    const harnessId = options.harnessId || 'kimi';
    const harnessConfig = options.harnessConfig ? JSON.stringify(options.harnessConfig) : null;

    await db('threads').insert({
      thread_id: threadId,
      project_id: this.projectId,
      scope: this.scope,
      view_id: this.viewId,  // null when scope='project'
      name,
      created_at: createdAt,
      message_count: 0,
      status: 'suspended',
      updated_at: now,
      harness_id: harnessId,
      harness_config: harnessConfig,
    });

    return {
      name,
      createdAt,
      messageCount: 0,
      status: 'suspended',
      harnessId,
      scope: this.scope,
      viewId: this.viewId,
    };
  }

  /**
   * Update a thread entry
   * @param {string} threadId
   * @param {object} updates - camelCase fields
   * @returns {Promise<object|null>}
   */
  async update(threadId, updates) {
    const db = getDb();
    const dbUpdates = {};

    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.messageCount !== undefined) dbUpdates.message_count = updates.messageCount;
    if (updates.resumedAt !== undefined) dbUpdates.resumed_at = updates.resumedAt;
    if (updates.updatedAt !== undefined) dbUpdates.updated_at = updates.updatedAt;

    if (Object.keys(dbUpdates).length === 0) return this.get(threadId);

    const count = await db('threads').where('thread_id', threadId).update(dbUpdates);
    if (count === 0) return null;

    return this.get(threadId);
  }

  /**
   * Rename a thread
   * @param {string} threadId
   * @param {string} newName
   */
  async rename(threadId, newName) {
    return this.update(threadId, { name: newName });
  }

  /**
   * Mark thread as active and bump MRU
   * @param {string} threadId
   */
  async activate(threadId) {
    return this.update(threadId, { status: 'active', updatedAt: Date.now() });
  }

  /**
   * Mark thread as suspended
   * @param {string} threadId
   */
  async suspend(threadId) {
    return this.update(threadId, { status: 'suspended' });
  }

  /**
   * Increment message count
   * @param {string} threadId
   */
  async incrementMessageCount(threadId) {
    const db = getDb();
    const count = await db('threads')
      .where('thread_id', threadId)
      .increment('message_count', 1);
    if (count === 0) return null;
    return this.get(threadId);
  }

  /**
   * Update resumed timestamp
   * @param {string} threadId
   */
  async markResumed(threadId) {
    return this.update(threadId, { resumedAt: new Date().toISOString() });
  }

  /**
   * Delete a thread (CASCADE deletes exchanges)
   * @param {string} threadId
   * @returns {Promise<boolean>}
   */
  async delete(threadId) {
    const db = getDb();
    const count = await db('threads').where('thread_id', threadId).del();
    return count > 0;
  }

  /**
   * Bump MRU timestamp
   * @param {string} threadId
   */
  async touch(threadId) {
    return this.update(threadId, { updatedAt: Date.now() });
  }

  /**
   * Rebuild — no-op for SQLite (no filesystem index to reconstruct)
   * @returns {Promise<number>}
   */
  async rebuild() {
    const db = getDb();
    const query = db('threads')
      .where('project_id', this.projectId)
      .where('scope', this.scope);

    if (this.scope === 'view') {
      query.where('view_id', this.viewId);
    }

    const rows = await query;
    return rows.length;
  }

  /**
   * Map a DB row (snake_case) to the ThreadEntry shape (camelCase)
   * @private
   */
  _toEntry(row) {
    const entry = {
      name: row.name,
      createdAt: row.created_at,
      messageCount: row.message_count,
      status: row.status,
      scope: row.scope,
      viewId: row.view_id,
    };
    if (row.resumed_at) entry.resumedAt = row.resumed_at;
    if (row.harness_id) entry.harnessId = row.harness_id;
    if (row.harness_config) {
      try {
        entry.harnessConfig = JSON.parse(row.harness_config);
      } catch {
        entry.harnessConfig = null;
      }
    }
    return entry;
  }
}

module.exports = { ThreadIndex };
