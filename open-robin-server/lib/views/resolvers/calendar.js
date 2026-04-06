/**
 * @module calendar resolver
 * @role Content path resolution for calendar display type
 *
 * Used by: calendar-viewer
 * Time-based view. Folder structure and frontmatter mapping TBD.
 */

const path = require('path');

module.exports = {
  resolveContentPath(projectRoot, viewId, view) {
    return path.join(view.viewRoot, 'content');
  },
};
