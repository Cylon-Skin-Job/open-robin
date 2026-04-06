/**
 * Line-stream renderer — line-break chunked typing for think, shell, grep output.
 */

import { preWrapHtml } from '../transforms';
import type { SegmentContentRenderer } from './types';

export const lineStreamRenderer: SegmentContentRenderer = {
  parseChunks(content: string): string[] {
    if (!content) return [];
    const lines = content.split('\n');
    const chunks: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = i < lines.length - 1 ? lines[i] + '\n' : lines[i];
      if (line) chunks.push(line);
    }
    return chunks;
  },

  renderInstant(content: string): string {
    return preWrapHtml(content);
  },
};
