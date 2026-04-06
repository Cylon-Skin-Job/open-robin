/**
 * shell — Monospace line stream. Like a terminal.
 *
 * Preserves exact formatting. No syntax highlighting.
 */

import { escapeHtml } from '../transforms';
import type { ToolRenderer } from './types';

export const shellRenderer: ToolRenderer = {
  grouped: false,
  buildTitle: () => 'Shell',
  contentStyle: {
    whiteSpace: 'pre-wrap',
    fontFamily: 'monospace',
    fontStyle: 'normal',
    fontSize: '13px',
  },
  showCursor: true,
  formatContent: (content) => escapeHtml(content),
};
