/**
 * ToolRenderer — Per-tool-type presentation module.
 *
 * Each tool type (think, shell, read, edit, etc.) has one renderer
 * that owns ALL presentation decisions: title, content style,
 * content formatting, grouping behavior, cursor visibility.
 *
 * LiveToolSegment and InstantToolBlock are pure orchestration —
 * zero type-specific code. They delegate everything here.
 */

export interface ContentStyle {
  whiteSpace: string;
  fontFamily: string;
  fontStyle: string;
  fontSize?: string;
  color?: string;
}

export interface ToolRenderer {
  /** Does this renderer consume multiple consecutive same-type segments? */
  grouped: boolean;

  /**
   * Build the title text displayed next to the icon.
   * Called on mount and again each time a new item is consumed (grouped).
   *
   * @param itemCount - Number of items rendered so far (1 for singular, N for grouped)
   * @param args - Tool arguments from the segment (file_path, pattern, url, etc.)
   */
  buildTitle(itemCount: number, args?: Record<string, unknown>): string;

  /** Content container styles — applied to the wrapper div inside ToolCallBlock. */
  contentStyle: ContentStyle;

  /** Whether to show the typing cursor during reveal phase. */
  showCursor: boolean;

  /**
   * Format content for display inside the tool block.
   * Returns an HTML string (safe — content is escaped internally).
   *
   * For singular tools: called once with the full content.
   * For grouped tools: called once per consumed segment.
   */
  formatContent(content: string, args?: Record<string, unknown>): string;

  /**
   * For grouped renderers: should we consume the next segment into this block?
   * Called after each item arrives. Peek at the next segment type.
   */
  shouldConsumeNext?(nextType: string): boolean;
}
