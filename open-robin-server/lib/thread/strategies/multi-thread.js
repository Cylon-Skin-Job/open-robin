/**
 * Multi-thread strategy — manual thread selection.
 *
 * User sees a thread list, picks one to open, or creates new.
 * No auto-selection. Used by the explorer panel.
 */

module.exports = {
  canBrowseOld: true,
  canCreateNew: true,

  /**
   * Returns null — caller must show thread list or create new.
   * Multi-thread doesn't auto-select.
   */
  async resolveThread(_manager) {
    return { threadId: null, isNew: false };
  },
};
