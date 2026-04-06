/**
 * Ticket dispatch watcher — watches the issues panel for new/changed tickets
 * and dispatches to agents when a ticket is assigned to a known bot.
 *
 * The dispatch key is the assignee field. If the assignee matches a bot name
 * in the agents registry, the ticket is dispatched.
 *
 * Usage (standalone):
 *   node lib/tickets/dispatch.js [--project-root /path/to/project]
 *
 * Usage (as module):
 *   const { startDispatchWatcher } = require('./lib/tickets/dispatch');
 *   startDispatchWatcher(projectRoot);
 */

const fs = require('fs');
const path = require('path');
const { loadTicket, loadAllTickets } = require('./loader');
const { emit } = require('../event-bus');

// Debounce map — prevent double-fires from fs.watch
const pending = new Map();
const DEBOUNCE_MS = 200;

/**
 * Claim a ticket — write state: claimed to file + tickets.json.
 * Prevents other instances from dispatching the same ticket.
 * Returns true if claim succeeded, false if ticket was already claimed/closed.
 */
function claimTicket(issuesDir, ticket) {
  const state = ticket.frontmatter.state;
  if (state !== 'open') return false;

  const filePath = path.join(issuesDir, ticket.filename);
  if (!fs.existsSync(filePath)) return false;

  // Atomic-ish: read, check, write
  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes('state: open')) return false; // someone else claimed it

  const updated = content.replace(/^state: open$/m, 'state: claimed');
  fs.writeFileSync(filePath, updated, 'utf8');

  // Update tickets.json
  const indexPath = path.join(issuesDir, 'tickets.json');
  try {
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    if (index.tickets[ticket.frontmatter.id]) {
      index.tickets[ticket.frontmatter.id].state = 'claimed';
      index.last_updated = new Date().toISOString();
      fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n', 'utf8');
    }
  } catch {}

  console.log(`[Dispatch] Claimed ${ticket.frontmatter.id}`);
  emit('ticket:claimed', { ticketId: ticket.frontmatter.id, assignee: ticket.frontmatter.assignee, state: 'claimed' });
  return true;
}

/**
 * Release a claim — revert state back to open.
 * Used when a ticket is no longer eligible after pull.
 */
function releaseClaim(issuesDir, ticket) {
  const filePath = path.join(issuesDir, ticket.filename);
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, 'utf8');
  const updated = content.replace(/^state: claimed$/m, 'state: open');
  fs.writeFileSync(filePath, updated, 'utf8');

  const indexPath = path.join(issuesDir, 'tickets.json');
  try {
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    if (index.tickets[ticket.frontmatter.id]) {
      index.tickets[ticket.frontmatter.id].state = 'open';
      fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n', 'utf8');
    }
  } catch {}

  console.log(`[Dispatch] Released claim on ${ticket.frontmatter.id}`);
  emit('ticket:released', { ticketId: ticket.frontmatter.id, state: 'open' });
}

function loadRegistry(projectRoot) {
  const registryPath = path.join(projectRoot, 'ai', 'views', 'agents-viewer', 'registry.json');
  try {
    return JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  } catch {
    return { agents: {} };
  }
}

function extractTopic(ticket) {
  const title = ticket.frontmatter.title || '';
  const edgeMatch = title.match(/^Edge review:\s*(.+)$/i);
  if (edgeMatch) return edgeMatch[1].trim();
  return null;
}

function shouldDispatch(ticket, registry, allTickets) {
  if (!ticket || !ticket.frontmatter) return false;
  if (ticket.frontmatter.state === 'bypassed') return false;
  if (ticket.frontmatter.state !== 'open') return false;

  const assignee = ticket.frontmatter.assignee;
  const agent = registry.agents[assignee];
  if (!agent) return false; // assigned to human, skip

  if (ticket.frontmatter.blocked_by) {
    // "auto-hold" is a hard block — no ticket lookup needed
    if (ticket.frontmatter.blocked_by === 'auto-hold') {
      console.log(`  ⛔ Blocked by auto-hold (waiting for timer)`);
      return false;
    }
    const blocker = allTickets.find(t =>
      t.frontmatter.id === ticket.frontmatter.blocked_by &&
      t.frontmatter.state === 'open'
    );
    if (blocker) {
      console.log(`  ⛔ Blocked by ${ticket.frontmatter.blocked_by}`);
      return false;
    }
  }

  const topic = extractTopic(ticket);
  if (topic) {
    const topicBlocker = allTickets.find(t =>
      t.frontmatter.blocks === topic &&
      t.frontmatter.state === 'open' &&
      t.frontmatter.id !== ticket.frontmatter.id
    );
    if (topicBlocker) {
      console.log(`  ⛔ Topic "${topic}" blocked by ${topicBlocker.frontmatter.id}`);
      return false;
    }
  }

  return true;
}

