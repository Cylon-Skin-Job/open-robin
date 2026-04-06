/**
 * @module tiled-rows resolver
 * @role Content path resolution for tiled-rows display type
 *
 * Used by: capture-viewer, agents-viewer, docs-viewer
 * Folders within content/ become row headers. Items within each folder render as tiles.
 */

const path = require('path');

module.exports = {
  resolveContentPath(projectRoot, viewId, view) {
    return path.join(view.viewRoot, 'content');
  },
};
