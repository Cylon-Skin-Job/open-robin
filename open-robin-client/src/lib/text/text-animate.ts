/**
 * Text Animation Orchestrator — the typing loop.
 *
 * Pure async function. No React. No DOM.
 * Receives refs + callbacks from the React component.
 *
 * Responsibilities (orchestration only — delegates to specialists):
 *   1. Parse from cursor forward        → parseTextChunks()
 *   2. Buffer blocks for speed tracking  → createChunkBuffer()
 *   3. Decide speed at block boundary    → buffer.getSpeedMs()
 *   4. Type inside pre-rendered HTML     → truncateHtmlToChars()
 *   5. Check pressure at block boundary  → getTimingProfile()
 *
 * Properties:
 *   - Cursor moves forward only. No re-parse of typed content.
 *   - Speed set ONCE per block at the boundary. Static for entire block.
 *   - No bailout paths. No stall detection. No completeRef flush.
 *   - Display state is HTML, not raw markdown.
 */

import { parseTextChunks } from './index';
import { createChunkBuffer } from './chunk-buffer';
import { truncateHtmlToChars, getVisibleTextLength } from './html-utils';
import { textStrategy } from '../chunk-strategies/text';
import { sleep, CURSOR_HTML } from '../animate-utils';
import type { TimingProfile } from '../pressure';

// ── Public Interface ─────────────────────────────────────────────────

export interface AnimateTextOptions {
  /** Reactive ref to the full content string (grows as tokens stream in) */
  contentRef: { current: string };
  /** Reactive ref — true when the segment is done streaming */
  completeRef: { current: boolean };
  /** Set to true to abort the animation */
  cancelRef: { current: boolean };
  /** Segment type (e.g. 'text', 'think') — determines chunk strategy */
  segmentType: string;
  /** Set the displayed HTML. Called on every typing frame. */
  setDisplayedHtml: (html: string) => void;
  /** Set typing state (controls cursor visibility in the component) */
  setTyping: (typing: boolean) => void;
  /** Returns current pressure profile. Called at block boundaries only. */
  getTimingProfile: () => TimingProfile;
  /** Called when the animation is complete (segment done, ready for next) */
  onDone: () => void;
}

// ── The Loop ─────────────────────────────────────────────────────────

export async function animateText(opts: AnimateTextOptions): Promise<void> {
  const {
    contentRef, completeRef, cancelRef,
    setDisplayedHtml, setTyping, getTimingProfile, onDone,
  } = opts;

  // Text strategy metadata determines buffer behavior (code fences as lookahead)
  const buffer = createChunkBuffer({
    codeFenceAsLookahead: textStrategy.codeFenceAsLookahead ?? true,
  });

  let cursor = 0;                // byte position in raw content (only moves forward)
  let accumulatedHtml = '';       // HTML for all fully-typed blocks
  let instantBreak = false;       // set by pressure instantReveal

  while (!cancelRef.current) {
    const content = contentRef.current;
    const isComplete = completeRef.current;

    // ── Parse forward from cursor ──
    // Only looks at content we haven't typed yet.
    // Returns blocks with pre-rendered HTML + how far we consumed.
    const { blocks, consumed } = parseTextChunks(content, cursor, isComplete);

    if (blocks.length === 0) {
      if (isComplete) break;      // nothing left to type, segment done
      await sleep(30);            // wait for more streaming content
      continue;
    }

    // Push to buffer for speed tracking.
    // Buffer only sees metadata (isCodeBlock, isPartial) for lookahead counting.
    // The HTML and content travel with the block, not through the buffer.
    for (const block of blocks) {
      buffer.push({
        content: block.content,
        isCodeBlock: block.isCodeBlock,
        isPartial: block.isPartial,
      });
    }

    // Detect held-back code fence: consumed < content.length means
    // a code fence is waiting for its closing ```.
    buffer.setPendingBlock(consumed < content.length);

    // ── Type each block ──
    let blockIndex = 0;
    while (buffer.hasNext() && !cancelRef.current && !instantBreak) {
      const bufferedChunk = buffer.next();
      if (!bufferedChunk) break;

      const block = blocks[blockIndex++];
      if (!block) break;

      // ── BLOCK BOUNDARY: pressure check ──
      const p = getTimingProfile();
      if (p.instantReveal) {
        instantBreak = true;
        break;
      }

      // ── BLOCK BOUNDARY: speed decision ──
      // Set once. Static for the entire block. No mid-block adjustment.
      const speedMs = buffer.getSpeedMs();
      const batchSize = speedMs <= 1 ? 5 : 1;

      // ── Type inside pre-rendered HTML ──
      const html = block.html;
      const totalChars = getVisibleTextLength(html);

      if (totalChars === 0) {
        // Empty block (e.g. whitespace-only) — accumulate and move on
        accumulatedHtml += html;
        cursor += block.content.length;
        continue;
      }

      let charCount = 0;
      while (charCount < totalChars && !cancelRef.current) {
        charCount = Math.min(charCount + batchSize, totalChars);
        const partial = truncateHtmlToChars(html, charCount);
        setDisplayedHtml(accumulatedHtml + partial + CURSOR_HTML);

        if (charCount < totalChars) {
          await sleep(speedMs);
        }
      }

      // Block fully typed — accumulate and advance cursor
      accumulatedHtml += html;
      cursor += block.content.length;

      // ── BLOCK BOUNDARY: inter-block pause ──
      // Only pause if the buffer is empty (we're caught up).
      // If the next block is already queued, skip the pause — go straight to it.
      if (!buffer.hasNext() && !cancelRef.current) {
        const pause = getTimingProfile().interChunkPause;
        if (pause > 0) await sleep(pause);
      }
    }

    if (instantBreak) break;

    // Update cursor to consumed position (covers any blocks that
    // were parsed but not typed due to cancellation)
    cursor = consumed;
  }

  // ── Finalize ──
  // Show all content as fully rendered HTML. Handles:
  //   - instantReveal (pressure dumped everything)
  //   - Normal completion (all blocks typed)
  //   - Cancellation (show what we have)
  const finalContent = contentRef.current;
  if (finalContent) {
    // Re-render full content to catch any trailing content
    const { blocks: finalBlocks } = parseTextChunks(finalContent, 0, true);
    const finalHtml = finalBlocks.map(b => b.html).join('');
    setDisplayedHtml(finalHtml);
  }

  setTyping(false);

  // Inter-segment pause — pressure-aware gap before next segment
  if (!cancelRef.current) {
    const segPause = getTimingProfile().interSegmentPause;
    if (segPause > 0) await sleep(segPause);
  }

  onDone();
}
