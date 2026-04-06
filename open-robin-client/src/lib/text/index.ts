/**
 * Text Module — entry point.
 *
 * Exports: parseTextChunks (cursor-forward block parser), renderTextInstant,
 * chunk buffer, and HTML utilities for progressive reveal.
 *
 * Sub-renderers are ordered by specificity: code fence > header > list > paragraph.
 * The dispatcher tries each in order; paragraph is the fallback.
 */

export { createChunkBuffer } from './chunk-buffer';
export type { ChunkBuffer, RenderedChunk } from './chunk-buffer';
export { truncateHtmlToChars, getVisibleTextLength } from './html-utils';

import { codeFenceRenderer } from './renderers/code-fence';
import { headerRenderer } from './renderers/header';
import { listRenderer } from './renderers/list';
import { paragraphRenderer } from './renderers/paragraph';
import type { TextSubRenderer } from './renderers/types';
import { formattingIsBalanced as isBalanced } from './chunk-boundary';

/**
 * Ordered list of sub-renderers. First match wins.
 * Paragraph is last — it's the fallback for anything unmatched.
 */
const SUB_RENDERERS: TextSubRenderer[] = [
  codeFenceRenderer,
  headerRenderer,
  listRenderer,
  paragraphRenderer,
];

/**
 * Identify which sub-renderer handles the content at the given position.
 */
function getTextSubRenderer(content: string, fromIndex: number): TextSubRenderer {
  for (const renderer of SUB_RENDERERS) {
    if (renderer.matches(content, fromIndex)) {
      return renderer;
    }
  }
  return paragraphRenderer;
}

// ── ParsedBlock: what parseTextChunks returns ────────────────────────

export interface ParsedBlock {
  /** Raw markdown for this block (used for buffer metadata + cursor advancement) */
  content: string;
  /** Pre-rendered HTML via the sub-renderer that matched this block */
  html: string;
  /** True if this block starts with ``` (code fence) */
  isCodeBlock: boolean;
  /** True if no boundary was found — block is still streaming */
  isPartial: boolean;
}

export interface ParseResult {
  /** Parsed blocks with pre-rendered HTML */
  blocks: ParsedBlock[];
  /** How far into the content string we consumed (byte position) */
  consumed: number;
}

/** Stall threshold — force a chunk break after this many chars with no boundary */
const STALL_THRESHOLD = 500;

/**
 * Parse streaming text content into blocks, starting from a cursor position.
 *
 * Each block is one semantic sub-unit (paragraph, header, code fence, list).
 * Blocks carry pre-rendered HTML from their matched sub-renderer.
 *
 * Cursor-forward: pass `fromIndex` to parse only untyped content.
 * No re-parsing of already-typed content. No cursor drift.
 *
 * @param content   Full content string (grows as tokens stream in)
 * @param fromIndex Byte position to start parsing from (default 0)
 * @param isComplete True when the segment is done streaming — last block is NOT partial
 * @returns { blocks, consumed } — blocks to type + how far we got
 */
export function parseTextChunks(
  content: string,
  fromIndex: number = 0,
  isComplete: boolean = false,
): ParseResult {
  const blocks: ParsedBlock[] = [];
  let cursor = fromIndex;

  while (cursor < content.length) {
    const renderer = getTextSubRenderer(content, cursor);
    const boundary = renderer.findBoundary(content, cursor);

    if (boundary > cursor) {
      // Complete block — boundary found.
      const raw = content.slice(cursor, boundary);
      blocks.push({
        content: raw,
        html: renderer.toHtml(raw),
        isCodeBlock: codeFenceRenderer.matches(content, cursor),
        isPartial: false,
      });
      cursor = boundary;
    } else {
      // No complete boundary yet.
      //
      // CODE FENCES: Wait for the closing ```. Do NOT push partial
      // content. The code block is one atomic unit — we don't type
      // it until it's complete. The cursor blinks at the previous
      // block boundary while the code block streams in.
      if (codeFenceRenderer.matches(content, cursor)) {
        // If the segment is complete and this is the last content,
        // render the incomplete fence as-is (it won't get a closing tag).
        if (isComplete) {
          const raw = content.slice(cursor);
          blocks.push({
            content: raw,
            html: renderer.toHtml(raw),
            isCodeBlock: true,
            isPartial: false,
          });
          cursor = content.length;
        }
        // Otherwise wait — don't push anything.
        break;
      }

      // Other block types: push partial content so the user sees
      // text appearing as it streams.
      const pending = content.length - cursor;

      if (isComplete) {
        // Segment is done — everything remaining is final.
        const raw = content.slice(cursor);
        blocks.push({
          content: raw,
          html: renderer.toHtml(raw),
          isCodeBlock: false,
          isPartial: false,
        });
        cursor = content.length;
      } else if (pending >= STALL_THRESHOLD) {
        // Force break at last balanced whitespace
        const beforeStall = cursor;
        for (let i = content.length; i > cursor; i--) {
          const ch = content[i - 1];
          if (ch === ' ' || ch === '\n') {
            if (isBalanced(content.slice(cursor, i))) {
              const raw = content.slice(cursor, i);
              blocks.push({
                content: raw,
                html: renderer.toHtml(raw),
                isCodeBlock: false,
                isPartial: true,
              });
              cursor = i;
              break;
            }
          }
        }
        // If no safe break found, take everything
        if (cursor === beforeStall) {
          const raw = content.slice(cursor);
          blocks.push({
            content: raw,
            html: renderer.toHtml(raw),
            isCodeBlock: false,
            isPartial: true,
          });
          cursor = content.length;
        }
      } else {
        // Not enough content yet — push as partial
        const raw = content.slice(cursor);
        blocks.push({
          content: raw,
          html: renderer.toHtml(raw),
          isCodeBlock: false,
          isPartial: true,
        });
        cursor = content.length;
      }
    }
  }

  return { blocks, consumed: cursor };
}

/**
 * Render text content to HTML instantly (no animation).
 * Routes each block through its sub-renderer's toHtml() for per-type consistency.
 */
export function renderTextInstant(content: string): string {
  if (!content) return '';

  const parts: string[] = [];
  let fromIndex = 0;

  while (fromIndex < content.length) {
    const renderer = getTextSubRenderer(content, fromIndex);
    const boundary = renderer.findBoundary(content, fromIndex);
    const end = boundary > fromIndex ? boundary : content.length;
    parts.push(renderer.toHtml(content.slice(fromIndex, end)));
    fromIndex = end;
  }

  return parts.join('');
}
