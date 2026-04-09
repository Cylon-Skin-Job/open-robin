/**
 * Frontmatter — public API.
 *
 * The single import point for all frontmatter parsing and serialization
 * across the server. Every caller must pass a `type` parameter to
 * parseFrontmatter() that exists in the catalog; otherwise the call
 * throws. This is the enforcement bite that keeps the activation
 * surface explicit.
 *
 * SPEC-25 introduces this module. See SPEC-25.md for rationale.
 */

const { parseFrontmatter: parseRaw } = require('./parser');
const { serializeFrontmatter } = require('./serializer');
const catalog = require('./catalog');

/**
 * Parse YAML frontmatter from a markdown string.
 *
 * @param {string} content - Full file content.
 * @param {string} type - Catalog type (e.g. 'trigger', 'chat'). MUST be
 *   registered in lib/frontmatter/catalog.js.
 * @returns {{ frontmatter: object, body: string }}
 * @throws {Error} if `type` is not in the catalog.
 */
function parseFrontmatter(content, type) {
  if (!type || !(type in catalog)) {
    const known = Object.keys(catalog).join(', ');
    throw new Error(
      `lib/frontmatter: unknown type "${type}". ` +
      `Known types: ${known}. ` +
      `Add an entry to lib/frontmatter/catalog.js to expand the activation surface.`
    );
  }
  return parseRaw(content);
}

module.exports = {
  parseFrontmatter,
  serializeFrontmatter,
  catalog,
};
