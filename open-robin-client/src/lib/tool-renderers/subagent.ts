/**
 * subagent — Agent output (singular).
 *
 * Line-by-line streaming, similar to thinking but not italic.
 */

import { escapeHtml } from '../transforms';
import type { ToolRenderer } from './types';

export const subagentRenderer: ToolRenderer = {
  grouped: false,
  buildTitle: () => 'Subagent',
  contentStyle: {
    whiteSpace: 'pre-wrap',
    fontFamily: 'inherit',
    fontStyle: 'normal',
  },
  showCursor: true,
  formatContent: (content) => escapeHtml(content),
};
