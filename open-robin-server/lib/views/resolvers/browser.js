/**
 * @module browser resolver
 * @role Content path resolution for browser display type
 *
 * Used by: browser-viewer
 * Embedded widget. No content folder — returns the view root.
 */

module.exports = {
  resolveContentPath(projectRoot, viewId, view) {
    return view.viewRoot;
  },
};
