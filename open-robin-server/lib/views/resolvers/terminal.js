/**
 * @module terminal resolver
 * @role Content path resolution for terminal display type
 *
 * Used by: terminal-viewer
 * Embedded widget. No content folder — returns the view root.
 */

module.exports = {
  resolveContentPath(projectRoot, viewId, view) {
    return view.viewRoot;
  },
};
