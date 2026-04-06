/**
 * Sync pull — fetch issues from GitLab, update local tickets.
 *
 * Only updates state and assignee. Never deletes tickets.
 * New remote issues (not yet local) get created as local files.
 */

const fs = require('fs');
const path = require('path');
const { loadTicket, loadAllTickets } = require('../tickets/loader');
const { gitlabGet } = require('./request');

const ISSUES_REL = path.join('ai', 'views', 'issues-viewer');

/**
 * Pull issues updated since last sync.
 *
 * @param {string} projectRoot
 * @returns {Promise<{ updated: number, created: number, errors: string[] }>}
 */
async function pull(projectRoot) {
  const issuesDir = path.join(projectRoot, ISSUES_REL);
  const syncPath = path.join(issuesDir, 'sync.json');
  const indexPath = path.join(issuesDir, 'tickets.json');

  const sync = JSON.parse(fs.readFileSync(syncPath, 'utf8'));
  const result = { updated: 0, created: 0, errors: [] };

  // Build local lookup: gitlab_iid → ticket file
  const localTickets = loadAllTickets(issuesDir);
  const doneDir = path.join(issuesDir, 'done');
  let doneTickets = [];
  try { doneTickets = loadAllTickets(doneDir); } catch {}
  const allLocal = [...localTickets, ...doneTickets];

  const byIid = new Map();
  const byId = new Map();
  for (const t of allLocal) {
    if (t.frontmatter.gitlab_iid) byIid.set(String(t.frontmatter.gitlab_iid), t);
    if (t.frontmatter.id) byId.set(t.frontmatter.id, t);
  }

  // Fetch remote issues updated since last sync
  let query = 'state=all&per_page=100&scope=all';
  if (sync.last_sync) {
    query += `&updated_after=${sync.last_sync}`;
  }

  let remoteIssues;
  try {
    remoteIssues = await gitlabGet(`/issues?${query}`);
  } catch (err) {
    result.errors.push(`GitLab API: ${err.message}`);
    return result;
  }

  if (!Array.isArray(remoteIssues)) {
    result.errors.push('GitLab API returned non-array');
    return result;
  }

  let index;
  try { index = JSON.parse(fs.readFileSync(indexPath, 'utf8')); } catch {
    index = { version: '1.0', last_updated: null, tickets: {} };
  }

  for (const issue of remoteIssues) {
    const iid = String(issue.iid);
    const existing = byIid.get(iid);

    if (existing) {
      const localState = existing.frontmatter.state;
      const localAssignee = existing.frontmatter.assignee;

      // Derive remote state: GitLab only has opened/closed,
      // but a bot assignee on an open issue means "claimed by another instance"
      let remoteState;
      if (issue.state === 'closed') {
        remoteState = 'closed';
      } else {
        // Open on GitLab — check if a bot has claimed it
        const remoteAssignee = issue.assignees?.[0]?.username || null;
        const isBotAssigned = !!sync.bot_accounts?.[remoteAssignee];

        if (isBotAssigned && localState === 'open') {
          // Another instance claimed this ticket — mark locally as claimed
          remoteState = 'claimed';
        } else if (!isBotAssigned && localState === 'claimed') {
          // Claim was released remotely — revert to open
          remoteState = 'open';
        } else {
          remoteState = localState; // no change
        }
      }

      if (remoteState !== localState) {
        updateTicketState(issuesDir, existing, remoteState);
        result.updated++;
      }

      // Update assignee if changed on GitLab (only for human assignees)
      const remoteAssignee = issue.assignees?.[0]?.username || localAssignee;
      if (remoteAssignee !== localAssignee) {
        updateTicketField(issuesDir, existing, 'assignee', remoteAssignee);
        result.updated++;
      }
    } else {
      // New remote issue — create local ticket
      try {
        createLocalFromRemote(issuesDir, sync, index, issue);
        result.created++;
      } catch (err) {
        result.errors.push(`Create local for #${iid}: ${err.message}`);
      }
    }
  }

  // Update sync timestamp and index
  sync.last_sync = new Date().toISOString();
  fs.writeFileSync(syncPath, JSON.stringify(sync, null, 2) + '\n', 'utf8');

  index.last_updated = sync.last_sync;
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n', 'utf8');

  return result;
}

/**
 * Update a ticket's state field in its markdown file.
 */
function updateTicketState(issuesDir, ticket, newState) {
  const filename = ticket.filename;
  const currentDir = newState === 'closed' ? issuesDir : issuesDir;
  const filePath = path.join(currentDir, filename);

  // If closing, move to done/
  if (newState === 'closed') {
    const src = path.join(issuesDir, filename);
    const dest = path.join(issuesDir, 'done', filename);
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.join(issuesDir, 'done'), { recursive: true });
      fs.renameSync(src, dest);
      rewriteField(dest, 'state', 'closed');
      console.log(`[Sync:Pull] Closed ${ticket.frontmatter.id} → done/`);
      return;
    }
  }

  // Otherwise update in place
  if (fs.existsSync(filePath)) {
    rewriteField(filePath, 'state', newState);
    console.log(`[Sync:Pull] Updated ${ticket.frontmatter.id} state → ${newState}`);
  }
}

/**
 * Update a single frontmatter field in a ticket file.
 */
function updateTicketField(issuesDir, ticket, field, value) {
  const filePath = path.join(issuesDir, ticket.filename);
  if (fs.existsSync(filePath)) {
    rewriteField(filePath, field, value);
    console.log(`[Sync:Pull] Updated ${ticket.frontmatter.id} ${field} → ${value}`);
  }
}

/**
 * Rewrite a single frontmatter field in a markdown file.
 */
function rewriteField(filePath, field, value) {
  const content = fs.readFileSync(filePath, 'utf8');
  const pattern = new RegExp(`^${field}:.*$`, 'm');
  if (pattern.test(content)) {
    const updated = content.replace(pattern, `${field}: ${value}`);
    fs.writeFileSync(filePath, updated, 'utf8');
  }
}

/**
 * Create a local ticket file from a remote GitLab issue.
 */
function createLocalFromRemote(issuesDir, sync, index, issue) {
  const id = `KIMI-${String(sync.next_id).padStart(4, '0')}`;
  const filename = `${id}.md`;
  const created = issue.created_at || new Date().toISOString();
  const assignee = issue.assignees?.[0]?.username || 'unassigned';
  const state = issue.state === 'closed' ? 'closed' : 'open';

  const frontmatter = [
    '---',
    `id: ${id}`,
    `gitlab_iid: ${issue.iid}`,
    `title: ${issue.title}`,
    `assignee: ${assignee}`,
    `created: ${created}`,
    `author: gitlab`,
    `state: ${state}`,
    '---',
  ].join('\n');

  const body = issue.description || '';
  const content = body ? `${frontmatter}\n\n${body.trim()}\n` : `${frontmatter}\n`;

  const targetDir = state === 'closed' ? path.join(issuesDir, 'done') : issuesDir;
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, filename), content, 'utf8');

  sync.next_id += 1;
  index.tickets[id] = { title: issue.title, assignee, created, author: 'gitlab', state, body: (body || '').trim() };

  console.log(`[Sync:Pull] Created ${id} from GitLab #${issue.iid}`);
}

module.exports = { pull };
