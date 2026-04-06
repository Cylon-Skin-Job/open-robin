/**
 * glob — File/folder list (grouped).
 *
 * Same wire-level grouping as read. Content has summary lines.
 */

import { escapeHtml } from '../transforms';
import { truncatePath } from './shared/path-truncate';
import type { ToolRenderer } from './types';

export const globRenderer: ToolRenderer = {
  grouped: true,

  buildTitle: (n) => n === 1 ? 'Glob' : `Glob (${n} results)`,

  contentStyle: {
    whiteSpace: 'pre-wrap',
    fontFamily: 'monospace',
    fontStyle: 'normal',
    fontSize: '13px',
  },

  showCursor: false,

  formatContent: (content, _args) => {
    if (!content) return '';
    const lines = content.split('\n').filter(l => l.trim());
    return lines.map(line =>
      `<div style="color:var(--text-dim);padding:1px 0">${escapeHtml(truncatePath(line))}</div>`
    ).join('');
  },

  shouldConsumeNext: (nextType) => nextType === 'glob',
};
