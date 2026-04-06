/**
 * Code Transform — HTML escaping, code block wrapping, syntax highlighting.
 *
 * Every code→HTML conversion in the app goes through here.
 * Inline code, fenced blocks, tool output, file explorer — all use these.
 */

import hljs from 'highlight.js';
import { highlightWithFrontmatter } from './frontmatter';

/**
 * Escape HTML special characters for safe insertion into HTML.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Wrap code content in a styled pre/code block.
 * Used by: write/edit tool segments, file explorer code view.
 */
export function codeBlockHtml(content: string, language?: string): string {
  if (!content) return '';
  const langClass = language ? ` class="language-${language}"` : '';
  return `<pre style="margin:0;overflow-x:auto"><code${langClass}>${escapeHtml(content)}</code></pre>`;
}

/**
 * Wrap content in a pre block with pre-wrap (for plain text that preserves whitespace).
 * Used by: shell output, line-stream tool segments.
 */
export function preWrapHtml(content: string): string {
  if (!content) return '';
  return `<pre style="margin:0;white-space:pre-wrap">${escapeHtml(content)}</pre>`;
}

// Map file extensions to highlight.js language names where they differ
const LANG_MAP: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'bash',
  css: 'css',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  xml: 'xml',
  html: 'html',
  htm: 'html',
  h: 'c',
  cpp: 'cpp',
  md: 'markdown',
};

/**
 * Split highlighted HTML into lines that are safe to render individually.
 * highlight.js can produce <span> tags that wrap across newlines.
 * This closes open spans at each line break and reopens them on the next line.
 */
function splitHighlightedLines(html: string): string[] {
  const rawLines = html.split('\n');
  const result: string[] = [];
  let openSpans: string[] = [];

  for (const raw of rawLines) {
    // Prepend any spans still open from the previous line
    const line = openSpans.join('') + raw;

    // Track span opens and closes on the RAW line only (not the reopened prefixes)
    const opens = raw.match(/<span [^>]*>/g) || [];
    const closes = raw.match(/<\/span>/g) || [];

    // Rebuild: start from carried-over spans, apply this line's opens/closes
    const stack = [...openSpans];
    for (const tag of opens) stack.push(tag);
    for (let i = 0; i < closes.length; i++) stack.pop();

    // Close any still-open spans at end of this line
    const closeTags = '</span>'.repeat(stack.length);
    result.push(line + closeTags);

    openSpans = stack;
  }

  return result;
}

/**
 * Syntax-highlight code and return HTML string.
 * Falls back to escapeHtml if the language isn't recognized.
 */
export function highlightCode(content: string, extension?: string): string {
  if (!content) return '';
  const lang = extension ? LANG_MAP[extension] : undefined;
  if (!lang) return escapeHtml(content);
  try {
    // Markdown files get frontmatter-aware highlighting (separate module)
    if (lang === 'markdown') {
      return splitHighlightedLines(highlightWithFrontmatter(content)).join('\n');
    }
    const html = hljs.highlight(content, { language: lang }).value;
    return splitHighlightedLines(html).join('\n');
  } catch {
    return escapeHtml(content);
  }
}
