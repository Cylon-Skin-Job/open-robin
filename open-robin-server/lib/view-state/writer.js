/**
 * View-state writer — STATE_OVERRIDE_SPEC §7.
 *
 * For each leaf key in the patch:
 *   - If the per-view override file exists AND already has that key path,
 *     update the override file (override stays pinned).
 *   - Otherwise, update the workspace file.
 *
 * Invariant: the writer NEVER creates a per-view override file. Users do.
 * Writes are atomic (tmp + rename).
 */

const {
  resolveViewState,
  workspacePath,
  viewOverridePath,
  atomicWriteJson,
  readJsonOrNull,
  deepMerge,
  isPlainObject,
} = require('./resolver');

function hasKeyPath(obj, pathArr) {
  let cur = obj;
  for (const seg of pathArr) {
    if (!isPlainObject(cur)) return false;
    if (!Object.prototype.hasOwnProperty.call(cur, seg)) return false;
    cur = cur[seg];
  }
  return true;
}

function setKeyPath(obj, pathArr, value) {
  let cur = obj;
  for (let i = 0; i < pathArr.length - 1; i++) {
    const seg = pathArr[i];
    if (!isPlainObject(cur[seg])) cur[seg] = {};
    cur = cur[seg];
  }
  cur[pathArr[pathArr.length - 1]] = value;
}

/**
 * Walk `patch` depth-first, yielding [pathArr, leafValue] for every leaf.
 * A leaf is anything that is NOT a plain object — scalars, arrays, null.
 */
function* leafEntries(patch, prefix = []) {
  if (!isPlainObject(patch)) return;
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    const nextPath = [...prefix, key];
    if (isPlainObject(value)) {
      yield* leafEntries(value, nextPath);
    } else {
      yield [nextPath, value];
    }
  }
}

async function writeViewStatePatch(projectRoot, viewId, patch) {
  const wsFile       = workspacePath(projectRoot);
  const overrideFile = viewOverridePath(projectRoot, viewId);

  // Snapshot current files.
  const workspace      = (await readJsonOrNull(wsFile))       || {};
  const overrideBefore = await readJsonOrNull(overrideFile);
  const overrideExists = overrideBefore !== null;

  // Accumulate routed patches.
  const workspaceUpdates = {};
  const overrideUpdates  = {};
  let overrideTouched = false;

  for (const [keyPath, value] of leafEntries(patch)) {
    if (overrideExists && hasKeyPath(overrideBefore, keyPath)) {
      setKeyPath(overrideUpdates, keyPath, value);
      overrideTouched = true;
    } else {
      setKeyPath(workspaceUpdates, keyPath, value);
    }
  }

  // Apply workspace updates.
  if (Object.keys(workspaceUpdates).length > 0) {
    const nextWorkspace = deepMerge(workspace, workspaceUpdates);
    await atomicWriteJson(wsFile, nextWorkspace);
  }

  // Apply override updates ONLY if the override file already existed.
  // The writer never creates it.
  if (overrideTouched && overrideExists) {
    const nextOverride = deepMerge(overrideBefore, overrideUpdates);
    await atomicWriteJson(overrideFile, nextOverride);
  }

  return resolveViewState(projectRoot, viewId);
}

module.exports = {
  writeViewStatePatch,
  // exported for tests
  hasKeyPath,
  setKeyPath,
  leafEntries,
};
