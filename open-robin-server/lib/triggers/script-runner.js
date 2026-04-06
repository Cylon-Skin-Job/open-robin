/**
 * Script Runner — executes scripts referenced in trigger definitions.
 *
 * Scripts are pure functions that take event context and return data.
 * The return value is available as `result` in condition and message templates.
 */

const path = require('path');

const TIMEOUT_MS = 5000;

/**
 * Run a script function and return its result.
 *
 * @param {string} scriptPath - Path to script, relative to project root (e.g. "ai/scripts/check-sources.js")
 * @param {string|null} functionName - Exported function name, or null for default export
 * @param {Object} ctx - Event context passed to the function
 * @param {string} projectRoot - Absolute path to project root
 * @returns {Object|null} Script return value, or null on failure
 */
function runScript(scriptPath, functionName, ctx, projectRoot) {
  const absPath = path.resolve(projectRoot, scriptPath);

  let mod;
  try {
    // Clear require cache so scripts can be updated without restart
    delete require.cache[require.resolve(absPath)];
    mod = require(absPath);
  } catch (err) {
    console.error(`[ScriptRunner] Failed to load ${scriptPath}: ${err.message}`);
    return null;
  }

  const fn = functionName ? mod[functionName] : (typeof mod === 'function' ? mod : mod.default);
  if (typeof fn !== 'function') {
    console.error(`[ScriptRunner] No function "${functionName || 'default'}" in ${scriptPath}`);
    return null;
  }

  try {
    // Synchronous execution with context
    const result = fn({ ...ctx, projectRoot });
    return result || null;
  } catch (err) {
    console.error(`[ScriptRunner] Error in ${scriptPath}:${functionName || 'default'}: ${err.message}`);
    return null;
  }
}

module.exports = { runScript };
