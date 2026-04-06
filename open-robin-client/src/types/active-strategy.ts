/**
 * Active Chunk Strategy — Stateful chunking interface for the pipeline.
 *
 * Each segment gets its own strategy instance. The strategy accumulates
 * content as it streams in, and emits tagged chunks when ready.
 *
 * For tool types with awaitsResult=true, next() returns null until
 * onResult() is called — the strategy holds until the tool confirms completion.
 */

import type { TaggedChunk } from './tagged-chunk';

export interface ActiveChunkStrategy {
  /** Feed new streaming content. Called as wire data arrives. */
  onContent(data: string): void;

  /** Signal that the tool result has arrived. For awaitsResult strategies, this releases held chunks. */
  onResult(result: string): void;

  /** Pop the next ready chunk. Returns null if still accumulating / waiting for result. */
  next(): TaggedChunk | null;

  /** Force-emit everything held (timeout fallback, cancel). Returns all remaining chunks. */
  flush(): TaggedChunk[];
}
