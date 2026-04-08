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
 *
 * Defensively coerces Node Buffer-shaped objects ({type:"Buffer",data:[...]})
 * to strings. These can leak in from the WebSocket when the server reads a
 * SQLite BLOB column and ships it without casting to text. marked.parse
 * throws on non-string input and the unhandled error unmounts the React tree.
 */
export function markdownToHtml(content: unknown): string {
  if (!content) return '';

  // Coerce Buffer-shaped wire objects to a UTF-8 string
  if (typeof content === 'object' && content !== null) {
    const obj = content as { type?: string; data?: number[] };
    if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
      try {
        content = new TextDecoder('utf-8').decode(new Uint8Array(obj.data));
      } catch {
        return '';
      }
    }
  }

  if (typeof content !== 'string') return '';
  return marked.parse(content) as string;
}
