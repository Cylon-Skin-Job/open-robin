/**
 * Shell chunk strategy.
 *
 * Lines grouped in batches of 5 for speed decisions.
 * Prevents 20 buffered lines from reading as "way ahead"
 * when it's really just a burst of terminal output.
 * If fewer than 5 lines remain at segment close, they're one item.
 */

import type { ChunkStrategy } from './types';

export const shellStrategy: ChunkStrategy = {
  mode: 'line-group',
  linesPerGroup: 5,
  tagAsFirstChunk: true,
};
