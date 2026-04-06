/**
 * Header Renderer — # through ###### headings.
 *
 * Matches lines starting with 1-6 `#` followed by a space.
 * Boundary: the next `\n` after the header text.
 */

import { markdownToHtml } from '../../transforms';
import type { TextSubRenderer } from './types';

const HEADER_PATTERN = /^#{1,6}\s/;

export const headerRenderer: TextSubRenderer = {
  matches(content: string, fromIndex: number): boolean {
    return HEADER_PATTERN.test(content.slice(fromIndex));
  },

  findBoundary(content: string, fromIndex: number): number {
    const nlIdx = content.indexOf('\n', fromIndex);
    if (nlIdx === -1) return fromIndex; // header not complete yet
    return nlIdx + 1;
  },

  toHtml(content: string): string {
    if (!content) return '';
    return markdownToHtml(content);
  },
};
