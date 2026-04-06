/**
 * Generic file watcher with pluggable filters.
 *
 * Knows nothing about wikis, tickets, or any specific domain.
 * Consumers register filter objects to react to file events.
 *
 * Every event carries a context object:
 *   { parentDir, type, ext, basename, delta, parentStats: { files, folders } }
 *
 * Uses fs.watch with { recursive: true } (macOS/Darwin).
 */

const fs = require('fs');
const path = require('path');

const DEBOUNCE_MS = 500;
const RENAME_WINDOW_MS = 2000;

const DEFAULT_EXCLUDES = [
  'node_modules', 'dist', '.git', '.kimi',
  'ai/views/*/threads',
  'ai/views/*/runs',
  'ai/views/issues-viewer/done',
  '*.log', 'CHAT.md', 'history.json',
  'wire-debug.log', 'server-live.log',
];

/**
 * Check whether a relative file path matches any exclusion pattern.
 */
function isExcluded(filePath, excludes) {
  for (const pattern of excludes) {
    if (pattern.startsWith('*')) {
      if (filePath.endsWith(pattern.slice(1))) return true;
    } else if (pattern.includes('*')) {
      const [prefix, suffix] = pattern.split('*');
      if (filePath.includes(prefix) && filePath.includes(suffix)) return true;
    } else {
      if (filePath.includes(pattern)) return true;
    }
  }
  return false;
}

/**
 * Stat a directory: count files and folders (non-recursive, one level).
 * Returns { files: 0, folders: 0 } on error.
 */
function statDir(absoluteDir) {
  try {
    const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
    let files = 0, folders = 0;
    for (const e of entries) {
      if (e.isDirectory()) folders++;
      else files++;
    }
    return { files, folders };
  } catch {
    return { files: 0, folders: 0 };
  }
}

/**
 * Count lines, words, and tokens for a file.
 * Uses gpt-tokenizer (cl100k_base) for real token counts.
 * Returns { lines: 0, words: 0, tokens: 0, size: 0 } for dirs or on error.
 */
function statFile(absolutePath) {
  try {
    const stat = fs.statSync(absolutePath);
    if (stat.isDirectory()) return { lines: 0, words: 0, tokens: 0, size: 0 };

    const content = fs.readFileSync(absolutePath, 'utf8');
    const lines = content.split('\n').length;
    const words = content.split(/\s+/).filter(Boolean).length;

    const { countTokens } = require('../tokenizer');
    const tokens = countTokens(content);

    return { lines, words, tokens, size: stat.size };
  } catch {
    return { lines: 0, words: 0, tokens: 0, size: 0 };
  }
}

/**
 * Build the context object that accompanies every event.
 *
 * @param {string} projectRoot
 * @param {string} filePath - Relative path from project root
 * @param {string} event - 'create' | 'delete' | 'modify' | 'rename'
 * @returns {{ parentDir, type, ext, basename, delta, parentStats, fileStats }}
 */
function buildContext(projectRoot, filePath, event) {
  const parentDir = path.dirname(filePath);
  const basename = path.basename(filePath);
  const ext = path.extname(filePath) || null;
  const absolutePath = path.join(projectRoot, filePath);
  const absoluteParent = path.join(projectRoot, parentDir);

  // Determine if this is a file or directory
  let type = 'file';
  try {
    const stat = fs.statSync(absolutePath);
    if (stat.isDirectory()) type = 'directory';
  } catch {
    type = 'file';
  }

  // Delta: +1 create, -1 delete, 0 modify/rename
  const deltaMap = { create: 1, delete: -1, modify: 0, rename: 0 };
  const delta = deltaMap[event] || 0;

  // Parent folder stats (current snapshot)
  const parentStats = statDir(absoluteParent);

  // File stats: lines, words, tokens, size (only for files that still exist)
  const fileStats = (event !== 'delete' && type === 'file')
    ? statFile(absolutePath)
    : { lines: 0, words: 0, tokens: 0, size: 0 };

  return { parentDir, type, ext, basename, delta, parentStats, fileStats };
}

/**
 * Create a file watcher on projectRoot.
 *
 * @param {string} projectRoot - Absolute path to the project root
 * @param {object} [options]
 * @param {string[]} [options.excludes] - Additional exclusion patterns
 * @returns {{ close: Function, addFilter: Function }}
 */
