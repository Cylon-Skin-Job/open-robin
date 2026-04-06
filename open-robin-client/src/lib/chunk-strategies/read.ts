/**
 * Read chunk strategy (also used by glob, grep, web_search, fetch).
 *
 * Each consecutive tool call is one item. For grouped tools that
 * collapse multiple calls into one block, each call + its closing
 * tag is a discrete speed-relevant unit.
 */

import type { ChunkStrategy } from './types';

export const readStrategy: ChunkStrategy = {
  mode: 'per-call',
  tagAsFirstChunk: true,
};
