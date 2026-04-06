/**
 * Daily-rolling strategy — one thread per day, auto-selected.
 *
 * On open: find today's thread by date field, or create a new UUID thread
 * tagged with today's date. Old threads are viewable but not resumable.
 * Used by agent personas and the issues panel.
 */

const { v4: uuidv4 } = require('uuid');

module.exports = {
  canBrowseOld: true,
  canCreateNew: false,

  /**
   * Find or create today's thread.
   *
   * @param {import('../ThreadManager').ThreadManager} manager
   * @returns {Promise<{ threadId: string, isNew: boolean }>}
   */
  async resolveThread(manager) {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    const threads = await manager.index.list();
    const existing = threads.find(t => t.entry.date === today);

    if (existing) {
      return { threadId: existing.threadId, isNew: false };
    }

    // Create new UUID thread tagged with today's date
    const threadId = uuidv4();
    await manager.createThread(threadId, today);
    await manager.index.setDate(threadId, today);
    return { threadId, isNew: true };
  },
};
