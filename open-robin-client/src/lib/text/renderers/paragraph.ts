/**
 * Paragraph Renderer — default prose text.
 *
 * Matches any content that isn't a header, code fence, or list.
 * Boundary: next `\n\n` (paragraph break) or start of a structural element.
 */

import { markdownToHtml } from '../../transforms';
import { formattingIsBalanced } from '../chunk-boundary';
import type { TextSubRenderer } from './types';

export const paragraphRenderer: TextSubRenderer = {
  matches(_content: string, fromIndex: number): boolean {
    // Paragraph is the fallback — matches when nothing else does
    return fromIndex < _content.length;
  },

  findBoundary(content: string, fromIndex: number): number {
    if (fromIndex >= content.length) return fromIndex;

    const region = content.slice(fromIndex);

    // Look for paragraph break or structural element start
    let searchFrom = 0;
    while (searchFrom < region.length) {
      const nlIdx = region.indexOf('\n', searchFrom);
      if (nlIdx === -1) break;

      // Paragraph break
      if (nlIdx + 1 < region.length && region[nlIdx + 1] === '\n') {
        const candidate = fromIndex + nlIdx + 2;
        if (formattingIsBalanced(content.slice(fromIndex, candidate))) {
          return candidate;
        }
      }

      // Structural element after newline
      if (nlIdx + 1 < region.length) {
        const rest = region.slice(nlIdx + 1);
        const isStructural =
          /^#{1,6}\s/.test(rest) ||
          /^[-*]\s/.test(rest) ||
          /^\d+\.\s/.test(rest) ||
          /^```/.test(rest);

        if (isStructural) {
          const candidate = fromIndex + nlIdx + 1;
          if (formattingIsBalanced(content.slice(fromIndex, candidate))) {
            return candidate;
          }
        }
      }

      searchFrom = nlIdx + 1;
    }

    return fromIndex; // no boundary yet
  },

  toHtml(content: string): string {
    if (!content) return '';
    return markdownToHtml(content);
  },
};
