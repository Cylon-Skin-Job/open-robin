/**
 * Single-persistent strategy — one thread, always the same.
 *
 * No thread list, no creation UI. Opens the one thread that exists,
 * or creates it on first use. Used by the project-scoped root agent (future).
 */

const { v4: uuidv4 } = require('uuid');

module.exports = {
  canBrowseOld: false,
  canCreateNew: false,

  /**
   * Open the one persistent thread, or create it.
   *
   * @param {import('../ThreadManager').ThreadManager} manager
   * @returns {Promise<{ threadId: string, isNew: boolean }>}
   */
  async resolveThread(manager) {
    const threads = await manager.index.list();
    if (threads.length > 0) {
      return { threadId: threads[0].threadId, isNew: false };
    }

    const threadId = uuidv4();
    await manager.createThread(threadId, 'Conversation');
    return { threadId, isNew: true };
  },
};
