/**
 * Animation Utilities — shared helpers for typing animations.
 *
 * Used by:
 *   - text-animate.ts (text segment typing loop)
 *   - LiveSegmentRenderer.tsx (tool segment animations)
 *
 * No React. No DOM manipulation. Pure helpers.
 */

/** Cursor block character rendered inline with typed content. */
export const CURSOR_HTML = '<span class="typing-cursor">&#x2588;</span>';

/** Promise-based delay. */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Inject cursor inside the last HTML element.
 * If no closing tags exist (flat escaped text), appends at end.
 * If closing tags exist, injects before the last one so the cursor
 * renders inline with the final content line.
 */
export function injectCursor(html: string): string {
  const lastClose = html.lastIndexOf('</');
  if (lastClose === -1) return html + CURSOR_HTML;
  return html.slice(0, lastClose) + CURSOR_HTML + html.slice(lastClose);
}
