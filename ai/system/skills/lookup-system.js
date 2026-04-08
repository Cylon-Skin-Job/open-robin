/**
 * lookup-system — Robin's skill for querying the system knowledge base
 *
 * Progressive disclosure:
 *   { tab: 'clis' }          → names + descriptions for that tab
 *   { slug: 'clis-what-is' } → full wiki page content
 *   { search: 'write lock' } → matching pages with snippets
 *
 * Uses better-sqlite3 directly (not Knex) since skills are standalone scripts.
 * Opens the database read-only.
 *
 * @manifest
 * {
 *   "name": "lookup-system",
 *   "description": "Query Open Robin's system knowledge base",
 *   "script": "ai/system/skills/lookup-system.js",
 *   "args": {
 *     "slug": "Specific page slug to read in full",
 *     "tab": "List all items for a tab (returns name + description)",
 *     "search": "Search across all wiki content by keyword"
 *   },
 *   "inject": ["dbPath"],
 *   "access": "read"
 * }
 */

// Resolve better-sqlite3 from the server's node_modules.
// When called via script-runner (inside server process), require() works directly.
// When called standalone, we use createRequire to find it from the server location.
let Database;
try {
  Database = require('better-sqlite3');
} catch {
  const { createRequire } = require('module');
  const serverRequire = createRequire(require('path').resolve(__dirname, '..', '..', '..', 'kimi-ide-server', 'package.json'));
  Database = serverRequire('better-sqlite3');
}

module.exports = function lookupSystem({ slug, tab, search, dbPath }) {
  if (!dbPath) {
    return { error: 'No dbPath provided — skill requires inject: ["dbPath"]' };
  }

  const db = new Database(dbPath, { readonly: true });
  db.pragma('foreign_keys = ON');

  try {
    // Full page by slug
    if (slug) {
      const page = db.prepare(
        'SELECT slug, title, content, context, description, tab, surface_when FROM system_wiki WHERE slug = ?'
      ).get(slug);

      if (!page) return { error: `No wiki page found for slug: ${slug}` };

      return {
        slug: page.slug,
        title: page.title,
        description: page.description,
        content: page.content,
        context: page.context,
        tab: page.tab,
        surface_when: page.surface_when,
      };
    }

    // List items for a tab (directory level)
    if (tab) {
      // Wiki sections for the tab
      const sections = db.prepare(
        'SELECT slug, title, description, surface_when FROM system_wiki WHERE tab = ? ORDER BY sort_order'
      ).all(tab);

      // Tab-specific items
      let items;
      if (tab === 'clis') {
        items = db.prepare(
          'SELECT id, name, author, description, surface_when, pricing_url, docs_url FROM cli_registry ORDER BY sort_order'
        ).all();
      } else {
        items = db.prepare(
          'SELECT key, value, description, section, surface_when FROM system_config WHERE tab = ? ORDER BY sort_order'
        ).all(tab);
      }

      // Tab metadata
      const tabInfo = db.prepare(
        'SELECT id, label, description FROM system_tabs WHERE id = ?'
      ).get(tab);

      return {
        tab: tabInfo || { id: tab },
        sections,
        items,
      };
    }

    // Search across all wiki content
    if (search) {
      const pattern = `%${search}%`;
      const results = db.prepare(
        'SELECT slug, title, description, tab FROM system_wiki WHERE content LIKE ? OR title LIKE ? ORDER BY sort_order'
      ).all(pattern, pattern);

      return { query: search, results };
    }

    return { error: 'Provide one of: slug, tab, or search' };
  } finally {
    db.close();
  }
};
