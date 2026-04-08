/**
 * Agent Session Handler
 *
 * Handles the thread:open-agent client message. Loads SESSION.md config
 * for a named agent persona, resolves a thread via the agent's
 * ThreadManager + strategy, spawns a wire, wires up the per-connection
 * lifecycle helpers, and registers the agent session by bot name.
 *
 * Extracted from server.js per SPEC-01e. Lives in lib/thread/ rather
 * than lib/agent/ because it is morally a thread operation — it sits
 * alongside thread-crud.js and thread-messages.js as a thread handler
 * factory, and uses ThreadWebSocketHandler / ThreadManager as its
 * primary collaborators.
 *
 * Per-connection factory: called once per WebSocket connection inside
 * wss.on('connection'), after createWireLifecycle has produced the
 * lifecycle helpers.
 */

const path = require('path');
const fs = require('fs');

const {
  parseSessionConfig,
  buildSystemContext,
  checkSessionInvalidation,
  getStrategy,
} = require('../session/session-loader');

const { spawnThreadWire } = require('../harness/compat');
const { registerWire } = require('../wire/process-manager');
const { registerAgentSession } = require('../wire/agent-sessions');

/**
 * Create a per-connection thread:open-agent handler.
 *
 * @param {object} deps
 * @param {import('ws').WebSocket} deps.ws - the connection's WebSocket
 * @param {object} deps.session - per-connection session state object (mutated)
 * @param {string} deps.projectRoot - resolved at connection time
 * @param {string} deps.AI_PANELS_PATH - absolute ai/views/ path
 * @param {() => string} deps.getDefaultProjectRoot - re-evaluated at handler-call time for live config reload
 * @param {object} deps.threadWebSocketHandler - the ThreadWebSocketHandler module
 * @param {{ awaitHarnessReady, initializeWire, setupWireHandlers }} deps.wireLifecycle - from createWireLifecycle
 * @returns {{ handleThreadOpenAgent: (clientMsg: object) => Promise<void> }}
 */
function createAgentSessionHandler({
  ws,
  session,
  projectRoot,
  AI_PANELS_PATH,
  getDefaultProjectRoot,
  threadWebSocketHandler,
  wireLifecycle,
}) {

  const { awaitHarnessReady, initializeWire, setupWireHandlers } = wireLifecycle;

  async function handleThreadOpenAgent(clientMsg) {
    const { agentPath } = clientMsg;
    if (!agentPath) {
      ws.send(JSON.stringify({ type: 'error', message: 'Missing agentPath' }));
      return;
    }

    // Close current wire if switching
    if (session.wire) {
      session.wire.kill('SIGTERM');
      session.wire = null;
    }

    const agentFolderPath = path.join(AI_PANELS_PATH, 'agents-viewer', agentPath);

    // Load SESSION.md config
    const config = parseSessionConfig(agentFolderPath);
    if (!config) {
      ws.send(JSON.stringify({ type: 'error', message: `No SESSION.md in ${agentPath}` }));
      return;
    }

    // Get or create ThreadManager for this agent (single instance, cached)
    // Use absolute path to agent's chat folder as the stable DB key
    const agentChatPath = path.join(agentFolderPath, 'chat');
    threadWebSocketHandler.setPanel(ws, agentChatPath, {
      panelPath: agentFolderPath,
      projectRoot: getDefaultProjectRoot(),
      viewName: `agent:${agentPath}`,
    });
    const agentThreadManager = threadWebSocketHandler.getState(ws).threadManager;
    await agentThreadManager.init();

    // Get strategy and resolve thread
    const strategy = getStrategy(config.threadModel);
    const { threadId, isNew } = await strategy.resolveThread(agentThreadManager);

    if (!threadId) {
      ws.send(JSON.stringify({ type: 'error', message: 'Strategy returned no thread' }));
      return;
    }

    // Check session invalidation
    if (config.sessionInvalidation === 'memory-mtime' && !isNew) {
      const thread = await agentThreadManager.index.get(threadId);
      const lastMessage = thread?.resumedAt ? new Date(thread.resumedAt).getTime() : 0;
      if (checkSessionInvalidation(agentFolderPath, lastMessage)) {
        console.log(`[WS] MEMORY.md changed — archiving thread ${threadId}`);
        await agentThreadManager.index.suspend(threadId);
        // Resolve a fresh thread
        const fresh = await strategy.resolveThread(agentThreadManager);
        if (fresh.threadId && fresh.threadId !== threadId) {
          // Use the fresh thread
          Object.assign(fresh, { threadId: fresh.threadId });
        }
      }
    }

    session.currentThreadId = threadId;

    // Build system context from SESSION.md's system-context list
    const systemContext = buildSystemContext(agentFolderPath, config.systemContext);
    session.pendingSystemContext = systemContext;

    // Send thread history to client
    const history = await agentThreadManager.getHistory(threadId);
    const richHistory = await agentThreadManager.getRichHistory(threadId);

    // Extract context usage from the last exchange's metadata
    const exchanges = richHistory?.exchanges || [];
    const lastExchange = exchanges.length > 0 ? exchanges[exchanges.length - 1] : null;
    const contextUsage = lastExchange?.metadata?.contextUsage ?? null;

    ws.send(JSON.stringify({
      type: 'thread:opened',
      threadId,
      thread: await agentThreadManager.index.get(threadId),
      history: history?.messages || [],
      exchanges: exchanges,
      contextUsage,  // Restore context usage from last exchange
      agentPath,
      strategy: { canBrowseOld: strategy.canBrowseOld, canCreateNew: strategy.canCreateNew },
    }));

    // Spawn wire
    console.log(`[WS] Spawning wire for agent persona: ${agentPath}, thread: ${threadId}`);
    session.wire = spawnThreadWire(threadId, projectRoot);
    registerWire(threadId, session.wire, projectRoot, ws);
    await awaitHarnessReady(session.wire);
    setupWireHandlers(session.wire, threadId);
    initializeWire(session.wire);

    // Track agent wire session for notifications
    const registry = JSON.parse(fs.readFileSync(path.join(AI_PANELS_PATH, 'agents-viewer', 'registry.json'), 'utf8'));
    for (const [botName, agent] of Object.entries(registry.agents || {})) {
      if (agent.folder === agentPath) {
        registerAgentSession(botName, session.wire);
        break;
      }
    }

    await agentThreadManager.openSession(threadId, session.wire, ws);
    console.log(`[WS] Agent persona session opened: ${agentPath}`);
  }

  return { handleThreadOpenAgent };
}

module.exports = { createAgentSessionHandler };
