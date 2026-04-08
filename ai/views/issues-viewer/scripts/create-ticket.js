/**
 * create-ticket.js — Creates local ticket markdown files
 *
 * Issues panel owns ticket creation. This script:
 * - Reads sync.json for the next ID
 * - Writes a frontmatter + body markdown file
 * - Increments the counter
 *
 * Usage:
 *   node create-ticket.js --title "Fix the thing" --assignee kimi-wiki --body "Details here"
 *   node create-ticket.js --title "Fix the thing" --assignee kimi-wiki --body-file path/to/body.md
 *
 * Options:
 *   --title      (required) One-line summary
 *   --assignee   (required) Human username or bot name (dispatch key)
 *   --body       Ticket body text (inline)
 *   --body-file  Path to a file containing the ticket body
 */

const fs = require('fs');
const path = require('path');

const ISSUES_DIR = path.join(__dirname, '..');
const SYNC_PATH = path.join(ISSUES_DIR, 'sync.json');
const INDEX_PATH = path.join(ISSUES_DIR, 'index.json');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--title' && argv[i + 1]) {
      args.title = argv[++i];
    } else if (argv[i] === '--assignee' && argv[i + 1]) {
      args.assignee = argv[++i];
    } else if (argv[i] === '--body' && argv[i + 1]) {
      args.body = argv[++i];
    } else if (argv[i] === '--body-file' && argv[i + 1]) {
      args.bodyFile = argv[++i];
    } else if (argv[i] === '--blocks' && argv[i + 1]) {
      args.blocks = argv[++i];
    } else if (argv[i] === '--blocked-by' && argv[i + 1]) {
      args.blockedBy = argv[++i];
    }
  }
  return args;
}

function padId(num) {
  return String(num).padStart(4, '0');
}

function createTicket({ title, assignee, body, blocks, blockedBy, prompt, triggerName, autoHold }) {
  const sync = JSON.parse(fs.readFileSync(SYNC_PATH, 'utf8'));
  const id = `KIMI-${padId(sync.next_id)}`;
  const filename = `${id}.md`;
  const created = new Date().toISOString();

  let frontmatter = [
    '---',
    `id: ${id}`,
    `title: ${title}`,
    `assignee: ${assignee}`,
    `created: ${created}`,
    `author: local`,
    `state: open`,
  ];
  if (prompt) frontmatter.push(`prompt: ${prompt}`);
  if (blocks) frontmatter.push(`blocks: ${blocks}`);
  if (autoHold) frontmatter.push('blocked_by: auto-hold');
  else if (blockedBy) frontmatter.push(`blocked_by: ${blockedBy}`);
  frontmatter.push('---');
  frontmatter = frontmatter.join('\n');

  const content = body
    ? `${frontmatter}\n\n${body.trim()}\n`
    : `${frontmatter}\n`;

  const ticketPath = path.join(ISSUES_DIR, filename);
  fs.writeFileSync(ticketPath, content, 'utf8');

  sync.next_id += 1;
  fs.writeFileSync(SYNC_PATH, JSON.stringify(sync, null, 2) + '\n', 'utf8');

  // Update index.json
  let index = { version: '1.0', last_updated: null, tickets: {} };
  try { index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')); } catch {}
  index.tickets[id] = {
    title, assignee, created,
    author: 'local', state: 'open',
    body: (body || '').trim(),
    blocks: blocks || null,
    blocked_by: blockedBy || null,
  };
  index.last_updated = created;
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2) + '\n', 'utf8');

  console.log(`Created ${ticketPath}`);
  return { id, path: ticketPath };
}

// -- CLI entry point --

if (require.main === module) {
  const args = parseArgs(process.argv);

  if (!args.title || !args.assignee) {
    console.error('Usage: node create-ticket.js --title "..." --assignee "..." [--body "..." | --body-file path]');
    process.exit(1);
  }

  let body = args.body || '';
  if (args.bodyFile) {
    body = fs.readFileSync(args.bodyFile, 'utf8');
  }

  const result = createTicket({ title: args.title, assignee: args.assignee, body, blocks: args.blocks, blockedBy: args.blockedBy });
  console.log(`Ticket ${result.id} ready.`);
}

module.exports = { createTicket };
