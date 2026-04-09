/**
 * Ticket loader — reads ticket markdown files, returns parsed frontmatter + body
 *
 * Pure data-access module (Layer 4). Returns data only.
 * No events, no DOM, no business logic.
 */

const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('../frontmatter');

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

  const { frontmatter, body } = parseFrontmatter(raw, 'ticket');

  // A ticket must have at least one frontmatter field. If the file has no
  // --- block, parseFrontmatter returns { frontmatter: {}, body: raw } —
  // that's "not a ticket" in this context, so return null to match the
  // pre-SPEC-25 behavior.
  if (Object.keys(frontmatter).length === 0) return null;

  frontmatter.blocks = frontmatter.blocks || null;
  frontmatter.blocked_by = frontmatter.blocked_by || null;

  return {
    frontmatter,
    body,
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
