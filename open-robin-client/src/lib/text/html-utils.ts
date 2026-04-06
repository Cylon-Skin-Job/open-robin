/**
 * HTML Utilities — truncation and character counting for progressive reveal.
 *
 * Used by text renderers to type characters into pre-parsed HTML structure
 * without re-parsing markdown on every keystroke.
 */

const SELF_CLOSING = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'col', 'area', 'wbr']);

/**
 * Truncate an HTML string to show only `maxChars` visible text characters.
 * Preserves tag structure — open tags are properly closed.
 */
export function truncateHtmlToChars(html: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  if (!html) return '';

  let visibleCount = 0;
  let i = 0;
  const openTags: string[] = [];

  while (i < html.length && visibleCount < maxChars) {
    if (html[i] === '<') {
      const closeIdx = html.indexOf('>', i);
      if (closeIdx === -1) break;

      const tagStr = html.slice(i + 1, closeIdx).trim();
      const isClosing = tagStr.startsWith('/');
      const isSelfClosing = tagStr.endsWith('/') || SELF_CLOSING.has((tagStr.match(/^\/?\s*(\w+)/) || [])[1]?.toLowerCase() || '');

      if (isClosing) {
        const tagName = (tagStr.match(/^\/\s*(\w+)/) || [])[1]?.toLowerCase();
        const lastIdx = openTags.lastIndexOf(tagName || '');
        if (lastIdx >= 0) openTags.splice(lastIdx, 1);
      } else if (!isSelfClosing) {
        const tagName = (tagStr.match(/^(\w+)/) || [])[1]?.toLowerCase();
        if (tagName) openTags.push(tagName);
      }

      i = closeIdx + 1;
    } else if (html[i] === '&') {
      const semiIdx = html.indexOf(';', i);
      if (semiIdx !== -1 && semiIdx - i < 12) {
        visibleCount++;
        i = semiIdx + 1;
      } else {
        visibleCount++;
        i++;
      }
    } else {
      visibleCount++;
      i++;
    }
  }

  let result = html.slice(0, i);
  for (let t = openTags.length - 1; t >= 0; t--) {
    result += `</${openTags[t]}>`;
  }

  return result;
}

/**
 * Count visible text characters in an HTML string.
 */
export function getVisibleTextLength(html: string): number {
  if (!html) return 0;
  let count = 0;
  let i = 0;

  while (i < html.length) {
    if (html[i] === '<') {
      const closeIdx = html.indexOf('>', i);
      if (closeIdx === -1) break;
      i = closeIdx + 1;
    } else if (html[i] === '&') {
      const semiIdx = html.indexOf(';', i);
      if (semiIdx !== -1 && semiIdx - i < 12) {
        count++;
        i = semiIdx + 1;
      } else {
        count++;
        i++;
      }
    } else {
      count++;
      i++;
    }
  }

  return count;
}