function dispatch(ticket, registry) {
  const { executeRun } = require('../runner');
  const assignee = ticket.frontmatter.assignee;
  const agent = registry.agents[assignee];
  const projectRoot = path.resolve(path.join(__dirname, '..', '..', '..'));

  console.log(`\n🎫 DISPATCH → RUNNER ─────────────────────────`);
  console.log(`  Ticket:   ${ticket.frontmatter.id}`);
  console.log(`  Agent:    ${agent.folder}`);
  console.log(`─────────────────────────────────────────────\n`);
  emit('ticket:dispatched', { ticketId: ticket.frontmatter.id, assignee, agentFolder: agent.folder });

  executeRun(projectRoot, agent.folder, ticket).catch(err => {
    console.error(`[Runner] Failed to execute run for ${ticket.frontmatter.id}:`, err);
  });
}

function startDispatchWatcher(projectRoot) {
  const issuesDir = path.join(projectRoot, 'ai', 'views', 'issues-viewer');

  if (!fs.existsSync(issuesDir)) {
    console.error(`Issues directory not found: ${issuesDir}`);
    return null;
  }

  // Load registry once at start — reload on each dispatch to pick up changes
  console.log(`👁  Watching ${issuesDir} for ticket changes...`);
  console.log(`   Bot names: ${Object.keys(loadRegistry(projectRoot).agents).join(', ') || '(none)'}`);
  console.log('');

  const watcher = fs.watch(issuesDir, (event, filename) => {
    if (!filename || !filename.endsWith('.md') || !filename.startsWith('KIMI-')) return;

    // Debounce — fs.watch often fires twice for a single write
    if (pending.has(filename)) {
      clearTimeout(pending.get(filename));
    }

    pending.set(filename, setTimeout(async () => {
      pending.delete(filename);

      const ticketPath = path.join(issuesDir, filename);
      const ticket = loadTicket(ticketPath);
      if (!ticket) return;

      const registry = loadRegistry(projectRoot);

      const allTickets = loadAllTickets(issuesDir);
      if (shouldDispatch(ticket, registry, allTickets)) {
        // Step 1: Claim immediately — prevents other instances from grabbing it
        if (!claimTicket(issuesDir, ticket)) {
          console.log(`[Dispatch] ${ticket.frontmatter.id} — could not claim (already claimed or closed)`);
          return;
        }

        try {
          const { syncPull, syncPush } = require('../sync');

          // Step 2: Push the claim to GitLab so other machines see it
          console.log(`[Dispatch] Pushing claim to GitLab...`);
          await syncPush(projectRoot, ticket.frontmatter.id);

          // Step 3: Pull from GitLab — catch new blocks, closed tickets, etc.
          console.log(`[Dispatch] Pulling from GitLab before dispatch...`);
          await syncPull(projectRoot);

          // Step 4: Re-load and re-check — something may have changed
          const freshTicket = loadTicket(ticketPath);
          if (!freshTicket) {
            releaseClaim(issuesDir, ticket);
            return;
          }

          // For re-check, treat 'claimed' as eligible (we claimed it)
          const freshAll = loadAllTickets(issuesDir);
          const freshRegistry = loadRegistry(projectRoot);

          // Check blocking constraints (skip state check since we own the claim)
          const fm = freshTicket.frontmatter;
          let blocked = false;

          if (fm.blocked_by) {
            const blocker = freshAll.find(t =>
              t.frontmatter.id === fm.blocked_by && t.frontmatter.state === 'open'
            );
            if (blocker) { blocked = true; console.log(`[Dispatch] ${fm.id} — blocked by ${fm.blocked_by} after pull`); }
          }

          if (!blocked) {
            const topic = extractTopic(freshTicket);
            if (topic) {
              const topicBlocker = freshAll.find(t =>
                t.frontmatter.blocks === topic &&
                t.frontmatter.state === 'open' &&
                t.frontmatter.id !== fm.id
              );
              if (topicBlocker) { blocked = true; console.log(`[Dispatch] ${fm.id} — topic blocked after pull`); }
            }
          }

          if (blocked) {
            releaseClaim(issuesDir, freshTicket);
            await syncPush(projectRoot, freshTicket.frontmatter.id);
            return;
          }

          dispatch(freshTicket, freshRegistry);
        } catch (err) {
          console.error(`[Dispatch] Sync failed, dispatching with claimed state:`, err.message);
          dispatch(ticket, registry);
        }
      } else {
        const assignee = ticket.frontmatter.assignee || '(none)';
        const isBot = registry.agents[assignee];
        console.log(`📋 ${ticket.frontmatter.id} — assignee: ${assignee}${isBot ? '' : ' (human, no dispatch)'}`);
      }
    }, DEBOUNCE_MS));
  });

  return watcher;
}

// -- CLI entry point --

if (require.main === module) {
  const args = process.argv.slice(2);
  let projectRoot = path.join(__dirname, '..', '..');

  const rootIdx = args.indexOf('--project-root');
  if (rootIdx !== -1 && args[rootIdx + 1]) {
    projectRoot = path.resolve(args[rootIdx + 1]);
  }

  console.log(`Project root: ${projectRoot}`);
  const watcher = startDispatchWatcher(projectRoot);

  if (watcher) {
    process.on('SIGINT', () => {
      console.log('\nStopping dispatch watcher...');
      watcher.close();
      process.exit(0);
    });
  }
}

module.exports = { startDispatchWatcher, shouldDispatch, extractTopic };
