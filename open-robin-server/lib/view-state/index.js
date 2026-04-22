/**
 * View-state — STATE_OVERRIDE_SPEC.
 *
 * Workspace default:  ai/views/settings/state.json
 * Per-view override:  ai/views/<view>/settings/state.json (user-created only)
 *
 * Resolver deep-merges workspace ← override. Writer routes each leaf key
 * to whichever file already owns it (override wins when pinned).
 */

const { resolveViewState } = require('./resolver');
const { writeViewStatePatch } = require('./writer');

module.exports = {
  resolveViewState,
  writeViewStatePatch,
};
