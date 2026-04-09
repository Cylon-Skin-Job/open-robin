// Declarative filter loader — reads .md filter definitions from a directory
// and converts them into watcher filter objects.
//
// Filter files use YAML frontmatter (same pattern as tickets, prompts, rules).
// See filters/*.md for examples.
//
// Also loads .js files as programmatic filters (must export a filter object).
//
// Frontmatter parsing is delegated to lib/frontmatter/ (see SPEC-25).

const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('../frontmatter');

/**
 * Simple glob matcher for filter match/exclude patterns.
 * Supports: *, **, specific extensions.
 */
function matchesPattern(filePath, pattern) {
  if (pattern === filePath) return true;

  // Extension match: "*.js"
  if (pattern.startsWith('*.')) {
    return filePath.endsWith(pattern.slice(1));
  }

  // Double-star glob: "src/**/*.js"
  if (pattern.includes('**')) {
    const [prefix, suffix] = pattern.split('**');
    const prefixOk = !prefix || filePath.startsWith(prefix.replace(/\/$/, ''));
    const suffixOk = !suffix || matchesPattern(filePath, '*' + suffix.replace(/^\//, ''));
    return prefixOk && suffixOk;
  }

  // Single-star glob: "src/*.js"
  if (pattern.includes('*')) {
    const [before, after] = pattern.split('*');
    return filePath.startsWith(before) && filePath.endsWith(after);
  }

  // Segment match
  return filePath.includes(pattern);
}

/**
 * Apply template variables to a string.
 * Replaces {{key}} and {{nested.key}} with values from context.
 */
function applyTemplate(template, vars) {
  if (!template) return '';
  return template.replace(/\{\{(\w+(?:\.\w+)?)\}\}/g, (_, key) => {
    if (key.includes('.')) {
      const [obj, prop] = key.split('.');
      return vars[obj]?.[prop] ?? '';
    }
    return vars[key] ?? '';
  });
}

/**
 * Convert a parsed frontmatter definition into a watcher filter object.
 */
/**
 * Evaluate a condition expression against context variables.
 * Supports: >, <, >=, <=, ===, !==
 * Examples: "fileStats.tokens > 500", "parentStats.files > 9"
 */
function evaluateCondition(condition, vars) {
  if (!condition) return true;

  const match = condition.match(/^(\w+(?:\.\w+)?)\s*(>|<|>=|<=|===|!==)\s*(.+)$/);
  if (!match) {
    console.warn(`[FilterLoader] Invalid condition: ${condition}`);
    return true; // don't block on bad syntax
  }

  const [, keyPath, op, rawValue] = match;
  let left;
  if (keyPath.includes('.')) {
    const [obj, prop] = keyPath.split('.');
    left = vars[obj]?.[prop];
  } else {
    left = vars[keyPath];
  }

  // Parse right side
  let right = rawValue.trim();
  if (right === 'true') right = true;
  else if (right === 'false') right = false;
  else if (/^\d+$/.test(right)) right = parseInt(right, 10);
  else right = right.replace(/^["']|["']$/g, '');

  switch (op) {
    case '>': return left > right;
    case '<': return left < right;
    case '>=': return left >= right;
    case '<=': return left <= right;
    case '===': return left === right;
    case '!==': return left !== right;
    default: return true;
  }
}

function buildFilter(def, actionHandlers) {
  const events = def.events || ['delete', 'rename', 'create', 'modify'];
  const matchPatterns = Array.isArray(def.match) ? def.match : def.match ? [def.match] : null;
  const excludePatterns = Array.isArray(def.exclude) ? def.exclude : def.exclude ? [def.exclude] : [];
  const condition = def.condition || null;

  return {
    name: def.name || 'unnamed',
    _definition: def,

    shouldWatch(filePath, ctx) {
      // Check excludes first
      for (const pat of excludePatterns) {
        if (matchesPattern(filePath, pat)) return false;
      }
      // If no match patterns, watch everything (filter by event instead)
      if (!matchPatterns) return true;
      // Check match patterns
      return matchPatterns.some(pat => matchesPattern(filePath, pat));
    },

    onDelete(filePath, ctx) {
      if (!events.includes('delete')) return;
      if (!evaluateCondition(condition, { ...ctx, filePath })) return;
      executeAction(def, 'delete', filePath, ctx, actionHandlers);
    },

    onCreate(filePath, ctx) {
      if (!events.includes('create')) return;
      if (!evaluateCondition(condition, { ...ctx, filePath })) return;
      executeAction(def, 'create', filePath, ctx, actionHandlers);
    },

    onModify(filePath, ctx) {
      if (!events.includes('modify')) return;
      if (!evaluateCondition(condition, { ...ctx, filePath })) return;
      executeAction(def, 'modify', filePath, ctx, actionHandlers);
    },

    onRename(oldPath, newPath, oldCtx, newCtx) {
      if (!events.includes('rename')) return;
      const ctx = { ...oldCtx, newPath, oldPath };
      if (!evaluateCondition(condition, { ...ctx, filePath: oldPath })) return;
      executeAction(def, 'rename', oldPath, ctx, actionHandlers);
    },
  };
}

/**
 * Execute the action defined in a filter.
 */
function executeAction(def, event, filePath, ctx, handlers) {
  const vars = {
    filePath,
    event,
    basename: ctx?.basename || path.basename(filePath),
    ext: ctx?.ext || path.extname(filePath),
    parentDir: ctx?.parentDir || path.dirname(filePath),
    delta: ctx?.delta ?? 0,
    type: ctx?.type || 'file',
    parentStats: ctx?.parentStats || { files: 0, folders: 0 },
    fileStats: ctx?.fileStats || { lines: 0, words: 0, tokens: 0, size: 0 },
    newPath: ctx?.newPath || '',
    oldPath: ctx?.oldPath || filePath,
  };

  const action = def.action;
  if (!action) {
    console.log(`[Filter:${def.name}] ${event}: ${filePath}`);
    return;
  }

  const handler = handlers[action];
  if (typeof handler === 'function') {
    handler(def, vars);
  } else {
    console.warn(`[Filter:${def.name}] Unknown action: ${action}`);
  }
}

/**
 * Load all filter definitions from a directory.
 * Reads .md files (declarative) and .js files (programmatic).
 *
 * @param {string} filterDir - Directory containing filter files
 * @param {Object} actionHandlers - { 'create-ticket': fn, 'log': fn, ... }
 * @returns {Array} Array of filter objects ready for watcher.addFilter()
 */
function loadFilters(filterDir, actionHandlers = {}) {
  const filters = [];

  if (!fs.existsSync(filterDir)) {
    console.log(`[FilterLoader] Directory not found: ${filterDir}`);
    return filters;
  }

  const files = fs.readdirSync(filterDir);

  for (const file of files) {
    const fullPath = path.join(filterDir, file);

    if (file.endsWith('.md')) {
      // Declarative filter
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        const { frontmatter } = parseFrontmatter(content, 'filter');
        if (!frontmatter.name) {
          frontmatter.name = path.basename(file, '.md');
        }
        filters.push(buildFilter(frontmatter, actionHandlers));
        console.log(`[FilterLoader] Loaded declarative filter: ${frontmatter.name}`);
      } catch (err) {
        console.error(`[FilterLoader] Failed to load ${file}:`, err.message);
      }
    } else if (file.endsWith('.js')) {
      // Programmatic filter — must directly export { name, shouldWatch, ... }
      // Factory modules (like wiki-sources.js) are loaded manually, not auto-loaded
      try {
        const absPath = path.resolve(fullPath);
        const mod = require(absPath);
        if (typeof mod.shouldWatch === 'function') {
          filters.push(mod);
          console.log(`[FilterLoader] Loaded programmatic filter: ${mod.name || file}`);
        }
        // Skip factory modules that export createXxxFilter instead
      } catch (err) {
        // Not a direct filter export — skip silently
      }
    }
  }

  return filters;
}

module.exports = { loadFilters, matchesPattern, applyTemplate, buildFilter, evaluateCondition };
