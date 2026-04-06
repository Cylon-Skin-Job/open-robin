/**
 * List Renderer — bullet lists (- *) and numbered lists (1.).
 *
 * Matches lines starting with `- `, `* `, or `N. `.
 * Boundary: next line that isn't a list item or continuation indent.
 */

import { markdownToHtml } from '../../transforms';
import type { TextSubRenderer } from './types';

const LIST_PATTERN = /^[-*]\s|^\d+\.\s/;

export const listRenderer: TextSubRenderer = {
  matches(content: string, fromIndex: number): boolean {
    return LIST_PATTERN.test(content.slice(fromIndex));
  },

  findBoundary(content: string, fromIndex: number): number {
    let searchFrom = fromIndex;

    while (searchFrom < content.length) {
      const nlIdx = content.indexOf('\n', searchFrom);
      if (nlIdx === -1) return fromIndex; // current line not complete

      const nextLineStart = nlIdx + 1;
      if (nextLineStart >= content.length) return fromIndex; // wait for more

      const nextLine = content.slice(nextLineStart);

      // Continue if next line is another list item or indented continuation
      const isContinuation =
        LIST_PATTERN.test(nextLine) ||
        /^\s+\S/.test(nextLine);

      if (!isContinuation) {
        // Next line breaks the list — boundary is here
        return nextLineStart;
      }

      searchFrom = nextLineStart;
    }

    return fromIndex; // list not complete yet
  },

  toHtml(content: string): string {
    if (!content) return '';
    return markdownToHtml(content);
  },
};
