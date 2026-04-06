/**
 * Prompt Builder — parses prompt.md frontmatter and assembles orchestrator context.
 *
 * Pure data-access: reads files, returns strings. No side effects.
 */

const fs = require('fs');
const path = require('path');

/**
 * Simple YAML frontmatter parser.
 * Splits on --- delimiters, parses key: value lines.
 * Handles nested objects one level deep (indented lines).
 *
 * @param {string} promptPath - Absolute path to prompt.md
 * @returns {{ frontmatter: Object, body: string }}
 */
function parsePrompt(promptPath) {
  const raw = fs.readFileSync(promptPath, 'utf8');

  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: raw.trim() };
  }

  const frontmatter = {};
  let currentKey = null;

  for (const line of match[1].split('\n')) {
    // Indented line → nested value under currentKey
    if (/^\s{2,}/.test(line) && currentKey) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const k = line.slice(0, colonIdx).trim();
      let v = line.slice(colonIdx + 1).trim();
      // Coerce booleans and numbers
      if (v === 'true') v = true;
      else if (v === 'false') v = false;
      else if (/^\d+$/.test(v)) v = Number(v);
      if (typeof frontmatter[currentKey] !== 'object' || frontmatter[currentKey] === null) {
        frontmatter[currentKey] = {};
      }
      frontmatter[currentKey][k] = v;
      continue;
    }

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();

    if (value === '') {
      // Next lines may be nested
      currentKey = key;
      frontmatter[key] = null;
      continue;
    }

    currentKey = key;

    // Handle inline arrays: ["a", "b"]
    if (value.startsWith('[') && value.endsWith(']')) {
      try {
        value = JSON.parse(value);
      } catch {
        // leave as string
      }
    } else if (value === 'true') {
      value = true;
    } else if (value === 'false') {
      value = false;
    } else if (/^\d+$/.test(value)) {
      value = Number(value);
    } else {
      // Strip surrounding quotes
      value = value.replace(/^["'](.*)["']$/, '$1');
    }

    frontmatter[key] = value;
  }

  return { frontmatter, body: match[2].trim() };
}

/**
 * Assemble the full orchestrator context for a run.
 *
 * @param {string} projectRoot
 * @param {string} agentFolder - Relative folder inside agents
 * @param {string} runPath - Absolute path to the run directory
 * @param {{ frontmatter: Object, body: string, filename: string }} ticket
 * @returns {{ systemContext: string, userMessage: string }}
 */
function buildContext(projectRoot, agentFolder, runPath, ticket) {
  const agentBase = path.join(
    projectRoot, 'ai', 'views', 'agents-viewer', agentFolder
  );

  // --- System context ---
  const parts = [];

  // 1. AGENTS.md — server-level agent docs
  const agentsMdPath = path.join(projectRoot, 'open-robin-server', 'AGENTS.md');
  try {
    parts.push(fs.readFileSync(agentsMdPath, 'utf8'));
  } catch {
    // AGENTS.md missing — not fatal
  }

  // 2. PROMPT_NN.md body (instructions) — read from ticket's prompt field, or default
  const promptFile = (ticket.frontmatter && ticket.frontmatter.prompt) || 'PROMPT_01.md';
  const promptPath = path.join(agentBase, promptFile);
  try {
    const { body } = parsePrompt(promptPath);
    parts.push(body);
  } catch {
    // prompt.md missing — not fatal
  }

  // LESSONS.md is NOT loaded into system context.
  // The PROMPT_NN.md instructions tell the bot to read LESSONS.md itself.
  // This keeps system context lean and lets the bot decide what's relevant.
  // LESSONS.md is still frozen into the run folder for audit purposes.

  const systemContext = parts.join('\n\n---\n\n');

  // --- User message ---
  const ticketContent = ticket.body || '';
  const ticketId = ticket.frontmatter.id || ticket.filename.replace('.md', '');
  const ticketTitle = ticket.frontmatter.title || '(untitled)';

  let fileListing = '';
  try {
    const files = fs.readdirSync(runPath);
    fileListing = files.join('\n');
  } catch {
    fileListing = '(could not read run folder)';
  }

  const userMessage = [
    `## Ticket: ${ticketId} — ${ticketTitle}`,
    '',
    ticketContent,
    '',
    `## Run Folder`,
    `Path: ${runPath}`,
    '',
    '```',
    fileListing,
    '```',
  ].join('\n');

  return { systemContext, userMessage };
}

module.exports = { parsePrompt, buildContext };
