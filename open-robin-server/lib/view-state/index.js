/**
 * View-state — per-user per-view UI preferences.
 *
 * Persists collapse/expand state and pane widths for each view to
 * ai/views/<view>/state/<username>.json. Reads fall back through a
 * precedence chain: per-user file -> view's layout.json -> hardcoded
 * defaults.
 *
 * Part of SPEC-26c-2. Foundation for any future per-view UI state
 * (slider positions, font sizes, etc.).
 */

const path = require('path');
const fs = require('fs').promises;
const { getDefaults } = require('./defaults');

function getStatePath(projectRoot, viewId, username) {
  return path.join(projectRoot, 'ai', 'views', viewId, 'state', `${username}.json`);
}

async function readViewState(projectRoot, viewId, username) {
  const filePath = getStatePath(projectRoot, viewId, username);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function writeViewState(projectRoot, viewId, username, state) {
  const filePath = getStatePath(projectRoot, viewId, username);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = filePath + '.tmp';
  await fs.writeFile(tmpPath, JSON.stringify(state, null, 2));
  await fs.rename(tmpPath, filePath);
}

/**
 * Merge a partial patch into the existing state file. Writes atomically.
 */
async function writeViewStatePatch(projectRoot, viewId, username, patch) {
  const current = (await readViewState(projectRoot, viewId, username)) || {};
  const merged = {
    collapsed: { ...(current.collapsed || {}), ...(patch.collapsed || {}) },
    widths:    { ...(current.widths    || {}), ...(patch.widths    || {}) },
    popup:     { ...(current.popup     || {}), ...(patch.popup     || {}) },
  };
  await writeViewState(projectRoot, viewId, username, merged);
  return merged;
}

function clampWidth(n) {
  return Math.max(120, Math.min(600, n));
}

/**
 * Resolve the effective view state via the precedence chain:
 *   1. per-user file
 *   2. view's layout.json defaults
 *   3. hardcoded defaults
 */
async function resolveViewState(projectRoot, viewId, username) {
  const userState = await readViewState(projectRoot, viewId, username);
  const defaults = getDefaults(projectRoot, viewId);

  return {
    collapsed: {
      leftSidebar: userState?.collapsed?.leftSidebar ?? defaults.collapsed.leftSidebar,
      leftChat:    userState?.collapsed?.leftChat    ?? defaults.collapsed.leftChat,
    },
    widths: {
      leftSidebar: clampWidth(userState?.widths?.leftSidebar ?? defaults.widths.leftSidebar),
      leftChat:    clampWidth(userState?.widths?.leftChat    ?? defaults.widths.leftChat),
    },
    popup: {
      open:   userState?.popup?.open   ?? false,
      x:      userState?.popup?.x      ?? -1,
      y:      userState?.popup?.y      ?? -1,
      width:  userState?.popup?.width  ?? 420,
      height: userState?.popup?.height ?? 520,
    },
  };
}

module.exports = {
  readViewState,
  writeViewState,
  writeViewStatePatch,
  resolveViewState,
};
