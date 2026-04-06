/**
 * Code renderer — code block for write segments.
 */

import { codeBlockHtml } from '../transforms';
import type { SegmentContentRenderer } from './types';

export const codeRenderer: SegmentContentRenderer = {
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
    return codeBlockHtml(content);
  },
};
