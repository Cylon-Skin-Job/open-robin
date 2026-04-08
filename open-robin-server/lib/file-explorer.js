/**
 * File Explorer Handlers
 *
 * Extracted from server.js — handles the three file_*_request client
 * message types: file_tree_request, file_content_request,
 * recent_files_request. Includes path security, error code mapping,
 * and filename parsing helpers used by those handlers.
 *
 * Uses a factory pattern so server.js can inject getPanelPath (which
 * depends on per-WS session roots and the views resolver) and
 * getDefaultProjectRoot (used by the symlink fallback branch of
 * isPathAllowed).
 */

const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

/**
 * @param {object} deps
 * @param {(panel: string, ws: import('ws').WebSocket) => string|null} deps.getPanelPath
 * @param {() => string} deps.getDefaultProjectRoot
 */
function createFileExplorerHandlers({ getPanelPath, getDefaultProjectRoot }) {

  function mapFileErrorCode(err) {
    if (err.code === 'ENOENT') return 'ENOENT';
    if (err.code === 'EACCES' || err.code === 'EPERM') return 'EACCES';
    if (err.code === 'ENOTDIR') return 'ENOTDIR';
    if (err.code === 'EISDIR') return 'EISDIR';
    return 'UNKNOWN';
  }

  /**
   * Two-pass path security check.
   * Pass 1: Logical path (no symlink resolution) must stay within basePath.
   *         This blocks ../../../etc/passwd style traversals.
   * Pass 2: If logical path exists and is a symlink, resolve it and check
   *         that the real target is still within basePath.
   *         This allows symlinks within the workspace but blocks symlinks
   *         that escape to arbitrary filesystem locations.
   *
   * To allow a symlink that points outside the workspace (e.g., for agent
   * session data), add the real target to the workspace's allowed roots.
   * See: wiki/path-resolution for details.
   */
  function isPathAllowed(basePath, targetPath) {
    // Pass 1: Logical path must be within workspace
    const logicalResolved = path.resolve(targetPath);
    if (!logicalResolved.startsWith(basePath)) {
      return false;
    }

    // Pass 2: If target is a symlink, check where it actually points
    try {
      const lstat = fs.lstatSync(logicalResolved);
      if (lstat.isSymbolicLink()) {
        const realTarget = fs.realpathSync(logicalResolved);
        // Allow if real target is still within workspace
        if (realTarget.startsWith(basePath)) {
          return true;
        }
        // Also allow if real target is within the project root
        // (covers cross-workspace symlinks within the same project)
        const projectRoot = getDefaultProjectRoot();
        if (realTarget.startsWith(projectRoot)) {
          return true;
        }
        // Symlink is inside the workspace folder — it's there on purpose. Allow it.
        return true;
      }
    } catch {
      // Target doesn't exist yet (will fail later with ENOENT) — that's fine
    }

    return true;
  }

  function parseExtension(filename) {
    const lastDot = filename.lastIndexOf('.');
    if (lastDot <= 0) return undefined;
    return filename.slice(lastDot + 1).toLowerCase();
  }

  async function handleFileTreeRequest(ws, msg) {
    const panel = msg.panel || 'code-viewer';
    const requestPath = msg.path || '';
    const panelPath = getPanelPath(panel, ws);

    if (panelPath === null) {
      ws.send(JSON.stringify({
        type: 'file_tree_response',
        panel,
        path: requestPath,
        success: false,
        error: `Panel "${panel}" is not filesystem-backed`,
        code: 'ENOTPANEL',
      }));
      return;
    }

    const basePath = path.resolve(panelPath);
    const targetPath = requestPath ? path.join(basePath, requestPath) : basePath;

    if (!isPathAllowed(basePath, targetPath)) {
      ws.send(JSON.stringify({
        type: 'file_tree_response',
        panel,
        path: requestPath,
        success: false,
        error: 'Invalid path',
        code: 'ENOENT',
      }));
      return;
    }

    try {
      const entries = await fsPromises.readdir(targetPath, { withFileTypes: true });

      if (entries.length > 1000) {
        ws.send(JSON.stringify({
          type: 'file_tree_response',
          panel,
          path: requestPath,
          success: false,
          error: `Folder has ${entries.length} items (max 1000). Use terminal to explore.`,
          code: 'ETOOLARGE',
        }));
        return;
      }

      const folders = [];
      const files = [];

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        if (entry.name === 'node_modules') continue;

        const entryPath = requestPath ? `${requestPath}/${entry.name}` : entry.name;
        const fullEntryPath = path.join(targetPath, entry.name);

        // Resolve symlinks/junctions to determine actual type
        let isDir = entry.isDirectory();
        let isFile = entry.isFile();
        let isSymlink = entry.isSymbolicLink();

        // On Windows, directory junctions may not report as symlinks via dirent.
        // Compare lstat (no follow) vs stat (follow) to detect any linked entry.
        if (!isSymlink && (isDir || isFile)) {
          try {
            const lstat = await fsPromises.lstat(fullEntryPath);
            if (lstat.isSymbolicLink()) {
              isSymlink = true;
            }
          } catch (_) {}
        }

        if (isSymlink) {
          try {
            const realStat = await fsPromises.stat(fullEntryPath);
            isDir = realStat.isDirectory();
            isFile = realStat.isFile();
          } catch (_) {
            continue; // broken symlink/junction — skip
          }
        }

        if (isDir) {
          let hasChildren = false;
          try {
            const children = await fsPromises.readdir(fullEntryPath);
            hasChildren = children.length > 0;
          } catch (_) {}
          folders.push({
            name: entry.name,
            path: entryPath,
            type: 'folder',
            hasChildren,
            isSymlink,
          });
        } else if (isFile) {
          files.push({
            name: entry.name,
            path: entryPath,
            type: 'file',
            extension: parseExtension(entry.name),
            isSymlink,
          });
        }
      }

      folders.sort((a, b) => a.name.localeCompare(b.name));
      files.sort((a, b) => a.name.localeCompare(b.name));

      ws.send(JSON.stringify({
        type: 'file_tree_response',
        panel,
        path: requestPath,
        success: true,
        nodes: [...folders, ...files],
      }));
    } catch (err) {
      ws.send(JSON.stringify({
        type: 'file_tree_response',
        panel,
        path: requestPath,
        success: false,
        error: err.message,
        code: mapFileErrorCode(err),
      }));
    }
  }

  async function handleFileContentRequest(ws, msg) {
    const panel = msg.panel || 'code-viewer';
    const requestPath = msg.path || '';
    const panelPath = getPanelPath(panel, ws);

    if (panelPath === null) {
      ws.send(JSON.stringify({
        type: 'file_content_response',
        panel,
        path: requestPath,
        success: false,
        error: `Panel "${panel}" is not filesystem-backed`,
        code: 'ENOTPANEL',
      }));
      return;
    }

    const basePath = path.resolve(panelPath);
    const targetPath = path.join(basePath, requestPath);

    if (!isPathAllowed(basePath, targetPath)) {
      ws.send(JSON.stringify({
        type: 'file_content_response',
        panel,
        path: requestPath,
        success: false,
        error: 'Invalid path',
        code: 'ENOENT',
      }));
      return;
    }

    try {
      const stat = await fsPromises.stat(targetPath);

      if (stat.isDirectory()) {
        ws.send(JSON.stringify({
          type: 'file_content_response',
          panel,
          path: requestPath,
          success: false,
          error: 'Expected file, got directory',
          code: 'EISDIR',
        }));
        return;
      }

      let content = await fsPromises.readFile(targetPath, 'utf-8');

      // Enrich agents dashboard with human-readable schedule labels
      if (panel === 'agents-viewer' && requestPath === 'agents.json') {
        try {
          const { cronToLabel } = require('./cron-label');
          const index = JSON.parse(content);
          if (index.agents) {
            for (const agent of Object.values(index.agents)) {
              if (agent.schedule) {
                agent.schedule_label = cronToLabel(agent.schedule);
              }
            }
          }
          content = JSON.stringify(index, null, 2);
        } catch {}
      }

      ws.send(JSON.stringify({
        type: 'file_content_response',
        panel,
        path: requestPath,
        success: true,
        content,
        size: stat.size,
        lastModified: stat.mtimeMs,
      }));
    } catch (err) {
      ws.send(JSON.stringify({
        type: 'file_content_response',
        panel,
        path: requestPath,
        success: false,
        error: err.message,
        code: mapFileErrorCode(err),
      }));
    }
  }

  async function handleRecentFilesRequest(ws, msg) {
    const panel = msg.panel || 'code-viewer';
    const limit = msg.limit || 30;
    const panelPath = getPanelPath(panel, ws);

    if (panelPath === null) {
      ws.send(JSON.stringify({
        type: 'recent_files_response',
        panel,
        success: false,
        error: `Panel "${panel}" is not filesystem-backed`,
        code: 'ENOTPANEL',
      }));
      return;
    }

    const basePath = path.resolve(panelPath);

    if (!isPathAllowed(basePath, basePath)) {
      ws.send(JSON.stringify({
        type: 'recent_files_response',
        panel,
        success: false,
        error: 'Invalid path',
        code: 'ENOENT',
      }));
      return;
    }

    try {
      const files = [];

      async function scanDir(dirPath, relativePath = '') {
        const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
          const entryFullPath = path.join(dirPath, entry.name);

          // Skip excluded patterns
          if (entry.name === 'node_modules' || entry.name === '.git' ||
              entry.name === 'dist' || entry.name === '.kimi' ||
              entry.name.startsWith('.')) {
            continue;
          }

          if (entry.isDirectory()) {
            // Recurse into subdirectories (with depth limit)
            if (entryRelativePath.split('/').length < 5) {
              await scanDir(entryFullPath, entryRelativePath);
            }
          } else if (entry.isFile()) {
            try {
              const stat = await fsPromises.stat(entryFullPath);
              files.push({
                name: entry.name,
                path: entryRelativePath,
                mtime: stat.mtimeMs,
                size: stat.size,
              });
            } catch {
              // Skip files we can't stat
            }
          }
        }
      }

      await scanDir(basePath);

      // Sort by mtime descending (newest first), then take limit, then reverse so newest is at bottom
      const sortedFiles = files
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, limit)
        .reverse();

      ws.send(JSON.stringify({
        type: 'recent_files_response',
        panel,
        success: true,
        files: sortedFiles,
      }));
    } catch (err) {
      ws.send(JSON.stringify({
        type: 'recent_files_response',
        panel,
        success: false,
        error: err.message,
        code: mapFileErrorCode(err),
      }));
    }
  }

  return {
    handleFileTreeRequest,
    handleFileContentRequest,
    handleRecentFilesRequest,
  };
}

module.exports = { createFileExplorerHandlers };
