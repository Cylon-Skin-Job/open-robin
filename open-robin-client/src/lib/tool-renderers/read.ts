/**
 * read — File list (grouped).
 *
 * At the wire level, consecutive reads are grouped into ONE segment
 * by ws-client. The segment's content contains summary lines (one
 * file path per line). toolArgs only has the first file's args.
 *
 * formatContent renders the CONTENT (summary lines), not the args.
 */

import { escapeHtml } from '../transforms';
import { truncatePath } from './shared/path-truncate';
import type { ToolRenderer } from './types';

export const readRenderer: ToolRenderer = {
  grouped: true,

  buildTitle: (n) => n === 1 ? 'Read' : `Read (${n} files)`,

  contentStyle: {
    whiteSpace: 'pre-wrap',
    fontFamily: 'monospace',
    fontStyle: 'normal',
    fontSize: '13px',
  },

  showCursor: false,

  formatContent: (content, _args) => {
    if (!content) return '';
    // Content is summary lines from ws-client (one file path per line)
    const lines = content.split('\n').filter(l => l.trim());
    return lines.map(line =>
      `<div style="color:var(--text-dim);padding:1px 0">${escapeHtml(truncatePath(line))}</div>`
    ).join('');
  },

  shouldConsumeNext: (nextType) => nextType === 'read',
};
