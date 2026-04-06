/**
 * Grouped-summary renderer — extract summaryField per tool call.
 * Shows key identifier only (filename, pattern, URL). Click to expand.
 */

import { escapeHtml } from '../transforms';
import type { SegmentContentRenderer } from './types';

export const groupedSummaryRenderer: SegmentContentRenderer = {
  parseChunks(content: string, _toolArgs?: Record<string, unknown>): string[] {
    if (!content) return [];
    return content.split('\n').filter(line => line.trim().length > 0);
  },

  renderInstant(content: string, _toolArgs?: Record<string, unknown>): string {
    if (!content) return '';
    const lines = content.split('\n').filter(l => l.trim());
    const html = lines.map(line =>
      `<div style="font-size:13px;color:var(--text-dim);padding:1px 0">${escapeHtml(line)}</div>`
    ).join('');
    return html;
  },
};
