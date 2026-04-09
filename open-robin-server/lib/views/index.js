/**
 * @module views
 * @role View discovery and resolution
 *
 * Reads ai/views/ folder structure and content.json declarations.
 * Provides per-view-type path resolution and configuration.
 * Each display type has its own resolver module.
 *
 * Nothing in this module touches the database. Everything comes from
 * the filesystem (index.json, content.json, settings/layout.json;
 * code-viewer uses settings/styles/layout.json with legacy fallback).
 */

const path = require('path');
const fs = require('fs');

// Display-type resolvers — one module per type
const resolvers = require('./resolvers');

/**
 * Get the views root directory for a project.
 * @param {string} projectRoot
 * @returns {string}
 */
function getViewsRoot(projectRoot) {
  return path.join(projectRoot, 'ai', 'views');
}

/**
 * List all view IDs by scanning ai/views/ for folders with index.json.
 * @param {string} projectRoot
 * @returns {string[]}
 */
function listViews(projectRoot) {
  const viewsRoot = getViewsRoot(projectRoot);
  if (!fs.existsSync(viewsRoot)) return [];

  return fs.readdirSync(viewsRoot, { withFileTypes: true })
    .filter(d => d.isDirectory() && fs.existsSync(path.join(viewsRoot, d.name, 'index.json')))
    .map(d => d.name);
}

/**
 * Load a view's identity from its index.json.
 * @param {string} projectRoot
 * @param {string} viewId
 * @returns {object|null}
 */
function loadViewIndex(projectRoot, viewId) {
  const filePath = path.join(getViewsRoot(projectRoot), viewId, 'index.json');
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Load a view's content declaration from its content.json.
 * @param {string} projectRoot
 * @param {string} viewId
 * @returns {object|null}
 */
function loadContentConfig(projectRoot, viewId) {
  const filePath = path.join(getViewsRoot(projectRoot), viewId, 'content.json');
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Load a view's layout settings.
 * code-viewer: settings/styles/layout.json (co-located with layout.css), else settings/layout.json.
 * Other views: settings/layout.json only.
 * @param {string} projectRoot
 * @param {string} viewId
 * @returns {object|null}
 */
function loadLayoutConfig(projectRoot, viewId) {
  const viewsRoot = getViewsRoot(projectRoot);
  const paths =
    viewId === 'code-viewer'
      ? [
          path.join(viewsRoot, viewId, 'settings', 'styles', 'layout.json'),
          path.join(viewsRoot, viewId, 'settings', 'layout.json'),
        ]
      : [path.join(viewsRoot, viewId, 'settings', 'layout.json')];

  for (const filePath of paths) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Load everything about a view: identity + content config + layout.
 * @param {string} projectRoot
 * @param {string} viewId
 * @returns {object|null}
 */
function loadView(projectRoot, viewId) {
  const index = loadViewIndex(projectRoot, viewId);
  if (!index) return null;

  const content = loadContentConfig(projectRoot, viewId) || { display: 'placeholder', chat: null };
  const layout = loadLayoutConfig(projectRoot, viewId) || {};

  return {
    id: viewId,
    index,
    content,
    layout,
    viewRoot: path.join(getViewsRoot(projectRoot), viewId),
  };
}

/**
 * Load all views, sorted by rank.
 * @param {string} projectRoot
 * @returns {object[]}
 */
function loadAllViews(projectRoot) {
  const ids = listViews(projectRoot);
  return ids
    .map(id => loadView(projectRoot, id))
    .filter(v => v !== null)
    .sort((a, b) => (a.index.rank ?? 999) - (b.index.rank ?? 999));
}

/**
 * Resolve the content path for a view.
 * Delegates to the display-type-specific resolver.
 *
 * @param {string} projectRoot
 * @param {string} viewId
 * @param {object} [context] - Additional context (e.g., session root for code-viewer)
 * @returns {string|null} - Filesystem path to the view's content root
 */
function resolveContentPath(projectRoot, viewId, context = {}) {
  const view = loadView(projectRoot, viewId);
  if (!view) return null;

  const displayType = view.content.display;
  const resolver = resolvers[displayType];

  if (resolver && typeof resolver.resolveContentPath === 'function') {
    return resolver.resolveContentPath(projectRoot, viewId, view, context);
  }

  // Default: the view's own folder
  return view.viewRoot;
}

/**
 * Resolve chat config for a view. Returns null if the view has no chat.
 *
 * SPEC-24c: the `chatPath` return field is gone. Chat storage is unified
 * at ai/views/chat/ — callers no longer need a per-panel path. The
 * per-panel `<view>/chat/` folder still exists as the "chat enabled"
 * filesystem marker (no-code panel creation pattern), which this
 * function verifies before returning success.
 *
 * @param {string} projectRoot
 * @param {string} viewId
 * @returns {{ chatType: string, chatPosition: string }|null}
 */
function resolveChatConfig(projectRoot, viewId) {
  const view = loadView(projectRoot, viewId);
  if (!view || !view.content.chat) return null;

  // Per-panel chat/ folder is the capability marker. Storage happens
  // elsewhere (SPEC-24c), but the folder's existence still gates whether
  // this view has chat.
  const chatMarker = path.join(view.viewRoot, 'chat');
  if (!fs.existsSync(chatMarker)) return null;

  return {
    chatType: view.content.chat.type,
    chatPosition: view.layout.chatPosition || view.content.chat.position,
  };
}

module.exports = {
  getViewsRoot,
  listViews,
  loadViewIndex,
  loadContentConfig,
  loadLayoutConfig,
  loadView,
  loadAllViews,
  resolveContentPath,
  resolveChatConfig,
};
