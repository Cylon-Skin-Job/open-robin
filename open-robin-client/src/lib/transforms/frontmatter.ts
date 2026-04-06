/**
 * Frontmatter Transform — splits YAML frontmatter from markdown body,
 * highlights each section with its own language.
 *
 * Used by CodeView when rendering .md files in code mode.
 * Keeps highlightCode untouched — this is a separate pipeline.
 */

import hljs from 'highlight.js';

/**
 * Detect and split YAML frontmatter from the rest of the content.
 * Returns null if no frontmatter found.
 */
function splitFrontmatter(content: string): { yaml: string; body: string } | null {
  if (!content.startsWith('---')) return null;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return null;
  const closingLineEnd = content.indexOf('\n', end + 1);
  const yaml = content.slice(0, closingLineEnd === -1 ? end + 4 : closingLineEnd);
  const body = closingLineEnd === -1 ? '' : content.slice(closingLineEnd + 1);
  return { yaml, body };
}

/**
 * Strip YAML frontmatter, returning only the markdown body.
 * Used by document/transformed view so metadata doesn't render as content.
 */
export function stripFrontmatter(content: string): string {
  if (!content) return '';
  const parts = splitFrontmatter(content);
  return parts ? parts.body : content;
}

/**
 * Highlight a markdown file that may contain YAML frontmatter.
 * Frontmatter block → highlighted as YAML.
 * Body → highlighted as markdown.
 * Returns raw highlighted HTML (no line splitting — caller handles that).
 */
export function highlightWithFrontmatter(content: string): string {
  if (!content) return '';

  const parts = splitFrontmatter(content);
  if (!parts) {
    return hljs.highlight(content, { language: 'markdown' }).value;
  }

  const yamlHtml = hljs.highlight(parts.yaml, { language: 'yaml' }).value;
  const bodyHtml = parts.body
    ? hljs.highlight(parts.body, { language: 'markdown' }).value
    : '';

  return bodyHtml ? yamlHtml + '\n' + bodyHtml : yamlHtml;
}
