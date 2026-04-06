/**
 * Compatibility shim for gradual harness migration.
 *
 * This module provides drop-in replacements for all wire-related
 * functions in server.js. The implementation chosen depends on
 * the current feature flag state.
 *
 * Usage in server.js:
 *   const { spawnThreadWire, getModeStatus } = require('./lib/harness/compat');
 *
 * @see ../specs/PHASE-2-COMPATIBILITY-LAYER-SPEC.md
 */

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const {
  getHarnessMode,
  shouldUseNewHarness,
  isParallelMode
} = require('./feature-flags');
const { KimiHarness } = require('./kimi');
const { registry } = require('./registry');
const { getDb } = require('../db');

// Singleton harness instance (lazy-loaded)
/** @type {KimiHarness | null} */
let defaultHarness = null;
/** @type {Promise<void> | null} */
let harnessInitPromise = null;

/**
 * Get or create the singleton default harness instance.
 * @returns {KimiHarness}
 */
function getDefaultHarness() {
  if (!defaultHarness) {
    defaultHarness = new KimiHarness();
    harnessInitPromise = defaultHarness.initialize({});
    harnessInitPromise.catch(err => {
      console.error('[Compat] Failed to initialize default harness:', err);
    });
  }
  return defaultHarness;
}

/**
 * Wait for harness initialization (call before using harness).
 * @returns {Promise<void>}
 */
async function ensureHarnessReady() {
  if (harnessInitPromise) {
    await harnessInitPromise;
  }
}

/**
 * Fetch the harness ID for a thread from the database.
 * @param {string} threadId 
 * @returns {Promise<string>}
 */
async function getHarnessIdForThread(threadId) {
  try {
    const db = getDb();
    const row = await db('threads').where('thread_id', threadId).select('harness_id').first();
    return row ? row.harness_id : 'kimi';
  } catch (err) {
    // If DB not ready or thread not found, default to kimi
    return 'kimi';
  }
}

// ============================================================================
// LEGACY IMPLEMENTATIONS (copied from server.js for reference)
// ============================================================================

/**
 * Legacy: Spawn wire process directly.
 * This is the exact code from server.js spawnThreadWire
 * @param {string} threadId
 * @param {string} projectRoot
 * @returns {import('child_process').ChildProcess}
 */
function spawnThreadWireLegacy(threadId, projectRoot) {
  const kimiPath = process.env.KIMI_PATH || 'kimi';
  const args = ['--wire', '--yolo', '--session', threadId];

  if (projectRoot) {
    args.push('--work-dir', projectRoot);
  }

  const proc = spawn(kimiPath, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, TERM: 'xterm-256color' }
  });

  console.log(`[Wire:legacy] Spawning thread session: ${kimiPath} ${args.join(' ')}`);
  console.log(`[Wire:legacy] Spawned with pid: ${proc.pid}`);

  proc.on('error', (err) => {
    console.error('[Wire:legacy] Failed to spawn:', err.message);
  });

  proc.on('exit', (code) => {
    console.log(`[Wire:legacy] Process ${proc.pid} exited with code ${code}`);
  });

  proc.stderr.on('data', (data) => {
    console.error('[Wire:legacy stderr]:', data.toString().trim());
  });

  return proc;
}

// ============================================================================
// NEW IMPLEMENTATIONS (using KimiHarness)
// ============================================================================

/**
 * New: Spawn wire process via KimiHarness.
 * @param {string} threadId
 * @param {string} projectRoot
 * @returns {Promise<import('child_process').ChildProcess>}
 */
async function spawnThreadWireNew(threadId, projectRoot) {
  await ensureHarnessReady();
  const harness = getDefaultHarness();

  // Start the thread - this returns a session
  const session = await harness.startThread(threadId, projectRoot);

  // Return the underlying process for compatibility
  console.log(`[Wire:new] Spawned via KimiHarness, pid: ${session.process.pid}`);

  return session.process;
}

// ============================================================================
// PARALLEL MODE: Run both and compare
// ============================================================================

/**
 * @typedef {Object} ComparisonResult
 * @property {string} threadId
 * @property {import('./types').CanonicalEvent[]} legacyEvents
 * @property {import('./types').CanonicalEvent[]} newEvents
 * @property {Array<{index: number; legacy: import('./types').CanonicalEvent | undefined; new: import('./types').CanonicalEvent | undefined; reason: string}>} mismatches
 */

