/**
 * @module tabbed resolver
 * @role Content path resolution for tabbed display type
 *
 * Used by: issues-viewer, settings-viewer
 * Subfolders become pill tabs. Each subfolder declares its own content type.
 */

const path = require('path');

module.exports = {
  resolveContentPath(projectRoot, viewId, view) {
    return path.join(view.viewRoot, 'content');
  },
};
