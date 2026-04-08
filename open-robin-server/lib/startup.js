/**
 * Server startup orchestrator.
 *
 * Extracted from server.js — handles the full bootstrap sequence:
 *   1. initDb
 *   2. createRobinHandlers + createClipboardHandlers
 *   3. startAuditSubscriber
 *   4. server.listen()
 *   5. wiki hooks
 *   6. project file watcher + loadComponents + createActionHandlers
 *   7. agent triggers + cron scheduler
 *   8. runner heartbeat monitor
 *   9. SIGTERM/SIGINT handlers for clean shutdown
 *
 * Ordering is load-bearing. Do not reorder steps. See the gotchas in
 * SPEC-01b for the specific hard dependencies.
 *
 * Returns { robinHandlers, clipboardHandlers } so server.js can wire
 * them into the client message router (which reads from module-level
 * mutable references).
 */

const path = require('path');
const fs = require('fs');

const { initDb, getDb, closeDb } = require('./db');
const createRobinHandlers = require('./robin/ws-handlers');
const createClipboardHandlers = require('./clipboard/ws-handlers');
const { startAuditSubscriber } = require('./audit/audit-subscriber');
const wikiHooks = require('./wiki/hooks');
const { loadComponents, getModalDefinition } = require('./components/component-loader');

const PORT = process.env.PORT || 3001;

/**
 * Bootstrap and start the server. Must be called after the http.Server
 * has been created but before any client connections can arrive.
 *
 * @param {object} deps
 * @param {import('http').Server} deps.server
 * @param {Map} deps.sessions
 * @param {() => string} deps.getDefaultProjectRoot
 * @param {string} deps.AI_PANELS_PATH
 * @returns {Promise<{ robinHandlers: object, clipboardHandlers: object }>}
 */
async function start({ server, sessions, getDefaultProjectRoot, AI_PANELS_PATH }) {
  // 1. DB init — must finish before handlers are created (they call getDb)
  await initDb(getDefaultProjectRoot());
  console.log('[DB] robin.db initialized');

  // 2. Handlers — depend on DB being ready
  const robinHandlers = createRobinHandlers({ getDb, sessions, getDefaultProjectRoot });
  const clipboardHandlers = createClipboardHandlers({ getDb });

  // 3. Audit subscriber — listens to event bus, persists exchange metadata
  startAuditSubscriber();

  // 4. listen() — must come before watcher/hooks start, they broadcast to clients
  await new Promise((resolve, reject) => {
    server.listen(PORT, () => {
      console.log(`[Server] Running on http://localhost:${PORT}`);
      console.log(`[Server] Default CLI: ${process.env.KIMI_PATH || 'kimi'}`);
      console.log(`[Server] Thread storage: ${AI_PANELS_PATH}`);

      try {
        _startPipeline({ sessions, getDefaultProjectRoot, AI_PANELS_PATH });
      } catch (err) {
        // Don't crash the server if pipeline init fails — log and continue
        console.error('[Server] Pipeline init error:', err);
      }

      resolve();
    });
    server.on('error', reject);
  });

  // 5. Signal handlers — register after successful startup
  process.on('SIGTERM', _handleShutdown);
  process.on('SIGINT', _handleShutdown);

  return { robinHandlers, clipboardHandlers };
}

/**
 * The post-listen pipeline: watcher, hold registry, action handlers,
 * filters, triggers, cron scheduler, heartbeat monitor.
 *
 * Split out of `start()` only for readability — the split has no
 * semantic effect. Everything here runs synchronously from inside the
 * `server.listen()` callback.
 *
 * @private
 */
function _startPipeline({ sessions, getDefaultProjectRoot, AI_PANELS_PATH }) {
  // Start wiki hooks — watches ai/views/wiki-viewer/content/ tree (collections with topics)
  const wikiPath = path.join(getDefaultProjectRoot(), 'ai', 'views', 'wiki-viewer', 'content');
  wikiHooks.start(wikiPath);

  // Start project-wide file watcher
  const { createWatcher } = require('./watcher');
  const { loadFilters } = require('./watcher/filter-loader');
  const { createActionHandlers } = require('./watcher/actions');
  const { createTicket } = require(path.join(getDefaultProjectRoot(), 'ai', 'views', 'issues-viewer', 'scripts', 'create-ticket'));

  // Create hold registry for auto-block timers
  const { createHoldRegistry } = require('./triggers/hold-registry');
  const issuesDir = path.join(AI_PANELS_PATH, 'issues-viewer');
  const holdRegistry = global.__holdRegistry = createHoldRegistry(issuesDir);

  // Wrap createTicket to hook trigger-created tickets into the hold registry
  const wrappedCreateTicket = function(ticketData) {
    const result = createTicket(ticketData);
    if (ticketData.autoHold && ticketData.triggerName && result?.id) {
      holdRegistry.hold(ticketData.assignee, ticketData.triggerName, result.id);
    }
    return result;
  };

  const projectWatcher = createWatcher(getDefaultProjectRoot());

  // Load declarative filters (.md) from filters/
  const filterDir = path.join(__dirname, 'watcher', 'filters');
  // Load modal component definitions from ai/components/
  const componentsDir = path.join(getDefaultProjectRoot(), 'ai', 'components');
  loadComponents(componentsDir);

  const actionHandlers = createActionHandlers({
    createTicket: wrappedCreateTicket,
    projectRoot: getDefaultProjectRoot(),
    getModalDefinition,
    db: getDb(),
    sendChatMessage(target, message, role) {
      for (const [ws, sess] of sessions) {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: 'system_message',
            content: message,
            role: role || 'system',
            target,
          }));
        }
      }
    },
    broadcastModal(config) {
      for (const [ws, sess] of sessions) {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'modal:show', ...config }));
        }
      }
    },
    broadcastFileChange(payload) {
      for (const [ws, sess] of sessions) {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify(payload));
        }
      }
    },
  });
  const declFilters = loadFilters(filterDir, actionHandlers);
  for (const f of declFilters) projectWatcher.addFilter(f);

  // Load agent TRIGGERS.md files
  const { loadTriggers } = require('./triggers/trigger-loader');
  const { createCronScheduler } = require('./triggers/cron-scheduler');
  const { evaluateCondition } = require('./watcher/filter-loader');

  const agentsBasePath = path.join(AI_PANELS_PATH, 'agents-viewer');
  try {
    const registry = JSON.parse(fs.readFileSync(path.join(agentsBasePath, 'registry.json'), 'utf8'));
    const { filters: triggerFilters, cronTriggers } = loadTriggers(
      getDefaultProjectRoot(), agentsBasePath, registry, actionHandlers
    );

    for (const f of triggerFilters) projectWatcher.addFilter(f);

    if (cronTriggers.length > 0) {
      const cronScheduler = createCronScheduler(wrappedCreateTicket, { evaluateCondition });
      for (const { trigger, assignee } of cronTriggers) {
        cronScheduler.register(trigger, assignee);
      }
      cronScheduler.start();
    }
  } catch (err) {
    console.error(`[Server] Failed to load agent triggers: ${err.message}`);
  }

  // Start runner heartbeat monitor
  const { checkHeartbeats } = require('./runner');
  checkHeartbeats(getDefaultProjectRoot());
}

async function _handleShutdown() {
  await closeDb();
  process.exit(0);
}

module.exports = { start };
