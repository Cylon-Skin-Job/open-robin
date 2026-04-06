/**
 * Markdown Transform — single configured marked instance.
 *
 * Every markdown→HTML conversion in the app goes through here.
 * Configure once, render uniformly everywhere.
 */

import { marked } from 'marked';

// Configure marked defaults
marked.setOptions({
  gfm: true,
  breaks: true,
});

/**
 * Convert markdown string to HTML.
 * Used by: text segments, wiki pages, instant renderer, document tiles.
 */
export function markdownToHtml(content: string): string {
  if (!content) return '';
  return marked.parse(content) as string;
}
