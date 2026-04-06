/**
 * grep — Search results (grouped).
 *
 * Same wire-level grouping. Content has summary lines (paths or matches).
 */

import { escapeHtml } from '../transforms';
import { truncatePath } from './shared/path-truncate';
import type { ToolRenderer } from './types';

export const grepRenderer: ToolRenderer = {
  grouped: true,

  buildTitle: (n) => n === 1 ? 'Grep' : `Grep (${n} results)`,

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

  shouldConsumeNext: (nextType) => nextType === 'grep',
};
