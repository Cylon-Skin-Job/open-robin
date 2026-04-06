/**
 * Line chunk strategy (subagent, todo).
 *
 * Each line is one item. Simple line-by-line output
 * where every newline is a speed boundary.
 */

import type { ChunkStrategy } from './types';

export const lineStrategy: ChunkStrategy = {
  mode: 'line',
  tagAsFirstChunk: true,
};
