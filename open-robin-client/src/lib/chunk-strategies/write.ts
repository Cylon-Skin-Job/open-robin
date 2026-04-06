/**
 * Write chunk strategy (also used by edit).
 *
 * Entire content is one atomic item. The file being written or
 * the diff being applied is one unit — don't speed up just because
 * it's long. Future: diffs may decompose into hunks.
 */

import type { ChunkStrategy } from './types';

export const writeStrategy: ChunkStrategy = {
  mode: 'whole',
  tagAsFirstChunk: true,
};
