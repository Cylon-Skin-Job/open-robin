/**
 * Line Chunk Strategy — Emit one chunk per complete line.
 *
 * Used by: think, subagent, todo.
 *
 * Splits on newline boundaries. Each line becomes a TaggedChunk
 * with the parent's block type. Trailing content without a newline
 * is held until the next newline or flush().
 */

import type { TaggedChunk, ChunkBlockType } from '../../../types/tagged-chunk';
import type { ActiveChunkStrategy } from '../../../types/active-strategy';

export function createLineChunkStrategy(
  parent: string,
  blockType: ChunkBlockType,
): ActiveChunkStrategy {
  let buffer = '';
  const ready: TaggedChunk[] = [];

  function scanLines() {
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIdx + 1);
      buffer = buffer.slice(newlineIdx + 1);
      ready.push({
        content: line,
        block: blockType,
        parent,
        position: 'complete',
      });
    }
  }

  return {
    onContent(data: string) {
      buffer += data;
      scanLines();
    },

    onResult() {
      // Line strategies don't hold for results.
      // If there's trailing content, emit it.
      if (buffer) {
        ready.push({
          content: buffer,
          block: blockType,
          parent,
          position: 'complete',
        });
        buffer = '';
      }
    },

    next(): TaggedChunk | null {
      return ready.length > 0 ? ready.shift()! : null;
    },

    flush(): TaggedChunk[] {
      const chunks: TaggedChunk[] = [...ready];
      ready.length = 0;
      if (buffer) {
        chunks.push({
          content: buffer,
          block: blockType,
          parent,
          position: 'complete',
        });
        buffer = '';
      }
      return chunks;
    },
  };
}
