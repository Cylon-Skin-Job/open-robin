/**
 * Runner Orchestrator — coordinates run lifecycle for background agents.
 *
 * Exports:
 *   executeRun(projectRoot, agentFolder, ticket) -> { runId, runPath, status }
 *   checkHeartbeats(projectRoot) -> starts the heartbeat monitor
 */

const fs = require('fs');
const path = require('path');
const { createRunFolder } = require('./run-folder');
const { parsePrompt, buildContext } = require('./prompt-builder');
const { spawnSession, initializeWire, sendPrompt, sendContinue, killSession } = require('./wire-session');
const { createHeartbeatMonitor } = require('./heartbeat');
const { emit } = require('../event-bus');

// Active runs: runId -> { proc, runPath, agentId, lastActivity, stalls }
const activeRuns = new Map();

let heartbeat = null;

/**
 * Update manifest.json in a run folder.
 */
function updateManifest(runPath, updates) {
  const manifestPath = path.join(runPath, 'manifest.json');
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    Object.assign(manifest, updates);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    return manifest;
  } catch (err) {
    console.error(`[Runner] Failed to update manifest at ${runPath}: ${err.message}`);
    return null;
  }
}

/**
 * Attach stdout listener to track wire events and record activity.
 */
function attachOutputMonitor(proc, runId) {
  let buffer = '';

  proc.stdout.on('data', (chunk) => {
    if (heartbeat) {
      heartbeat.recordActivity(runId);
    }

    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.method === 'event' && msg.params) {
          const { type } = msg.params;
          if (type === 'TurnEnd') {
            console.log(`[Runner] Run ${runId}: TurnEnd received`);
          }
        }
      } catch {
        // Not JSON — ignore
      }
    }
  });

  proc.on('exit', (code) => {
    const run = activeRuns.get(runId);
    if (run) {
      const status = code === 0 ? 'completed' : 'stopped';
      const error = code !== 0 ? `Process exited with code ${code}` : null;
      const manifest = updateManifest(run.runPath, {
        status,
        completed: new Date().toISOString(),
        outcome: code === 0 ? 'success' : 'error',
        error,
      });
      activeRuns.delete(runId);
      console.log(`[Runner] Run ${runId} finished (status: ${status})`);

      if (code === 0) {
        emit('agent:run_completed', { runId, agentId: manifest?.agent_id, ticketId: manifest?.ticket_id, status: 'completed', outcome: 'success' });
        emit('ticket:closed', { ticketId: manifest?.ticket_id, outcome: manifest?.outcome || 'success' });
      } else {
        emit('agent:run_failed', { runId, agentId: manifest?.agent_id, ticketId: manifest?.ticket_id, status: 'stopped', error });
      }

      // Append one-liner to agent's HISTORY.md
      try {
        const agentBase = path.resolve(path.join(run.runPath, '..', '..'));
        const historyPath = path.join(agentBase, 'HISTORY.md');
        const promptUsed = manifest?.prompt || 'PROMPT_01.md';
        const ticketTitle = manifest?.ticket_id || runId;
        const now = new Date();
        const ts = now.toISOString().slice(0, 16).replace('T', ' ');
        const outcomeTag = status === 'completed' ? '' : ` [${(manifest?.outcome || status).toUpperCase()}]`;
        const entry = `- **${ts}** — ${promptUsed}: ${ticketTitle}${outcomeTag} [run: ${runId}]`;

        let history = '';
        try { history = fs.readFileSync(historyPath, 'utf8'); } catch { /* new file */ }

        if (history.includes('## Recent')) {
          history = history.replace('## Recent\n', `## Recent\n${entry}\n`);
        } else {
          history = `# History\n\n## Recent\n${entry}\n\n## Daily Summaries\n`;
        }
        fs.writeFileSync(historyPath, history);
        console.log(`[Runner] Appended to HISTORY.md for ${manifest?.agent_id || 'unknown'}`);
      } catch (err) {
        console.error(`[Runner] Failed to append HISTORY.md: ${err.message}`);
      }

      // Push completed state to GitLab
      if (status === 'completed' && manifest?.ticket_id) {
        try {
          const { syncPush } = require('../sync');
          const projectRoot = path.resolve(path.join(run.runPath, '..', '..', '..', '..', '..', '..'));
          syncPush(projectRoot, manifest.ticket_id).catch(err => {
            console.error(`[Runner] Post-completion sync push failed: ${err.message}`);
          });
        } catch (err) {
          console.error(`[Runner] Could not load sync module: ${err.message}`);
        }
      }
    }
  });
}

