/**
 * Shared interface for text sub-type renderers.
 *
 * Each renderer handles one markdown sub-block type (paragraph, header,
 * code fence, list). Owns its own boundary detection and HTML output.
 */

export interface TextSubRenderer {
  /** Detect if content starting at `fromIndex` belongs to this sub-type */
  matches(content: string, fromIndex: number): boolean;

  /** Find the end boundary of this sub-block. Returns index after the block. */
  findBoundary(content: string, fromIndex: number): number;

  /** Render this sub-block's content to HTML */
  toHtml(content: string): string;
}
