/**
 * Frontmatter serializer — the write-side counterpart to parser.js.
 *
 * Converts a flat JS object into a YAML frontmatter block (--- delimited).
 *
 * Scope: MVP supports strings, numbers, booleans, null, and inline arrays.
 * Nested objects are NOT supported in SPEC-25 — if a caller passes one,
 * the serializer throws loudly. Add nested-object support when a real
 * caller needs it, not before.
 *
 * Round-trip guarantee: parse(serialize(x)) deep-equals x for all
 * supported value types.
 */

function serializeFrontmatter(data) {
  if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
    return '';
  }

  const lines = ['---'];
  for (const [key, value] of Object.entries(data)) {
    lines.push(`${key}: ${serializeValue(value)}`);
  }
  lines.push('---');
  return lines.join('\n') + '\n';
}

function serializeValue(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) {
    return '[' + v.map(serializeValue).join(', ') + ']';
  }
  if (typeof v === 'object') {
    throw new Error(
      'lib/frontmatter/serializer: nested objects not supported in MVP. ' +
      'Add support when a caller needs it.'
    );
  }

  // String — quote if it contains YAML-significant chars or edge whitespace.
  const s = String(v);
  if (/[:#\n"']/.test(s) || s.trim() !== s || s === 'true' || s === 'false' || s === 'null' || /^\d+$/.test(s)) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}

module.exports = { serializeFrontmatter, serializeValue };
