/**
 * Robin queries — data access for the system panel
 *
 * One job: read/write robin.db for system panel data.
 * All functions take a Knex instance as first arg.
 */

/**
 * Get all system tabs, ordered.
 * @param {import('knex').Knex} db
 * @returns {Promise<Array>}
 */
async function getTabs(db) {
  return db('system_tabs').orderBy('sort_order');
}

/**
 * Get items for a tab. CLIs come from cli_registry; everything else from system_config.
 * @param {import('knex').Knex} db
 * @param {string} tabId
 * @returns {Promise<Array>}
 */
async function getTabItems(db, tabId) {
  if (tabId === 'clis') {
    return db('cli_registry').orderBy('sort_order');
  }
  return db('system_config').where('tab', tabId).orderBy('sort_order');
}

/**
 * Get wiki sections (FAQ links) for a tab — slug + title only.
 * @param {import('knex').Knex} db
 * @param {string} tabId
 * @returns {Promise<Array<{slug: string, title: string, sort_order: number}>>}
 */
async function getWikiSections(db, tabId) {
  return db('system_wiki')
    .select('slug', 'title', 'sort_order', 'description')
    .where('tab', tabId)
    .orderBy('sort_order');
}

/**
 * Get a full wiki page by slug.
 * @param {import('knex').Knex} db
 * @param {string} slug
 * @returns {Promise<Object|undefined>}
 */
async function getWikiPage(db, slug) {
  return db('system_wiki').where('slug', slug).first();
}

/**
 * Search wiki content by keyword.
 * @param {import('knex').Knex} db
 * @param {string} query
 * @returns {Promise<Array>}
 */
async function searchWiki(db, query) {
  const pattern = `%${query}%`;
  return db('system_wiki')
    .select('slug', 'title', 'description', 'tab')
    .where('content', 'like', pattern)
    .orWhere('title', 'like', pattern)
    .orderBy('sort_order');
}

/**
 * Get a single CLI registry entry.
 * @param {import('knex').Knex} db
 * @param {string} id
 * @returns {Promise<Object|undefined>}
 */
async function getCli(db, id) {
  return db('cli_registry').where('id', id).first();
}

/**
 * Get all CLIs from the registry.
 * @param {import('knex').Knex} db
 * @returns {Promise<Array>}
 */
async function getCliRegistry(db) {
  return db('cli_registry').orderBy('sort_order');
}

/**
 * Mark a CLI as installed.
 * @param {import('knex').Knex} db
 * @param {string} id
 * @param {boolean} installed
 */
async function setCliInstalled(db, id, installed) {
  return db('cli_registry').where('id', id).update({ installed: installed ? 1 : 0 });
}

/**
 * Set the active CLI (deactivates all others first).
 * @param {import('knex').Knex} db
 * @param {string} id
 */
async function setCliActive(db, id) {
  await db('cli_registry').update({ active: 0 });
  await db('cli_registry').where('id', id).update({ active: 1 });
}

// --- Theme queries ---

/**
 * Get the system theme (single row).
 * @param {import('knex').Knex} db
 * @returns {Promise<Object>}
 */
async function getSystemTheme(db) {
  return db('system_theme').where('id', 'default').first();
}

/**
 * Update the system theme.
 * @param {import('knex').Knex} db
 * @param {Object} theme - { preset, primary_color, primary_rgb, theme_css }
 */
async function updateSystemTheme(db, { preset, primary_color, primary_rgb, theme_css }) {
  return db('system_theme').where('id', 'default').update({
    preset, primary_color, primary_rgb, theme_css,
    updated_at: new Date().toISOString(),
  });
}

/**
 * Get all workspaces, ordered.
 * @param {import('knex').Knex} db
 * @returns {Promise<Array>}
 */
async function getWorkspaces(db) {
  return db('workspaces').orderBy('sort_order');
}

/**
 * Get a workspace's custom theme (may return undefined if inheriting).
 * @param {import('knex').Knex} db
 * @param {string} workspaceId
 * @returns {Promise<Object|undefined>}
 */
async function getWorkspaceTheme(db, workspaceId) {
  return db('workspace_themes').where('workspace_id', workspaceId).first();
}

/**
 * Create or update a workspace's custom theme.
 * @param {import('knex').Knex} db
 * @param {string} workspaceId
 * @param {Object} theme - { primary_color, primary_rgb, theme_css }
 */
async function upsertWorkspaceTheme(db, workspaceId, { primary_color, primary_rgb, theme_css }) {
  const exists = await db('workspace_themes').where('workspace_id', workspaceId).first();
  if (exists) {
    return db('workspace_themes').where('workspace_id', workspaceId).update({
      primary_color, primary_rgb, theme_css,
      updated_at: new Date().toISOString(),
    });
  }
  return db('workspace_themes').insert({
    workspace_id: workspaceId,
    primary_color, primary_rgb, theme_css,
  });
}

module.exports = {
  getTabs,
  getTabItems,
  getWikiSections,
  getWikiPage,
  searchWiki,
  getCli,
  getCliRegistry,
  setCliInstalled,
  setCliActive,
  getSystemTheme,
  updateSystemTheme,
  getWorkspaces,
  getWorkspaceTheme,
  upsertWorkspaceTheme,
};
