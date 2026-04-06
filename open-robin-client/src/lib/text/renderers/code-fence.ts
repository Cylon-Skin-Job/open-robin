/**
 * Code Fence Renderer — ``` fenced code blocks.
 *
 * Matches lines starting with ```.
 * Boundary: the closing ``` line.
 * The entire block (open fence → content → close fence) is one chunk.
 */

import { markdownToHtml } from '../../transforms';
import type { TextSubRenderer } from './types';

export const codeFenceRenderer: TextSubRenderer = {
  matches(content: string, fromIndex: number): boolean {
    return content.slice(fromIndex).startsWith('```');
  },

  findBoundary(content: string, fromIndex: number): number {
    // Find the end of the opening ``` line
    const firstNl = content.indexOf('\n', fromIndex);
    if (firstNl === -1) return fromIndex; // opening line not complete

    // Search for closing ```
    let searchFrom = firstNl + 1;
    while (searchFrom < content.length) {
      const nlIdx = content.indexOf('\n', searchFrom);
      const lineEnd = nlIdx === -1 ? content.length : nlIdx;
      const line = content.slice(searchFrom, lineEnd).trim();

      if (line === '```') {
        // Include the closing ``` and its newline
        return nlIdx === -1 ? content.length : nlIdx + 1;
      }

      if (nlIdx === -1) break;
      searchFrom = nlIdx + 1;
    }

    return fromIndex; // closing fence not found yet — wait for more tokens
  },

  toHtml(content: string): string {
    if (!content) return '';
    return markdownToHtml(content);
  },
};
