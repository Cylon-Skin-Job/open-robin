#!/usr/bin/env node
/**
 * One-shot migration — STATE_OVERRIDE_SPEC §10.
 *
 * Moves legacy per-view state files to the new workspace-default +
 * per-view override layout.
 *
 *   Before:  ai/views/<view>/state/<username>.json        (per-user, per-view)
 *   After:   ai/views/settings/state.json                 (workspace default)
 *            ai/views/<view>/settings/state.json          (override, only if diverges)
 *
 * Algorithm:
 *   1. Load every legacy file.
 *   2. Pick `code-viewer` as the seed; merge into full §5 shape.
 *   3. Write workspace file.
 *   4. For every other view, diff against seed → write override only if non-empty.
 *   5. Delete legacy <view>/state/ directories.
 *
 * Usage:  node open-robin-server/scripts/migrate-view-state.js [--force]
 *         Run from the root of an open-robin workspace (CWD is projectRoot).
 */

const fs = require('fs');
const path = require('path');

const HARDCODED_DEFAULTS = {
  widths: {
    leftSidebar:    220,
    leftChat:       320,
    rightSecondary: 400,
    rightCol:       220,
  },
  collapsed: { leftSidebar: false, leftChat: false },
  popup: {
    open: false, x: -1, y: -1, width: 420, height: 520, threadId: null,
  },
  currentThreadId:   null,
  secondaryThreadId: null,
};

const SEED_VIEW = 'code-viewer';

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, patch) {
  if (!isPlainObject(patch)) return patch;
  const out = isPlainObject(base) ? { ...base } : {};
  for (const key of Object.keys(patch)) {
    const pv = patch[key];
    out[key] = isPlainObject(pv) && isPlainObject(out[key]) ? deepMerge(out[key], pv) : pv;
  }
  return out;
}

/**
 * Deep-diff: return an object containing only keys of `value` whose leaves
 * differ from `ref`. Empty objects are pruned.
 */
function deepDiff(ref, value) {
  if (!isPlainObject(value)) {
    return value === ref ? undefined : value;
  }
  const out = {};
  for (const key of Object.keys(value)) {
    const sub = deepDiff(ref?.[key], value[key]);
    if (sub !== undefined) {
      // For empty object (diff of two matching objects) we get {}, which we
      // should treat as "no diff" and prune.
      if (isPlainObject(sub) && Object.keys(sub).length === 0) continue;
      out[key] = sub;
    }
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function atomicWriteJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, filePath);
}

function main() {
  const force = process.argv.includes('--force');
  const projectRoot = process.cwd();
  const viewsDir = path.join(projectRoot, 'ai', 'views');
  const workspaceFile = path.join(viewsDir, 'settings', 'state.json');

  if (!fs.existsSync(viewsDir)) {
    console.error(`[migrate] not an open-robin workspace (no ${viewsDir})`);
    process.exit(1);
  }

  if (fs.existsSync(workspaceFile) && !force) {
    console.error(`[migrate] ${workspaceFile} already exists. Re-run with --force to overwrite.`);
    process.exit(1);
  }

  // Enumerate legacy files.
  const viewDirs = fs.readdirSync(viewsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const legacy = {};
  for (const view of viewDirs) {
    const stateDir = path.join(viewsDir, view, 'state');
    if (!fs.existsSync(stateDir)) continue;
    const files = fs.readdirSync(stateDir).filter((f) => f.endsWith('.json'));
    if (files.length === 0) continue;
    const picked = files[0];  // one user per machine
    const data = readJsonSafe(path.join(stateDir, picked));
    if (data) {
      legacy[view] = { file: path.join(stateDir, picked), dir: stateDir, data };
      console.log(`[migrate] read legacy state: ${legacy[view].file}`);
    }
  }

  if (Object.keys(legacy).length === 0) {
    console.log('[migrate] no legacy state files found — seeding workspace from hardcoded defaults.');
    atomicWriteJson(workspaceFile, HARDCODED_DEFAULTS);
    console.log(`[migrate] wrote ${workspaceFile}`);
    return;
  }

  // Seed: prefer code-viewer; else pick the first available with widths set.
  let seedView = SEED_VIEW;
  if (!legacy[seedView]) {
    seedView = Object.keys(legacy)[0];
    console.warn(`[migrate] ${SEED_VIEW} not present; falling back to seed view: ${seedView}`);
  }

  const seed = deepMerge(HARDCODED_DEFAULTS, legacy[seedView].data);
  atomicWriteJson(workspaceFile, seed);
  console.log(`[migrate] wrote workspace default: ${workspaceFile} (seed=${seedView})`);

  // Per-view overrides.
  for (const [view, { data }] of Object.entries(legacy)) {
    if (view === seedView) continue;
    const diff = deepDiff(seed, data);
    if (!diff) {
      console.log(`[migrate] ${view}: no divergence from seed → no override file`);
      continue;
    }
    const overridePath = path.join(viewsDir, view, 'settings', 'state.json');
    atomicWriteJson(overridePath, diff);
    console.log(`[migrate] wrote override: ${overridePath}`);
    console.log(`          diff: ${JSON.stringify(diff)}`);
  }

  // Delete legacy state dirs.
  for (const { dir } of Object.values(legacy)) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`[migrate] deleted legacy dir: ${dir}`);
  }

  console.log('[migrate] done.');
}

main();
