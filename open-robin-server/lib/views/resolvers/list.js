/**
 * @module list resolver
 * @role Content path resolution for list display type
 *
 * The primitive. Renders items from a folder as a scrollable list.
 * Base component that navigation, columns, and others compose from.
 */

const path = require('path');

module.exports = {
  resolveContentPath(projectRoot, viewId, view) {
    return path.join(view.viewRoot, 'content');
  },
};
