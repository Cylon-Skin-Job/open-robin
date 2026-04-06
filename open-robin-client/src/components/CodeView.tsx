/**
 * @module CodeView
 * @role Shared syntax-highlighted code viewer with line numbers.
 *
 * Two modes:
 *   - 'code' (default): syntax-highlighted raw text with line gutter
 *   - 'markdown': rendered HTML via markdownToHtml
 *
 * Used by: FileContentRenderer, FilePageView (code ↔ rendered MD toggle), PromptCardView, etc.
 * Shared styles: src/styles/document.css (.code-editor, .wiki-page-content).
 */

import { useMemo } from 'react';
import { highlightCode, markdownToHtml, stripFrontmatter } from '../lib/transforms';

interface CodeViewProps {
  content: string;
  extension?: string;
  mode?: 'code' | 'markdown';
}

export function CodeView({ content, extension, mode = 'code' }: CodeViewProps) {
  const markdownHtml = useMemo(() => markdownToHtml(stripFrontmatter(content)), [content]);
  const highlighted = useMemo(() => highlightCode(content, extension), [content, extension]);
  const lines = useMemo(() => highlighted.split('\n'), [highlighted]);
  const codeHtml = useMemo(() => {
    return lines
      .map((line) => `<span class="code-line">${line || ' '}</span>`)
      .join('');
  }, [lines]);

  if (mode === 'markdown') {
    return (
      <div
        className="wiki-page-content"
        dangerouslySetInnerHTML={{ __html: markdownHtml }}
      />
    );
  }

  return (
    <div className="code-editor">
      <div className="code-gutter">
        {lines.map((_, i) => (
          <span key={i} className="line-number">{i + 1}</span>
        ))}
      </div>
      <div className="code-content">
        <pre>
          <code dangerouslySetInnerHTML={{ __html: codeHtml }} />
        </pre>
      </div>
    </div>
  );
}
