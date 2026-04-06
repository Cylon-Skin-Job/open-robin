/**
 * @module navigation resolver
 * @role Content path resolution for navigation display type
 *
 * Used by: wiki-viewer, email-viewer
 * Content lives in the view's content/ folder.
 */

const path = require('path');

module.exports = {
  resolveContentPath(projectRoot, viewId, view) {
    return path.join(view.viewRoot, 'content');
  },
};
