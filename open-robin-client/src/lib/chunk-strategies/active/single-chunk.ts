/**
 * Single Chunk Strategy — Hold all content until tool result arrives.
 *
 * Used by: shell, read, write, edit, grep, glob, web_search, fetch.
 *
 * Accumulates streaming content internally. next() returns null until
 * onResult() is called, then emits one complete TaggedChunk.
 * flush() is the timeout fallback — emits what we have without result.
 */

import type { TaggedChunk, ChunkBlockType } from '../../../types/tagged-chunk';
import type { ActiveChunkStrategy } from '../../../types/active-strategy';

export function createSingleChunkStrategy(
  parent: string,
  blockType: ChunkBlockType,
  lang?: string,
): ActiveChunkStrategy {
  let accumulated = '';
  let result: string | undefined;
  let resultReceived = false;
  let emitted = false;

  return {
    onContent(data: string) {
      accumulated += data;
    },

    onResult(res: string) {
      result = res;
      resultReceived = true;
    },

    next(): TaggedChunk | null {
      if (emitted) return null;
      if (!resultReceived) return null;

      emitted = true;
      return {
        content: accumulated,
        block: blockType,
        parent,
        lang,
        position: 'complete',
        result,
      };
    },

    flush(): TaggedChunk[] {
      if (emitted || !accumulated) return [];
      emitted = true;
      return [{
        content: accumulated,
        block: blockType,
        parent,
        lang,
        position: 'complete',
        result,
      }];
    },
  };
}
