/**
 * Think chunk strategy.
 *
 * The thinking tag/container is chunk 0.
 * Content decomposes into paragraphs — same as text internally.
 * First complete paragraph + tag = 2 chunks.
 */

import type { ChunkStrategy } from './types';

export const thinkStrategy: ChunkStrategy = {
  mode: 'paragraph',
  codeFenceAsLookahead: true,
  tagAsFirstChunk: true,
};
