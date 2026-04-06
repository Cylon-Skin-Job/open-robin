/**
 * think — Plain text paragraphs, italic gray.
 *
 * Visually distinct from main assistant text.
 * No markdown parsing. Preserves indentation and line breaks.
 */

import { escapeHtml } from '../transforms';
import type { ToolRenderer } from './types';

export const thinkRenderer: ToolRenderer = {
  grouped: false,
  buildTitle: () => 'Thinking',
  contentStyle: {
    whiteSpace: 'pre-wrap',
    fontFamily: 'inherit',
    fontStyle: 'italic',
    color: 'var(--text-dim)',
  },
  showCursor: true,
  formatContent: (content) => escapeHtml(content),
};
