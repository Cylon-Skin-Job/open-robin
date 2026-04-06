/**
 * web_search — URL list (grouped).
 *
 * Content has summary lines (queries or URLs).
 */

import { escapeHtml } from '../transforms';
import type { ToolRenderer } from './types';

export const webSearchRenderer: ToolRenderer = {
  grouped: true,

  buildTitle: (n) => n === 1 ? 'Web Search' : `Web Search (${n})`,

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
    return lines.map(line => {
      const truncated = line.length > 80 ? line.slice(0, 77) + '...' : line;
      return `<div style="color:var(--text-dim);padding:1px 0">${escapeHtml(truncated)}</div>`;
    }).join('');
  },

  shouldConsumeNext: (nextType) => nextType === 'web_search',
};
