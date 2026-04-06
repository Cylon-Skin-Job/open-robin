/**
 * Cron Scheduler — handles type: cron triggers from TRIGGERS.md.
 *
 * Supports schedules like "daily 09:00" and standard cron expressions.
 * Creates tickets when the schedule fires and conditions are met.
 */

const path = require('path');

/**
 * Parse a schedule string into interval milliseconds and a check function.
 *
 * Supported formats:
 *   "daily HH:MM"  — fires once per day at the given time
 *   "0 9 * * *"    — standard cron (checked every minute)
 *
 * @param {string} schedule
 * @returns {{ intervalMs: number, shouldFire: Function }}
 */
function parseSchedule(schedule) {
  // "daily HH:MM" format
  const dailyMatch = schedule.match(/^daily\s+(\d{1,2}):(\d{2})$/);
  if (dailyMatch) {
    const hour = parseInt(dailyMatch[1], 10);
    const minute = parseInt(dailyMatch[2], 10);
    return {
      intervalMs: 60000, // check every minute
      shouldFire() {
        const now = new Date();
        return now.getHours() === hour && now.getMinutes() === minute;
      },
    };
  }

  // Standard cron — parse the 5 fields
  const parts = schedule.trim().split(/\s+/);
  if (parts.length === 5) {
    return {
      intervalMs: 60000,
      shouldFire() {
        const now = new Date();
        return matchCronField(parts[0], now.getMinutes())
          && matchCronField(parts[1], now.getHours())
          && matchCronField(parts[2], now.getDate())
          && matchCronField(parts[3], now.getMonth() + 1)
          && matchCronField(parts[4], now.getDay());
      },
    };
  }

  console.warn(`[CronScheduler] Unknown schedule format: ${schedule}`);
  return { intervalMs: 0, shouldFire: () => false };
}

/**
 * Match a single cron field against a value.
 * Supports: * (any), N (exact), N/step, ranges not yet supported.
 */
function matchCronField(field, value) {
  if (field === '*') return true;

  // Exact match
  if (/^\d+$/.test(field)) return parseInt(field, 10) === value;

  // Step: */N
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10);
    return value % step === 0;
  }

  return false;
}

/**
 * Parse a duration string into milliseconds.
 * Supports: "30m", "1h", "5s"
 */
function parseDuration(str) {
  if (!str) return 0;
  const match = str.match(/^(\d+)(s|m|h)$/);
  if (!match) return 0;
  const val = parseInt(match[1], 10);
  switch (match[2]) {
    case 's': return val * 1000;
    case 'm': return val * 60000;
    case 'h': return val * 3600000;
    default: return 0;
  }
}

/**
 * Create a cron scheduler that manages multiple cron triggers.
 *
 * @param {Function} createTicketFn - ({ title, assignee, body, prompt }) => void
 * @param {Object} [options]
 * @param {Function} [options.evaluateCondition] - (condition, vars) => boolean
 * @returns {Object} Scheduler with register(), start(), stop() methods
 */
function createCronScheduler(createTicketFn, options = {}) {
  const jobs = [];
  const timers = [];

  return {
    /**
     * Register a cron trigger.
     *
     * @param {Object} trigger - Parsed trigger definition
     * @param {string} assignee - Bot name for ticket assignment
     */
    register(trigger, assignee) {
      const { schedule, condition, retry, prompt, message, name } = trigger;
      if (!schedule) return;

      const parsed = parseSchedule(schedule);
      if (parsed.intervalMs === 0) return;

      const retryMs = parseDuration(retry);

      jobs.push({
        name: name || 'unnamed-cron',
        trigger,
        assignee,
        parsed,
        retryMs,
        lastFired: null,
        retryTimer: null,
      });

      console.log(`[CronScheduler] Registered: ${name} (${schedule}) → ${assignee}`);
    },

    /**
     * Start checking all registered cron jobs.
     */
    start() {
      for (const job of jobs) {
        const timer = setInterval(() => {
          if (!job.parsed.shouldFire()) return;

          // Prevent double-fire in the same minute
          const now = new Date();
          const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
          if (job.lastFired === minuteKey) return;

          // Evaluate condition if present
          if (job.trigger.condition) {
            const conditionMet = options.evaluateCondition
              ? options.evaluateCondition(job.trigger.condition, {})
              : true;

            if (!conditionMet) {
              console.log(`[CronScheduler] ${job.name}: condition not met`);
              if (job.retryMs > 0 && !job.retryTimer) {
                job.retryTimer = setTimeout(() => {
                  job.retryTimer = null;
                  // Re-evaluate on retry — create ticket if condition now met
                  const retryMet = options.evaluateCondition
                    ? options.evaluateCondition(job.trigger.condition, {})
                    : true;
                  if (retryMet) {
                    fireJob(job);
                  } else {
                    console.log(`[CronScheduler] ${job.name}: retry condition still not met`);
                  }
                }, job.retryMs);
              }
              return;
            }
          }

          fireJob(job);
          job.lastFired = minuteKey;
        }, job.parsed.intervalMs);

        timers.push(timer);
      }

      console.log(`[CronScheduler] Started ${jobs.length} cron jobs`);
    },

    /**
     * Stop all cron jobs.
     */
    stop() {
      for (const t of timers) clearInterval(t);
      for (const job of jobs) {
        if (job.retryTimer) clearTimeout(job.retryTimer);
      }
      timers.length = 0;
      jobs.length = 0;
    },

    /** Expose jobs for testing/inspection */
    getJobs() { return jobs; },
  };

  function normalizeMessage(msg) {
    if (!msg) return null;
    if (typeof msg === 'string') return msg;
    if (typeof msg === 'object') {
      return Object.entries(msg).map(([k, v]) => `${k}: ${v}`).join('\n');
    }
    return String(msg);
  }

  function fireJob(job) {
    const message = normalizeMessage(job.trigger.message);
    const title = message
      ? message.split('\n')[0].trim()
      : `Scheduled: ${job.name}`;

    createTicketFn({
      title,
      assignee: job.assignee,
      body: message || `Cron trigger: ${job.name}`,
      prompt: job.trigger.prompt || null,
    });

    console.log(`[CronScheduler] Fired: ${job.name} → ${job.assignee}`);
  }
}

module.exports = { createCronScheduler, parseSchedule, parseDuration };
