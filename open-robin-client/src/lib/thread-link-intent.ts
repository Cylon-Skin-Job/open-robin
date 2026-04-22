/**
 * @module thread-link-intent
 * @role Coordinates the intent behind a `thread:copyLink` WS request so
 *       the shared `thread:link` response handler can do the right thing.
 *
 * The server responds to `thread:copyLink` with `thread:link` containing
 * the file path. Callers want different behaviors (copy to clipboard, open
 * in code-viewer). This module is a tiny mailbox: set the intent before
 * sending the WS message, consume it in the response handler.
 */

type Intent = 'copy' | 'view';

let pending: Intent | null = null;

export const threadLinkIntent = {
  set(intent: Intent): void {
    pending = intent;
  },

  consume(): Intent {
    const p = pending;
    pending = null;
    return p ?? 'copy';
  },
};
