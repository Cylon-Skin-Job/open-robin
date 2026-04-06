/**
 * Grouped-Summary Reveal — show content as it arrives, no typing.
 *
 * Used by: read, glob, grep, web_search, fetch
 *
 * These are filenames/patterns/URLs that appear as lines.
 * No character-by-character typing — content shows instantly.
 *
 * For HISTORY (completeRef already true): shows content once. Instant.
 * For LIVE (content arrives progressively): polls contentRef and
 * updates the display as new lines appear. Exits when complete.
 *
 * This handles the wire-level grouping: ws-client pushes the segment
 * with content: '' on tool_call, then appends summary lines on each
 * tool_result. The reveal watches for those updates.
 */

import type { RevealController } from './types';

const POLL_INTERVAL = 50; // ms between content checks during live streaming

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export const groupedSummaryReveal: RevealController = {
  async run(contentRef, setDisplayed, cancelRef, completeRef, _options?) {
    // Show whatever we have immediately
    setDisplayed(contentRef.current);

    // If already complete (history replay), we're done
    if (completeRef.current) return;

    // Live: poll for content updates until segment is complete.
    // Each poll shows the latest content — new file paths appear
    // as lines the moment tool_result messages arrive.
    let lastLen = contentRef.current.length;
    while (!completeRef.current && !cancelRef.current) {
      await sleep(POLL_INTERVAL);
      const current = contentRef.current;
      if (current.length !== lastLen) {
        setDisplayed(current);
        lastLen = current.length;
      }
    }

    // Final update with complete content
    if (!cancelRef.current) {
      setDisplayed(contentRef.current);
    }
  },
};
