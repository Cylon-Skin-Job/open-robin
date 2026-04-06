/**
 * Line-Break Chunk Parser
 *
 * Used by: think, shell, subagent, todo
 *
 * Boundary: newline character (\n)
 *
 * Each complete line (ending in \n) becomes a chunk.
 * Incomplete trailing content (no \n yet) is held back
 * until the next \n arrives, the segment completes, or
 * flush() is called by the orchestrator after a timeout.
 *
 * No transformation — content is plain text, rendered as-is.
 */

import type { ChunkParser, ParsedChunk } from '../types';

export function createLineBreakParser(): ChunkParser {
  // Track where we left off scanning for line breaks
  let scanCursor = 0;

  return {
    feed(content: string, _prevLength: number): ParsedChunk[] {
      const chunks: ParsedChunk[] = [];

      // Scan from where we left off for new line breaks
      while (scanCursor < content.length) {
        const nlIndex = content.indexOf('\n', scanCursor);

        if (nlIndex === -1) {
          // No more line breaks — hold the rest as incomplete
          break;
        }

        // Found a line break — everything from scanCursor to nlIndex+1 is a chunk
        const line = content.slice(scanCursor, nlIndex + 1);
        chunks.push({ text: line });
        scanCursor = nlIndex + 1;
      }

      return chunks;
    },

    /**
     * Release any held-back partial content (no trailing \n).
     * Called by the orchestrator when content has stalled too long.
     */
    flush(content: string): ParsedChunk[] {
      if (scanCursor >= content.length) return [];
      const partial = content.slice(scanCursor);
      if (partial.length === 0) return [];
      scanCursor = content.length;
      return [{ text: partial }];
    },
  };
}
