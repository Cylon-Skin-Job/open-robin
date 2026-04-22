/**
 * @module secondary-tracker
 * @role Track threadIds for which the client has sent a thread:open-assistant
 *       tagged as "for the secondary popup", so the thread:opened response
 *       handler can distinguish secondary-intent responses from primary-intent
 *       responses even when the secondary popup has already been closed.
 *
 * Why this exists: openSecondary() fires a WS message and sets
 * secondary.threadId locally. The server responds asynchronously with
 * thread:opened. If the user clicks the red button before that response
 * arrives, secondary is already null, and the thread-handlers branch that
 * checks `store.secondary?.threadId === msg.threadId` fails — the response
 * then falls through to the primary-thread code path and hijacks the
 * primary. This tracker keeps a short-lived claim on the threadId so the
 * handler knows the response was for a (now-closed) secondary.
 */

const pending = new Set<string>();

export const secondaryTracker = {
  /** Called from openSecondary just before the WS send. */
  mark(threadId: string): void {
    pending.add(threadId);
  },

  /** Called from the thread:opened handler after consuming the entry. */
  unmark(threadId: string): void {
    pending.delete(threadId);
  },

  /** Called from the thread:opened handler to decide routing. */
  has(threadId: string): boolean {
    return pending.has(threadId);
  },

  /** Called from closeSecondary so a late thread:opened for this id
   *  still routes to the secondary slot rather than hijacking primary. */
  markForClose(threadId: string): void {
    pending.add(threadId);
  },
};
