/**
 * @module library resolver
 * @role Content path resolution for library display type
 *
 * Used by: library-viewer
 * Hierarchical document reader. May use a CONTENT.md pointer to
 * reference data elsewhere in the repo.
 */

const path = require('path');
const fs = require('fs');

module.exports = {
  resolveContentPath(projectRoot, viewId, view) {
    // Check for CONTENT.md pointer file
    const pointerPath = path.join(view.viewRoot, 'content', 'CONTENT.md');
    if (fs.existsSync(pointerPath)) {
      try {
        const raw = fs.readFileSync(pointerPath, 'utf-8');
        const match = raw.match(/root:\s*["']?\$\{PROJECT_ROOT\}\/?(.*?)["']?\s*$/m);
        if (match) {
          const relative = match[1] || '';
          return path.join(projectRoot, relative);
        }
      } catch {
        // Fall through to default
      }
    }

    return path.join(view.viewRoot, 'content');
  },
};
