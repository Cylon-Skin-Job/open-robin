/**
 * write — Code block (singular).
 *
 * Full code display. Language detected from file path.
 * Future: syntax highlighting via Prism/Shiki.
 */

import { escapeHtml } from '../transforms';
import type { ToolRenderer } from './types';

function filenameFromPath(filePath?: string): string {
  if (!filePath) return 'file';
  const parts = filePath.split('/');
  return parts[parts.length - 1];
}

export const writeRenderer: ToolRenderer = {
  grouped: false,

  buildTitle: (_, args) => {
    const name = filenameFromPath(args?.file_path as string | undefined);
    return `Write ${name}`;
  },

  contentStyle: {
    whiteSpace: 'pre-wrap',
    fontFamily: 'monospace',
    fontStyle: 'normal',
    fontSize: '13px',
  },

  showCursor: true,
  formatContent: (content) => escapeHtml(content),
};
