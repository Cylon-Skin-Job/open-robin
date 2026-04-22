/**
 * View-state resolver — STATE_OVERRIDE_SPEC §6.
 *
 * Effective state = workspace default ← deep-merged per-view override.
 * Workspace file is seeded with hardcoded defaults on first run.
 * Invalid JSON in the override file logs a warning and falls back to
 * workspace-only; never crashes.
 */

const path = require('path');
const fs = require('fs').promises;

const HARDCODED_DEFAULTS = Object.freeze({
  widths: {
    leftSidebar:    220,
    leftChat:       320,
    rightSecondary: 400,
    rightCol:       220,
  },
  collapsed: {
    leftSidebar: false,
    leftChat:    false,
  },
  popup: {
    open:     false,
    x:        -1,
    y:        -1,
    width:    420,
    height:   520,
    threadId: null,
  },
  currentThreadId:   null,
  secondaryThreadId: null,
  // TINTS_SPEC §3: per-surface tint toggles. All default false (neutral).
  tints: {
    leftPanel:  false,
    rightPanel: false,
    cards:      false,
    borders: {
      threads: false,
      chat:    false,
    },
  },
});

function workspacePath(projectRoot) {
  return path.join(projectRoot, 'ai', 'views', 'settings', 'state.json');
}

function viewOverridePath(projectRoot, viewId) {
  return path.join(projectRoot, 'ai', 'views', viewId, 'settings', 'state.json');
}

function clampNum(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, patch) {
  if (!isPlainObject(patch)) return patch;
  const out = isPlainObject(base) ? { ...base } : {};
  for (const key of Object.keys(patch)) {
    const pv = patch[key];
    if (isPlainObject(pv) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key], pv);
    } else {
      out[key] = pv;
    }
  }
  return out;
}

async function atomicWriteJson(filePath, obj) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = filePath + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2));
  await fs.rename(tmp, filePath);
}

async function readJsonOrNull(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function readOverrideOrEmpty(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    console.warn(`[view-state] invalid override file ${filePath}: ${err.message} — using workspace only`);
    return {};
  }
}

async function loadOrSeedWorkspace(projectRoot) {
  const file = workspacePath(projectRoot);
  const existing = await readJsonOrNull(file);
  if (existing) return existing;
  const seeded = JSON.parse(JSON.stringify(HARDCODED_DEFAULTS));
  await atomicWriteJson(file, seeded);
  return seeded;
}

function normalize(state) {
  const out = deepMerge(HARDCODED_DEFAULTS, state);
  out.widths.leftSidebar    = clampNum(out.widths.leftSidebar,    120, 600);
  out.widths.leftChat       = clampNum(out.widths.leftChat,       120, 600);
  out.widths.rightSecondary = clampNum(out.widths.rightSecondary, 120, 600);
  out.widths.rightCol       = clampNum(out.widths.rightCol,       120, 600);
  out.popup.width  = clampNum(out.popup.width,  280, 1200);
  out.popup.height = clampNum(out.popup.height, 240, 1200);
  return out;
}

/**
 * Resolve the effective view state. Seeds the workspace file on first run.
 */
async function resolveViewState(projectRoot, viewId) {
  const workspace = await loadOrSeedWorkspace(projectRoot);
  const override  = await readOverrideOrEmpty(viewOverridePath(projectRoot, viewId));
  return normalize(deepMerge(workspace, override));
}

module.exports = {
  resolveViewState,
  HARDCODED_DEFAULTS,
  workspacePath,
  viewOverridePath,
  atomicWriteJson,
  readJsonOrNull,
  readOverrideOrEmpty,
  deepMerge,
  isPlainObject,
};
