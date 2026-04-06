/**
 * @module columns resolver
 * @role Content path resolution for columns display type
 *
 * Used by: issues-viewer tabs (tickets by status)
 * Folders become columns. Items within each folder render as cards.
 */

const path = require('path');

module.exports = {
  resolveContentPath(projectRoot, viewId, view) {
    return path.join(view.viewRoot, 'content');
  },
};
