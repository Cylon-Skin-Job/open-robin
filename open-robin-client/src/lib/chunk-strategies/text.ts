/**
 * Text chunk strategy.
 *
 * No tool container — first complete paragraph is chunk 0.
 * Code fences count as lookahead when complete.
 * Paragraphs, headers, lists, code fences are all items.
 */

import type { ChunkStrategy } from './types';

export const textStrategy: ChunkStrategy = {
  mode: 'paragraph',
  codeFenceAsLookahead: true,
  tagAsFirstChunk: false,
};
