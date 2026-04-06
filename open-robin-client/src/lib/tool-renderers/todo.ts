/**
 * todo — Task list (singular).
 *
 * Line-by-line streaming.
 */

import { escapeHtml } from '../transforms';
import type { ToolRenderer } from './types';

export const todoRenderer: ToolRenderer = {
  grouped: false,
  buildTitle: () => 'Todo',
  contentStyle: {
    whiteSpace: 'pre-wrap',
    fontFamily: 'inherit',
    fontStyle: 'normal',
  },
  showCursor: true,
  formatContent: (content) => escapeHtml(content),
};