/**
 * Execute a run: create folder, spawn wire, send prompt.
 *
 * @param {string} projectRoot
 * @param {string} agentFolder - Relative folder inside agents (e.g. "agents/wiki-updater")
 * @param {{ frontmatter: Object, body: string, filename: string }} ticket
 * @returns {Promise<{ runId: string, runPath: string, status: string }>}
 */
async function executeRun(projectRoot, agentFolder, ticket) {
  let runId, runPath, manifest;

  // Step 1: Create run folder
  try {
    ({ runId, runPath, manifest } = createRunFolder(projectRoot, agentFolder, ticket));
    console.log(`[Runner] Created run folder: ${runPath}`);
  } catch (err) {
    console.error(`[Runner] Failed to create run folder: ${err.message}`);
    return { runId: null, runPath: null, status: 'error' };
  }

  // Step 2: Build context
  let systemContext, userMessage;
  try {
    ({ systemContext, userMessage } = buildContext(projectRoot, agentFolder, runPath, ticket));
  } catch (err) {
    console.error(`[Runner] Failed to build context: ${err.message}`);
    updateManifest(runPath, { status: 'error', error: `Context build failed: ${err.message}` });
    return { runId, runPath, status: 'error' };
  }

  // Step 3: Spawn wire process
  let proc;
  try {
    proc = spawnSession(projectRoot);
  } catch (err) {
    console.error(`[Runner] Failed to spawn wire: ${err.message}`);
    updateManifest(runPath, { status: 'error', error: `Spawn failed: ${err.message}` });
    return { runId, runPath, status: 'error' };
  }

  // Register in active runs
  activeRuns.set(runId, {
    proc,
    runPath,
    agentId: manifest.agent_id,
    lastActivity: Date.now(),
    stalls: 0,
  });

  // Step 4: Attach output monitor (before initialize so we don't miss messages)
  attachOutputMonitor(proc, runId);

  // Step 5: Initialize wire
  try {
    await initializeWire(proc);
    console.log(`[Runner] Wire initialized for run ${runId}`);
  } catch (err) {
    console.error(`[Runner] Wire init failed: ${err.message}`);
    updateManifest(runPath, { status: 'error', error: `Wire init failed: ${err.message}` });
    killSession(proc);
    activeRuns.delete(runId);
    return { runId, runPath, status: 'error' };
  }

  // Step 6: Update manifest to running and send prompt
  updateManifest(runPath, { status: 'running', started: new Date().toISOString() });
  sendPrompt(proc, systemContext, userMessage);

  console.log(`[Runner] Run ${runId} started for agent ${manifest.agent_id}`);
  emit('agent:run_started', { runId, agentId: manifest.agent_id, ticketId: ticket.frontmatter?.id, botName: manifest?.bot_name });
  return { runId, runPath, status: 'running' };
}

/**
 * Start the heartbeat monitor for all active runs.
 *
 * @param {string} projectRoot - Not used directly but available for future expansion
 * @param {Object} [options] - Heartbeat options (intervalMs, maxStalls)
 */
function checkHeartbeats(projectRoot, options = {}) {
  if (heartbeat) {
    heartbeat.stop();
  }

  heartbeat = createHeartbeatMonitor(activeRuns, {
    ...options,
    onStall(runId, stalls) {
      const run = activeRuns.get(runId);
      if (!run) return;
      console.log(`[Runner] Nudging stalled run ${runId} (stall #${stalls})`);
      sendContinue(run.proc, `[System] Heartbeat check: no activity detected. Please continue working or report status.`);
    },
    onMaxStalls(runId) {
      const run = activeRuns.get(runId);
      if (!run) return;
      updateManifest(run.runPath, {
        status: 'stopped',
        completed: new Date().toISOString(),
        outcome: 'stalled',
        error: `Run stalled after ${options.maxStalls || 3} heartbeat checks with no activity`,
      });
      killSession(run.proc);
      activeRuns.delete(runId);
      console.log(`[Runner] Killed stalled run ${runId}`);
      emit('agent:run_stalled', { runId, agentId: run.agentId, stallCount: options.maxStalls || 3 });
    },
  });

  heartbeat.start();
  return heartbeat;
}

module.exports = { executeRun, checkHeartbeats };