/** @type {Map<string, ComparisonResult>} */
const parallelResults = new Map();

/**
 * Compare two canonical events for equality.
 * @param {import('./types').CanonicalEvent} a
 * @param {import('./types').CanonicalEvent} b
 * @returns {boolean}
 */
function eventsEqual(a, b) {
  if (a.type !== b.type) return false;
  if (a.timestamp !== b.timestamp) return false;

  // Type-specific comparison
  switch (a.type) {
    case 'content':
    case 'thinking':
      return /** @type {import('./types').ContentEvent} */ (a).text ===
             /** @type {import('./types').ContentEvent} */ (b).text;
    case 'tool_call':
      return /** @type {import('./types').ToolCallEvent} */ (a).toolCallId ===
             /** @type {import('./types').ToolCallEvent} */ (b).toolCallId;
    case 'turn_end':
      return /** @type {import('./types').TurnEndEvent} */ (a).turnId ===
             /** @type {import('./types').TurnEndEvent} */ (b).turnId;
    default:
      return JSON.stringify(a) === JSON.stringify(b);
  }
}

/**
 * Run both legacy and new implementations, compare outputs.
 * Returns the legacy result (for safety) but logs all differences.
 * @param {string} threadId
 * @param {string} projectRoot
 * @returns {Promise<import('child_process').ChildProcess>}
 */
async function spawnThreadWireParallel(threadId, projectRoot) {
  console.log(`[Wire:parallel] Starting comparison for thread ${threadId}`);

  // Initialize comparison tracking
  parallelResults.set(threadId, {
    threadId,
    legacyEvents: [],
    newEvents: [],
    mismatches: []
  });

  // Start both processes
  const legacyProc = spawnThreadWireLegacy(threadId, projectRoot);

  // Also start harness (but we won't use its process directly for output)
  await ensureHarnessReady();
  const harness = getDefaultHarness();

  // Use a parallel thread ID to avoid conflicts
  const parallelThreadId = `${threadId}-parallel`;
  const harnessSession = await harness.startThread(parallelThreadId, projectRoot);

  // Set up event comparison
  harness.on('event', (data) => {
    if (data.threadId !== parallelThreadId) return;

    const result = parallelResults.get(threadId);
    if (result) {
      result.newEvents.push(data.event);
      // Compare with legacy if available
      const legacyEvent = result.legacyEvents[result.newEvents.length - 1];
      if (legacyEvent && !eventsEqual(legacyEvent, data.event)) {
        result.mismatches.push({
          index: result.newEvents.length - 1,
          legacy: legacyEvent,
          new: data.event,
          reason: 'Events differ'
        });
        console.log(`[Wire:parallel] Mismatch detected at event ${result.newEvents.length - 1}`);
      }
    }
  });

  // Return legacy process as the "official" one
  // The harness session runs in parallel for comparison
  console.log(`[Wire:parallel] Comparison session started: ${parallelThreadId}`);
  return legacyProc;
}

// ============================================================================
// PUBLIC API (exported functions)
// ============================================================================

/**
 * Spawn a wire process for a thread.
 *
 * This is the drop-in replacement for server.js:spawnThreadWire().
 * Behavior depends on HARNESS_MODE environment variable.
 *
 * @param {string} threadId
 * @param {string} projectRoot
 * @returns {import('child_process').ChildProcess}
 */
