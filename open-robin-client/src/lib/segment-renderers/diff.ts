/**
 * Diff renderer — red/green line diff view for edit segments.
 */

import { escapeHtml } from '../transforms';
import type { SegmentContentRenderer } from './types';

function classifyLine(line: string): 'add' | 'remove' | 'context' {
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'remove';
  return 'context';
}

function colorForClass(cls: 'add' | 'remove' | 'context'): string {
  switch (cls) {
    case 'add': return 'color:#4ade80;background:rgba(74,222,128,0.08)';
    case 'remove': return 'color:#f87171;background:rgba(248,113,113,0.08)';
    default: return '';
  }
}

export const diffRenderer: SegmentContentRenderer = {
  parseChunks(content: string): string[] {
    if (!content) return [];
    const lines = content.split('\n');
    const chunks: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = i < lines.length - 1 ? lines[i] + '\n' : lines[i];
      if (line) chunks.push(line);
    }
    return chunks;
  },

  renderInstant(content: string): string {
    if (!content) return '';
    const lines = content.split('\n');
    const html = lines.map(line => {
      const cls = classifyLine(line);
      const style = colorForClass(cls);
      return `<div style="font-family:monospace;font-size:13px;${style}">${escapeHtml(line)}</div>`;
    }).join('');
    return `<div style="margin:0">${html}</div>`;
  },
};
