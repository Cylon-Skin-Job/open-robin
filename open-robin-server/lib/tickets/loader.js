/**
 * Ticket loader — reads ticket markdown files, returns parsed frontmatter + body
 *
 * Pure data-access module (Layer 4). Returns data only.
 * No events, no DOM, no business logic.
 */

const fs = require('fs');
const path = require('path');

/**
 * Parse a ticket markdown file into frontmatter object + body string.
 * @param {string} filePath - Absolute path to a ticket .md file
 * @returns {{ frontmatter: Object, body: string, filename: string } | null}
 */
function loadTicket(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }

  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;

  const frontmatter = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    frontmatter[key] = value;
  }

  frontmatter.blocks = frontmatter.blocks || null;
  frontmatter.blocked_by = frontmatter.blocked_by || null;

  return {
    frontmatter,
    body: match[2].trim(),
    filename: path.basename(filePath),
  };
}

/**
 * Load all tickets from a directory.
 * @param {string} dirPath - Directory containing ticket .md files
 * @returns {Array<{ frontmatter: Object, body: string, filename: string }>}
 */
function loadAllTickets(dirPath) {
  let files;
  try {
    files = fs.readdirSync(dirPath);
  } catch {
    return [];
  }

  return files
    .filter(f => f.endsWith('.md') && f.startsWith('KIMI-'))
    .map(f => loadTicket(path.join(dirPath, f)))
    .filter(Boolean);
}

/**
 * Load sync.json from the issues panel.
 * @param {string} issuesDir - Path to the issues panel root
 * @returns {Object|null}
 */
function loadSync(issuesDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(issuesDir, 'sync.json'), 'utf8'));
  } catch {
    return null;
  }
}

module.exports = { loadTicket, loadAllTickets, loadSync };
