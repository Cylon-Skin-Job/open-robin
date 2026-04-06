/**
 * Run Folder Setup — creates the run directory and freezes seed files.
 *
 * Each run lives at:
 *   {projectRoot}/ai/views/agents-viewer/{agentFolder}/runs/{timestamp}/
 */

const fs = require('fs');
const path = require('path');
const { parsePrompt } = require('./prompt-builder');

/**
 * Filesystem-safe ISO timestamp: YYYY-MM-DDTHH-MM-SS
 */
function makeTimestamp() {
  return new Date().toISOString()
    .replace(/:/g, '-')
    .replace(/\.\d{3}Z$/, '');
}

/**
 * Create a run folder, freeze seed files, write manifest and run-index.
 *
 * @param {string} projectRoot - Absolute path to the project root
 * @param {string} agentFolder - Relative folder inside agents (e.g. "agents/wiki-updater")
 * @param {{ frontmatter: Object, body: string, filename: string }} ticket - Parsed ticket object
 * @returns {{ runId: string, runPath: string, manifest: Object }}
 */
function createRunFolder(projectRoot, agentFolder, ticket) {
  const runId = makeTimestamp();
  const agentBase = path.join(projectRoot, 'ai', 'views', 'agents-viewer', agentFolder);
  const runPath = path.join(agentBase, 'runs', runId);

  // Create run directory (and runs/ parent if needed)
  fs.mkdirSync(runPath, { recursive: true });

  // --- Freeze seed files ---

  // 1. ticket.md — copy from the issues panel
  const ticketSource = path.join(
    projectRoot, 'ai', 'views', 'issues-viewer', ticket.filename
  );
  if (fs.existsSync(ticketSource)) {
    fs.copyFileSync(ticketSource, path.join(runPath, 'ticket.md'));
  }

  // 2. PROMPT_NN.md — from the agent folder (ticket's prompt field, or default)
  const promptFile = (ticket.frontmatter && ticket.frontmatter.prompt) || 'PROMPT_01.md';
  const promptSource = path.join(agentBase, promptFile);
  if (fs.existsSync(promptSource)) {
    fs.copyFileSync(promptSource, path.join(runPath, promptFile));
  }

  // 3. LESSONS.md — from the agent folder
  const lessonsSource = path.join(agentBase, 'LESSONS.md');
  if (fs.existsSync(lessonsSource)) {
    fs.copyFileSync(lessonsSource, path.join(runPath, 'LESSONS.md'));
  }

  // --- Parse prompt frontmatter for manifest fields ---
  let botName = '';
  let model = null;
  try {
    const parsed = parsePrompt(promptSource);
    botName = parsed.frontmatter.bot_name || '';
    model = parsed.frontmatter.model || null;
  } catch {
    // prompt.md missing or unparseable — continue with defaults
  }

  // --- Write manifest.json ---
  const agentId = path.basename(agentFolder);
  const manifest = {
    run_id: runId,
    agent_id: agentId,
    bot_name: botName,
    ticket_id: ticket.frontmatter.id || ticket.filename.replace('.md', ''),
    prompt: promptFile,
    status: 'pending',
    created: new Date().toISOString(),
    started: null,
    completed: null,
    model: model,
    outcome: null,
    error: null,
  };

  fs.writeFileSync(
    path.join(runPath, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  // --- Write run-index.json ---
  const runIndex = { version: '1.0', steps: [] };
  fs.writeFileSync(
    path.join(runPath, 'run-index.json'),
    JSON.stringify(runIndex, null, 2)
  );

  return { runId, runPath, manifest };
}

module.exports = { createRunFolder };
