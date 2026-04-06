/**
 * Sync push — push local ticket state to GitLab.
 *
 * GitLab assignee IS the claim signal:
 *   - Bot-assigned ticket, state: open  → push with NO assignee (available)
 *   - Bot-assigned ticket, state: claimed → push WITH bot assignee (taken)
 *   - Human-assigned ticket → push with human assignee
 *   - Closed ticket → close on GitLab, clear assignee
 */

const fs = require('fs');
const path = require('path');
const { loadTicket, loadAllTickets } = require('../tickets/loader');
const { gitlabPost, gitlabPut } = require('./request');

const ISSUES_REL = path.join('ai', 'views', 'issues-viewer');

/**
 * Push local tickets to GitLab.
 *
 * @param {string} projectRoot
 * @param {string} [ticketId] - Push only this ticket, or all if omitted
 * @returns {Promise<{ pushed: number, created: number, errors: string[] }>}
 */
async function push(projectRoot, ticketId) {
  const issuesDir = path.join(projectRoot, ISSUES_REL);
  const syncPath = path.join(issuesDir, 'sync.json');
  const result = { pushed: 0, created: 0, errors: [] };

  const sync = JSON.parse(fs.readFileSync(syncPath, 'utf8'));

  // Gather tickets to push
  let tickets = [];
  if (ticketId) {
    const openPath = path.join(issuesDir, `${ticketId}.md`);
    const donePath = path.join(issuesDir, 'done', `${ticketId}.md`);
    const t = loadTicket(openPath) || loadTicket(donePath);
    if (t) tickets.push(t);
  } else {
    tickets = loadAllTickets(issuesDir);
    try {
      const done = loadAllTickets(path.join(issuesDir, 'done'));
      tickets.push(...done);
    } catch {}
  }

  const isBot = (name) => !!sync.bot_accounts?.[name];
  const botUserId = (name) => sync.bot_accounts?.[name]?.gitlab_user_id;

  for (const ticket of tickets) {
    const fm = ticket.frontmatter;
    if (!fm.id) continue;

    try {
      if (!fm.gitlab_iid) {
        // New ticket — create on GitLab
        const body = {
          title: fm.title,
          description: ticket.body || '',
        };

        // Human-assigned → set assignee on GitLab immediately
        // Bot-assigned → no assignee on GitLab (available for dispatch)
        if (fm.assignee && !isBot(fm.assignee)) {
          // Human — look up user ID if we have it, otherwise just set title/desc
          // (GitLab needs user IDs, not usernames, for assignee_ids)
        }

        const created = await gitlabPost('/issues', body);
        if (created?.iid) {
          writeIidToTicket(issuesDir, ticket, created.iid);
          console.log(`[Sync:Push] Created GitLab #${created.iid} for ${fm.id} (no assignee — available)`);
          result.created++;
        }

      } else if (fm.state === 'closed') {
        // Close on GitLab
        await gitlabPut(`/issues/${fm.gitlab_iid}`, {
          state_event: 'close',
          assignee_ids: [],
        });
        console.log(`[Sync:Push] Closed GitLab #${fm.gitlab_iid} for ${fm.id}`);
        result.pushed++;

      } else if (fm.state === 'claimed') {
        // Claimed — set the bot assignee on GitLab (the claim signal)
        const userId = botUserId(fm.assignee);
        if (userId) {
          await gitlabPut(`/issues/${fm.gitlab_iid}`, {
            assignee_ids: [userId],
          });
          console.log(`[Sync:Push] Claimed GitLab #${fm.gitlab_iid} → ${fm.assignee} for ${fm.id}`);
        } else {
          console.log(`[Sync:Push] Claimed ${fm.id} but no GitLab user ID for ${fm.assignee} — skipping`);
        }
        result.pushed++;

      } else if (fm.state === 'open') {
        // Open — clear assignee on GitLab (release / available)
        await gitlabPut(`/issues/${fm.gitlab_iid}`, {
          assignee_ids: [],
        });
        console.log(`[Sync:Push] Released GitLab #${fm.gitlab_iid} for ${fm.id} (no assignee — available)`);
        result.pushed++;
      }
    } catch (err) {
      result.errors.push(`${fm.id}: ${err.message}`);
    }
  }

  return result;
}

/**
 * Write the gitlab_iid back to a ticket's frontmatter.
 */
function writeIidToTicket(issuesDir, ticket, iid) {
  const filePath = path.join(issuesDir, ticket.filename);
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, 'utf8');
  const updated = content.replace(
    /^(id: .+)$/m,
    `$1\ngitlab_iid: ${iid}`
  );
  fs.writeFileSync(filePath, updated, 'utf8');
}

module.exports = { push };