function createWatcher(projectRoot, options = {}) {
  const excludes = DEFAULT_EXCLUDES.concat(options.excludes || []);
  const filters = [];

  // Debounce maps
  const pending = new Map();
  const pendingModify = new Map();

  // Rename detection
  const recentDeletes = new Map();

  function notifyFilters(event, filePath, extra) {
    const ctx = buildContext(projectRoot, filePath, event);

    for (const filter of filters) {
      try {
        if (!filter.shouldWatch(filePath, ctx)) continue;

        const handlerMap = {
          delete: filter.onDelete,
          create: filter.onCreate,
          modify: filter.onModify,
          rename: filter.onRename,
        };

        const handler = handlerMap[event];
        if (typeof handler !== 'function') continue;

        if (event === 'rename') {
          const newCtx = buildContext(projectRoot, extra.newPath, event);
          handler(extra.oldPath, extra.newPath, ctx, newCtx);
        } else {
          handler(filePath, ctx);
        }
        console.log(`[Watcher:${filter.name}] handled ${event}`);
      } catch (err) {
        console.error(`[Watcher:${filter.name}] error on ${event}:`, err.message);
      }
    }
  }

  function checkForRenameTarget(filename) {
    const dir = path.dirname(filename);
    for (const [deletedFile, entry] of recentDeletes) {
      if (path.dirname(deletedFile) !== dir) continue;
      if (Date.now() - entry.timestamp > RENAME_WINDOW_MS) continue;

      // Match: delete + create in same dir within window
      recentDeletes.delete(deletedFile);
      console.log(`[Watcher] rename: ${deletedFile} -> ${filename}`);
      notifyFilters('rename', deletedFile, { oldPath: deletedFile, newPath: filename });
      return true;
    }
    return false;
  }

  function handleFileEvent(eventType, filename) {
    if (!filename) return;

    if (eventType === 'change') {
      if (isExcluded(filename, excludes)) return;
      clearTimeout(pendingModify.get(filename));
      pendingModify.set(filename, setTimeout(() => {
        pendingModify.delete(filename);
        console.log(`[Watcher] modify: ${filename}`);
        notifyFilters('modify', filename);
      }, DEBOUNCE_MS));
      return;
    }

    if (eventType !== 'rename') return;
    if (isExcluded(filename, excludes)) return;

    clearTimeout(pending.get(filename));
    pending.set(filename, setTimeout(() => {
      pending.delete(filename);

      const absolutePath = path.join(projectRoot, filename);
      const stillExists = fs.existsSync(absolutePath);

      if (stillExists) {
        // File created or renamed TO this path
        const wasRename = checkForRenameTarget(filename);
        if (!wasRename) {
          console.log(`[Watcher] create: ${filename}`);
          notifyFilters('create', filename);
        }
        return;
      }

      // File is gone — possible delete or rename-from
      recentDeletes.set(filename, { timestamp: Date.now() });

      setTimeout(() => {
        const entry = recentDeletes.get(filename);
        if (!entry) return; // matched to rename
        recentDeletes.delete(filename);
        console.log(`[Watcher] delete: ${filename}`);
        notifyFilters('delete', filename);
      }, RENAME_WINDOW_MS);
    }, DEBOUNCE_MS));
  }

  let watcher = null;
  try {
    watcher = fs.watch(projectRoot, { recursive: true }, handleFileEvent);
    console.log(`[Watcher] Watching ${projectRoot}`);
  } catch (err) {
    console.error(`[Watcher] Failed to start:`, err.message);
  }

  return {
    close() {
      if (watcher) {
        watcher.close();
        watcher = null;
      }
      for (const t of pending.values()) clearTimeout(t);
      for (const t of pendingModify.values()) clearTimeout(t);
      pending.clear();
      pendingModify.clear();
      recentDeletes.clear();
      console.log('[Watcher] Stopped');
    },

    addFilter(filter) {
      if (!filter || typeof filter.shouldWatch !== 'function') {
        console.error('[Watcher] Invalid filter — must have shouldWatch()');
        return;
      }
      filters.push(filter);
      console.log(`[Watcher] Filter registered: ${filter.name}`);
    },
  };
}

module.exports = { createWatcher, isExcluded, buildContext, statDir, statFile };
