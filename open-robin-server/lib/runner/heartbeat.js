/**
 * Heartbeat Monitor — detects stalled runs and nudges or kills them.
 *
 * Does not import wire-session directly. Uses callbacks for stall/kill actions
 * so the orchestrator (index.js) can wire up the actual responses.
 */

const fs = require('fs');

/**
 * @typedef {Object} HeartbeatOptions
 * @property {number}   [intervalMs=300000]   - Check interval (default 5 min)
 * @property {number}   [maxStalls=3]         - Max stalls before killing a run
 * @property {function} [onStall]             - Called on each stall: (runId, stallCount) => void
 * @property {function} [onMaxStalls]         - Called when maxStalls reached: (runId) => void
 */

/**
 * Create a heartbeat monitor for active runs.
 *
 * @param {Map} activeRuns - Map of runId -> { proc, runPath, agentId, lastActivity, stalls }
 * @param {HeartbeatOptions} [options]
 * @returns {{ start: Function, stop: Function, recordActivity: Function }}
 */
function createHeartbeatMonitor(activeRuns, options = {}) {
  const intervalMs = options.intervalMs || 5 * 60 * 1000;
  const maxStalls = options.maxStalls || 3;
  const onStall = options.onStall || (() => {});
  const onMaxStalls = options.onMaxStalls || (() => {});

  let timer = null;

  /**
   * Check whether the run folder has been modified since lastActivity.
   */
  function folderHasNewActivity(runPath, since) {
    try {
      const stat = fs.statSync(runPath);
      return stat.mtimeMs > since;
    } catch {
      return false;
    }
  }

  /**
   * Single tick — check every active run for staleness.
   */
  function tick() {
    const now = Date.now();

    for (const [runId, run] of activeRuns.entries()) {
      const folderChanged = folderHasNewActivity(run.runPath, run.lastActivity);

      if (folderChanged) {
        // Folder was touched — reset stall count
        run.lastActivity = now;
        run.stalls = 0;
        continue;
      }

      // No new activity detected
      run.stalls = (run.stalls || 0) + 1;
      console.log(`[Runner:Heartbeat] Run ${runId} stall #${run.stalls} (max ${maxStalls})`);

      if (run.stalls >= maxStalls) {
        console.log(`[Runner:Heartbeat] Run ${runId} reached max stalls — killing`);
        onMaxStalls(runId);
      } else {
        onStall(runId, run.stalls);
      }
    }
  }

  return {
    /**
     * Start the heartbeat interval.
     */
    start() {
      if (timer) return;
      console.log(`[Runner:Heartbeat] Started (interval: ${intervalMs}ms, maxStalls: ${maxStalls})`);
      timer = setInterval(tick, intervalMs);
    },

    /**
     * Stop the heartbeat interval.
     */
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
        console.log('[Runner:Heartbeat] Stopped');
      }
    },

    /**
     * Record that a run had activity (e.g. wire output received).
     * @param {string} runId
     */
    recordActivity(runId) {
      const run = activeRuns.get(runId);
      if (run) {
        run.lastActivity = Date.now();
        run.stalls = 0;
      }
    },
  };
}

module.exports = { createHeartbeatMonitor };