function spawnThreadWire(threadId, projectRoot) {
  const mode = getHarnessMode(threadId);

  switch (mode) {
    case 'new':
      console.log(`[Compat] Using NEW harness for thread ${threadId.slice(0, 8)}...`);
      
      // Create a deferred process proxy
      const dummyProc = spawn('echo', ['harness-loading'], { stdio: 'pipe' });
      
      const startHarness = async () => {
        const harnessId = await getHarnessIdForThread(threadId);
        const harness = registry.get(harnessId);
        
        if (!harness) {
          throw new Error(`Harness not found: ${harnessId}`);
        }

        await harness.initialize({});
        return await harness.startThread(threadId, projectRoot);
      };

      const sessionPromise = startHarness();

      // Store the promise so callers can wait if needed
      /** @ts-ignore */
      dummyProc._harnessPromise = sessionPromise;

      sessionPromise.then(session => {
        // Replace the dummy process properties with the real ones
        const realProc = session.process;
        dummyProc.pid = realProc.pid;
        dummyProc.stdin = realProc.stdin;
        
        // Use compatibleStdout if available (for Kimi Wire compatibility), 
        // otherwise fall back to raw stdout
        const stdout = session.compatibleStdout || realProc.stdout;
        dummyProc.stdout = stdout;
        dummyProc.stderr = realProc.stderr;
        dummyProc.kill = realProc.kill.bind(realProc);
        dummyProc.killed = realProc.killed;

        // Re-emit events from real process
        realProc.on('error', (err) => dummyProc.emit('error', err));
        realProc.on('exit', (code) => {
          dummyProc.killed = true;
          dummyProc.emit('exit', code);
        });
        realProc.on('close', (code) => dummyProc.emit('close', code));

        // dummyProc.stdout IS stdout, dummyProc.stderr IS realProc.stderr — no forwarding needed

        // Expose ACP sendMessage so server.js can route prompts correctly
        dummyProc._sendMessage = (message, options) => session.sendMessage(message, options);

        console.log(`[Compat] ${session.threadId} harness ready, pid: ${realProc.pid}`);
      }).catch(err => {
        console.error('[Compat] Failed to start harness session:', err);
        dummyProc.emit('error', err);
      });

      return dummyProc;

    case 'parallel':
      // For now, fall through to legacy since parallel needs more setup
      console.log(`[Compat] Using PARALLEL mode for thread ${threadId.slice(0, 8)}... (falling back to legacy)`);
      return spawnThreadWireParallel(threadId, projectRoot);

    case 'legacy':
    default:
      return spawnThreadWireLegacy(threadId, projectRoot);
  }
}

/**
 * Send a message to a thread's wire process.
 *
 * This is a new function needed for the harness-based approach.
 * Legacy code writes directly to process.stdin.
 *
 * @param {string} threadId
 * @param {string} message
 * @param {Object} [options]
 * @param {string} [options.system]
 * @param {Array<{role: string; content: string}>} [options.history]
 * @returns {Promise<void>}
 */
async function sendToThread(threadId, message, options = {}) {
  if (!shouldUseNewHarness(threadId)) {
    throw new Error('sendToThread() only works with new harness. Use process.stdin.write() for legacy.');
  }

  await ensureHarnessReady();
  const harness = getDefaultHarness();

  const session = harness.getSession(threadId);
  if (!session) {
    throw new Error(`No active session for thread ${threadId}`);
  }

  // Send via harness
  harness.sendToThread(threadId, 'prompt', {
    message,
    system: options.system,
    history: options.history
  });
}

/**
 * Get current mode status for debugging.
 * @param {string} [threadId]
 * @returns {{
 *   mode: import('./feature-flags').HarnessMode;
 *   harnessInitialized: boolean;
 *   activeSessions: string[];
 * }}
 */
function getModeStatus(threadId) {
  return {
    mode: getHarnessMode(threadId),
    harnessInitialized: defaultHarness !== null,
    activeSessions: defaultHarness ? Array.from(defaultHarness.sessions.keys()) : []
  };
}

/**
 * Emergency: Force reset to legacy mode.
 */
function emergencyRollback() {
  console.log('[Compat] EMERGENCY ROLLBACK triggered');
  process.env.HARNESS_MODE = 'legacy';

  // Kill any harness sessions
  if (defaultHarness) {
    defaultHarness.dispose().catch(console.error);
    defaultHarness = null;
    harnessInitPromise = null;
  }
}

/**
 * Check if new harness is enabled (for backward compatibility).
 * @returns {boolean}
 */
function isNewHarnessEnabled() {
  return shouldUseNewHarness();
}

/**
 * Get parallel comparison results for a thread.
 * @param {string} threadId
 * @returns {ComparisonResult | undefined}
 */
function getParallelResults(threadId) {
  return parallelResults.get(threadId);
}

/**
 * Clear parallel comparison results for a thread.
 * @param {string} threadId
 */
function clearParallelResults(threadId) {
  parallelResults.delete(threadId);
}

module.exports = {
  spawnThreadWire,
  sendToThread,
  getModeStatus,
  emergencyRollback,
  isNewHarnessEnabled,
  getParallelResults,
  clearParallelResults,
  // Internal exports for testing
  spawnThreadWireLegacy,
  spawnThreadWireNew,
  spawnThreadWireParallel
};
