/**
 * Robin system panel — WebSocket message handlers
 *
 * One job: handle robin:* WebSocket messages.
 * Returns a handler map keyed by message type.
 */

const robinQueries = require('./queries');
const { generateThemeCss, hexToRgb } = require('./theme-css');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

/**
 * @param {Object} deps
 * @param {Function} deps.getDb - Returns Knex instance
 * @param {Map} deps.sessions - WebSocket → session state map
 * @param {Function} deps.getDefaultProjectRoot - Returns project root path
 * @returns {Object<string, Function>} Message type → async handler
 */
module.exports = function createRobinHandlers({ getDb, sessions, getDefaultProjectRoot }) {

  /** Read the filesystem themes.css, or null if it doesn't exist. */
  async function readFilesystemCss() {
    const cssPath = path.join(getDefaultProjectRoot(), 'ai', 'views', 'settings', 'themes.css');
    try { return await fsPromises.readFile(cssPath, 'utf8'); } catch { return null; }
  }

  /** Write themes.css to the filesystem, creating directories if needed. */
  async function writeFilesystemCss(css) {
    const dir = path.join(getDefaultProjectRoot(), 'ai', 'views', 'settings');
    await fsPromises.mkdir(dir, { recursive: true });
    await fsPromises.writeFile(path.join(dir, 'themes.css'), css, 'utf8');
  }

  /** Build the full theme-data response with per-workspace state detection. */
  async function buildThemeData() {
    const db = getDb();
    const systemTheme = await robinQueries.getSystemTheme(db);
    const workspaces = await robinQueries.getWorkspaces(db);
    const filesystemCss = await readFilesystemCss();

    const workspaceList = [];
    for (const ws of workspaces) {
      const custom = await robinQueries.getWorkspaceTheme(db, ws.id);
      let themeState = 'inheriting';
      if (filesystemCss !== null) {
        if (custom?.theme_css && filesystemCss.trim() === custom.theme_css.trim()) {
          themeState = 'custom';
        } else if (filesystemCss.trim() !== systemTheme.theme_css.trim()) {
          if (custom?.theme_css) {
            themeState = 'diverged';
          }
          // No custom row + doesn't match system = still inheriting (file may not exist yet)
        }
      }
      workspaceList.push({
        id: ws.id,
        label: ws.label,
        icon: ws.icon,
        description: ws.description,
        repo_path: ws.repo_path,
        sort_order: ws.sort_order,
        themeState,
        primary_color: custom?.primary_color || systemTheme.primary_color,
        primary_rgb: custom?.primary_rgb || systemTheme.primary_rgb,
      });
    }

    return { systemTheme, workspaces: workspaceList };
  }

  return {
    'robin:tabs': async (ws) => {
      try {
        const tabs = await robinQueries.getTabs(getDb());
        ws.send(JSON.stringify({ type: 'robin:tabs', tabs }));
      } catch (err) {
        console.error('[Robin] tabs error:', err.message);
        ws.send(JSON.stringify({ type: 'robin:tabs', tabs: [], error: err.message }));
      }
    },

    'robin:tab-items': async (ws, msg) => {
      try {
        const items = await robinQueries.getTabItems(getDb(), msg.tab);
        ws.send(JSON.stringify({ type: 'robin:items', tab: msg.tab, items }));
      } catch (err) {
        console.error('[Robin] tab-items error:', err.message);
        ws.send(JSON.stringify({ type: 'robin:items', tab: msg.tab, items: [], error: err.message }));
      }
    },

    'robin:wiki-sections': async (ws, msg) => {
      try {
        const sections = await robinQueries.getWikiSections(getDb(), msg.tab);
        ws.send(JSON.stringify({ type: 'robin:wiki-sections', tab: msg.tab, sections }));
      } catch (err) {
        console.error('[Robin] wiki-sections error:', err.message);
        ws.send(JSON.stringify({ type: 'robin:wiki-sections', tab: msg.tab, sections: [], error: err.message }));
      }
    },

    'robin:wiki-page': async (ws, msg) => {
      try {
        const page = await robinQueries.getWikiPage(getDb(), msg.slug);
        ws.send(JSON.stringify({ type: 'robin:wiki', ...page }));
      } catch (err) {
        console.error('[Robin] wiki-page error:', err.message);
        ws.send(JSON.stringify({ type: 'robin:wiki', error: err.message }));
      }
    },

    'robin:context': async (ws, msg) => {
      // Update Robin's awareness of what the user is looking at.
      // No DB query — just tracks state for context injection into Robin's wire.
      const sess = sessions.get(ws);
      if (sess) {
        sess.robinContext = { tab: msg.tab, item: msg.item };
      }
    },

    // --- Theme / Customization handlers ---

    'robin:theme-load': async (ws) => {
      try {
        const data = await buildThemeData();
        ws.send(JSON.stringify({ type: 'robin:theme-data', ...data }));
      } catch (err) {
        console.error('[Robin] theme-load error:', err.message);
        ws.send(JSON.stringify({ type: 'robin:theme-data', error: err.message }));
      }
    },

    'robin:theme-update-system': async (ws, msg) => {
      try {
        const preset = msg.preset || 'dark';
        const primaryColor = msg.primary_color || '#4fc3f7';
        const primaryRgb = hexToRgb(primaryColor);
        const themeCss = generateThemeCss(preset, primaryColor, primaryRgb);

        await robinQueries.updateSystemTheme(getDb(), {
          preset, primary_color: primaryColor, primary_rgb: primaryRgb, theme_css: themeCss,
        });

        // Propagate to filesystem
        await writeFilesystemCss(themeCss);

        const data = await buildThemeData();
        ws.send(JSON.stringify({ type: 'robin:theme-data', ...data }));
      } catch (err) {
        console.error('[Robin] theme-update-system error:', err.message);
        ws.send(JSON.stringify({ type: 'robin:theme-data', error: err.message }));
      }
    },

    'robin:theme-update-workspace': async (ws, msg) => {
      try {
        const primaryColor = msg.primary_color || '#4fc3f7';
        const primaryRgb = hexToRgb(primaryColor);
        const systemTheme = await robinQueries.getSystemTheme(getDb());
        const themeCss = generateThemeCss(systemTheme.preset, primaryColor, primaryRgb);

        await robinQueries.upsertWorkspaceTheme(getDb(), msg.workspace_id, {
          primary_color: primaryColor, primary_rgb: primaryRgb, theme_css: themeCss,
        });

        // Propagate to filesystem
        await writeFilesystemCss(themeCss);

        const data = await buildThemeData();
        ws.send(JSON.stringify({ type: 'robin:theme-data', ...data }));
      } catch (err) {
        console.error('[Robin] theme-update-workspace error:', err.message);
        ws.send(JSON.stringify({ type: 'robin:theme-data', error: err.message }));
      }
    },

    'robin:theme-inherit': async (ws, msg) => {
      try {
        // Don't delete workspace_themes row — preserve custom for later
        const systemTheme = await robinQueries.getSystemTheme(getDb());

        // Overwrite filesystem with system theme
        await writeFilesystemCss(systemTheme.theme_css);

        const data = await buildThemeData();
        ws.send(JSON.stringify({ type: 'robin:theme-data', ...data }));
      } catch (err) {
        console.error('[Robin] theme-inherit error:', err.message);
        ws.send(JSON.stringify({ type: 'robin:theme-data', error: err.message }));
      }
    },

    'robin:theme-apply-diverged': async (ws, msg) => {
      try {
        const filesystemCss = await readFilesystemCss();
        if (!filesystemCss) {
          ws.send(JSON.stringify({ type: 'robin:theme-data', error: 'No CSS file found on disk' }));
          return;
        }

        // Try to extract primary color from CSS
        let primaryColor = '#4fc3f7';
        const match = filesystemCss.match(/--color-primary:\s*(#[0-9a-fA-F]{6})/);
        if (match) primaryColor = match[1];
        const primaryRgb = hexToRgb(primaryColor);

        await robinQueries.upsertWorkspaceTheme(getDb(), msg.workspace_id, {
          primary_color: primaryColor, primary_rgb: primaryRgb, theme_css: filesystemCss,
        });

        const data = await buildThemeData();
        ws.send(JSON.stringify({ type: 'robin:theme-data', ...data }));
      } catch (err) {
        console.error('[Robin] theme-apply-diverged error:', err.message);
        ws.send(JSON.stringify({ type: 'robin:theme-data', error: err.message }));
      }
    },
  };
};
