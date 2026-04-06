/**
 * Speed Attenuator — pure speed decision logic for chunk-level pacing.
 *
 * Separated from the chunk buffer (which is just a FIFO queue) so that
 * speed logic can be reasoned about, tested, and extended independently
 * of queue mechanics.
 *
 * The attenuator answers one question: given the state of the queue,
 * should we type FAST or SLOW?
 *
 * FAST: 1ms per char, 5+ chars per tick. The stream is ahead of us.
 * SLOW: 6ms per char, 1 char per tick. We're keeping pace or waiting.
 *
 * The decision is based on GENUINE lookahead — how many complete,
 * boundary-terminated, non-decoration chunks are queued ahead of
 * the current cursor position.
 *
 * Three things that are NOT evidence we're ahead:
 *   1. Code blocks (isCodeBlock) — decoration, same thought as preceding text
 *   2. Partial chunks (isPartial) — still streaming, no boundary yet
 *   3. Pending held-back content (hasPendingBlock) — e.g., incomplete code fence
 *
 * FAST only fires when there are 2+ genuine chunks ahead. Everything
 * else → SLOW. This prevents the "blaze through paragraph, stutter at
 * code fence, stutter at next paragraph" pattern.
 *
 * USAGE:
 *   The chunk buffer delegates to this module:
 *     buffer.getSpeed() → computeSpeed(chunks, cursor, pendingBlock)
 *
 *   Future tool-specific queues can use the same function with their
 *   own chunk metadata. The attenuator doesn't know what a "paragraph"
 *   or "code fence" is — it only reads the flags.
 */

export const SPEED_FAST = 1;  // ms per char
export const SPEED_SLOW = 6;  // ms per char

/** Minimum metadata the attenuator needs per queued item. */
export interface QueueItem {
  /** Code fence chunk — counted or skipped based on strategy. */
  isCodeBlock?: boolean;
  /** Still streaming, no boundary — never counts as lookahead. */
  isPartial?: boolean;
}

/** Options that customize the attenuator per tool type. */
export interface AttenuatorOptions {
  /** Do complete code fences count as lookahead? Default true. */
  codeFenceAsLookahead?: boolean;
}

/** How many genuine complete chunks ahead before we go FAST. */
const FAST_THRESHOLD = 2;

/**
 * Compute the speed decision for the current queue state.
 *
 * Generic — works for any tool type. The chunk strategy defines
 * what items are in the queue. The attenuator just counts them.
 *
 * @param items   — The full queue array (consumed + upcoming).
 * @param cursor  — Index of the next item to consume.
 * @param hasPendingBlock — Content held back entirely (e.g., incomplete code fence).
 * @param options — Per-tool customization from the chunk strategy.
 * @returns 'fast' or 'slow'
 */
export function computeSpeed(
  items: ReadonlyArray<QueueItem>,
  cursor: number,
  hasPendingBlock: boolean,
  options?: AttenuatorOptions,
): 'fast' | 'slow' {
  // Pending block = content exists but isn't in the queue yet.
  // We're not ahead — we're waiting for it.
  if (hasPendingBlock) return 'slow';

  const codeFenceCounts = options?.codeFenceAsLookahead ?? true;

  // Count genuine, complete items ahead of cursor.
  let ahead = 0;
  for (let i = cursor + 1; i < items.length; i++) {
    if (items[i].isPartial) continue;
    if (items[i].isCodeBlock && !codeFenceCounts) continue;
    ahead++;
    if (ahead >= FAST_THRESHOLD) return 'fast';
  }

  return 'slow';
}

/**
 * Convert a speed decision to milliseconds per character.
 */
export function speedToMs(speed: 'fast' | 'slow'): number {
  return speed === 'fast' ? SPEED_FAST : SPEED_SLOW;
}
