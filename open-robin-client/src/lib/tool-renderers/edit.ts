/**
 * edit — Diff view (singular).
 *
 * Red/green per-line coloring showing what changed.
 * Extracted from the inline DiffContent in LiveSegmentRenderer.
 */

import { escapeHtml } from '../transforms';
import type { ToolRenderer } from './types';

function filenameFromPath(filePath?: string): string {
  if (!filePath) return 'file';
  const parts = filePath.split('/');
  return parts[parts.length - 1];
}

function formatDiffLines(content: string): string {
  if (!content) return '';
  return content.split('\n').map(line => {
    let style = '';
    if (line.startsWith('+')) {
      style = 'color:#4ade80;background:rgba(74,222,128,0.08)';
    } else if (line.startsWith('-')) {
      style = 'color:#f87171;background:rgba(248,113,113,0.08)';
    }
    return `<div style="${style}">${escapeHtml(line)}</div>`;
  }).join('');
}

export const editRenderer: ToolRenderer = {
  grouped: false,

  buildTitle: (_, args) => {
    const name = filenameFromPath(args?.file_path as string | undefined);
    return `Edit ${name}`;
  },

  contentStyle: {
    whiteSpace: 'pre-wrap',
    fontFamily: 'monospace',
    fontStyle: 'normal',
    fontSize: '13px',
  },

  showCursor: true,
  formatContent: (content) => formatDiffLines(content),
};
