/**
 * Hold Registry — manages auto-block timers for trigger-created tickets.
 *
 * When a trigger creates a ticket, it gets blocked_by: "auto-hold".
 * A timer is set for 9 minutes. If another ticket from the same trigger
 * arrives, the timer resets to +9 minutes. When the timer fires,
 * all held tickets have their block removed.
 */

const fs = require('fs');
const path = require('path');

const HOLD_DURATION_MS = 9 * 60 * 1000; // 9 minutes

/**
 * Create a hold registry.
 *
 * @param {string} issuesDir - Absolute path to issues panel
 * @returns {Object} Registry with hold(), release(), getHolds() methods
 */
function createHoldRegistry(issuesDir, options = {}) {
  // Map: holdKey (agentName:triggerName) → { ticketIds: [], timerId }
  const holds = new Map();

  return {
    /**
     * Place a ticket on hold. If a hold already exists for this
     * agent+trigger combination, add the ticket to the pile and
     * reset the timer.
     *
     * @param {string} agentName - Bot name (e.g., "kimi-wiki")
     * @param {string} triggerName - Trigger name from TRIGGERS.md
     * @param {string} ticketId - Ticket ID (e.g., "KIMI-0007")
     */
    hold(agentName, triggerName, ticketId) {
      const key = `${agentName}:${triggerName}`;

      if (holds.has(key)) {
        const entry = holds.get(key);
        entry.ticketIds.push(ticketId);
        // Reset timer
        clearTimeout(entry.timerId);
        entry.timerId = setTimeout(() => releaseHold(key), HOLD_DURATION_MS);
        console.log(`[HoldRegistry] ${ticketId} added to hold ${key} (${entry.ticketIds.length} tickets, timer reset)`);
      } else {
        const timerId = setTimeout(() => releaseHold(key), HOLD_DURATION_MS);
        holds.set(key, { ticketIds: [ticketId], timerId });
        console.log(`[HoldRegistry] ${ticketId} held (${key}, 9min timer started)`);
      }
    },

    /**
     * Get all current holds for inspection.
     */
    getHolds() {
      const result = {};
      for (const [key, entry] of holds) {
        result[key] = { ticketIds: [...entry.ticketIds] };
      }
      return result;
    },

    /**
     * Stop all timers (for shutdown).
     */
    stop() {
      for (const entry of holds.values()) {
        clearTimeout(entry.timerId);
      }
      holds.clear();
    },
  };

  /**
   * Release a hold — remove blocked_by: "auto-hold" from all tickets in the pile.
   */
  function releaseHold(key) {
    const entry = holds.get(key);
    if (!entry) return;

    console.log(`[HoldRegistry] Releasing hold ${key} (${entry.ticketIds.length} tickets)`);

    for (const ticketId of entry.ticketIds) {
      const filename = `${ticketId}.md`;
      const filePath = path.join(issuesDir, filename);

      try {
        if (!fs.existsSync(filePath)) continue;
        let content = fs.readFileSync(filePath, 'utf8');

        // Remove the blocked_by: auto-hold line
        content = content.replace(/^blocked_by: auto-hold\n/m, '');
        fs.writeFileSync(filePath, content, 'utf8');

        console.log(`[HoldRegistry] Unblocked ${ticketId}`);
      } catch (err) {
        console.error(`[HoldRegistry] Failed to unblock ${ticketId}: ${err.message}`);
      }
    }

    holds.delete(key);

    // Notify via callback (e.g., wake persona wire session)
    if (typeof options.onRelease === 'function') {
      const agentName = key.split(':')[0];
      options.onRelease(agentName, entry.ticketIds);
    }
  }
}

module.exports = { createHoldRegistry };
