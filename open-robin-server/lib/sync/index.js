/**
 * Ticket sync orchestrator — coordinates pull and push with GitLab.
 *
 * Thin wrapper: delegates to pull.js and push.js.
 * Called by dispatch (pre-dispatch pull) and runner (post-completion push).
 */

const { pull } = require('./pull');
const { push } = require('./push');

/**
 * Pull latest state from GitLab into local tickets.
 * Updates local files + tickets.json. Does not delete anything.
 *
 * @param {string} projectRoot
 * @returns {Promise<{ updated: number, created: number, errors: string[] }>}
 */
async function syncPull(projectRoot) {
  try {
    const result = await pull(projectRoot);
    console.log(`[Sync] Pull complete: ${result.created} created, ${result.updated} updated`);
    return result;
  } catch (err) {
    console.error(`[Sync] Pull failed: ${err.message}`);
    return { updated: 0, created: 0, errors: [err.message] };
  }
}

/**
 * Push local ticket state to GitLab.
 * Creates issues that don't have gitlab_iid, updates state for those that do.
 *
 * @param {string} projectRoot
 * @param {string} [ticketId] - Optional: push only this ticket (e.g. after completion)
 * @returns {Promise<{ pushed: number, created: number, errors: string[] }>}
 */
async function syncPush(projectRoot, ticketId) {
  try {
    const result = await push(projectRoot, ticketId);
    console.log(`[Sync] Push complete: ${result.created} created, ${result.pushed} pushed`);
    return result;
  } catch (err) {
    console.error(`[Sync] Push failed: ${err.message}`);
    return { pushed: 0, created: 0, errors: [err.message] };
  }
}

module.exports = { syncPull, syncPush };
