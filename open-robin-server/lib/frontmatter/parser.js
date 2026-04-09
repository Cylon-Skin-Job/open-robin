/**
 * Frontmatter parser — lift-and-shifted from lib/watcher/filter-loader.js
 * as part of SPEC-25.
 *
 * Parses YAML frontmatter from a markdown string. Returns
 * { frontmatter: {}, body: '' }. When no --- block is present, returns
 * { frontmatter: {}, body: content } (empty frontmatter, body = full input).
 *
 * Supports: nested objects (via indentation stack), inline arrays,
 * booleans, numbers, quoted strings, and line comments (#).
 *
 * Does NOT enforce catalog types — see lib/frontmatter/index.js for the
 * type-gated public API. Callers should import from there, not from
 * this file directly.
 */

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const fm = {};
  // Stack-based nesting: each entry is { key, obj, indent }
  let stack = [];

  for (const line of match[1].split('\n')) {
    // Skip blank lines and comments
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const raw = line.slice(colonIdx + 1).trim();
    const indent = line.search(/\S/);

    // Pop stack entries at same or deeper indent (we're back at a sibling/parent level)
    while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
      const popped = stack.pop();
      const parent = stack.length > 0 ? stack[stack.length - 1].obj : fm;
      parent[popped.key] = popped.obj;
    }

    if (raw === '' || raw === '|') {
      // Start of nested object
      stack.push({ key, obj: {}, indent });
      continue;
    }

    // Regular key: value — add to current nesting target
    const target = stack.length > 0 ? stack[stack.length - 1].obj : fm;
    target[key] = parseValue(raw);
  }

  // Flush remaining stack
  while (stack.length > 0) {
    const popped = stack.pop();
    const parent = stack.length > 0 ? stack[stack.length - 1].obj : fm;
    if (Object.keys(popped.obj).length > 0) {
      parent[popped.key] = popped.obj;
    }
  }

  return { frontmatter: fm, body: match[2].trim() };
}

/**
 * Parse a YAML value: arrays, booleans, numbers, strings.
 */
function parseValue(raw) {
  if (!raw) return null;

  // Inline array: [a, b, c]
  if (raw.startsWith('[') && raw.endsWith(']')) {
    return raw.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
  }
  // Boolean
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  // Number
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  // Quoted string
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

module.exports = { parseFrontmatter, parseValue };
