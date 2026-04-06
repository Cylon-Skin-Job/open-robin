/**
 * Shared interface for all segment content renderers.
 */

export interface SegmentContentRenderer {
  /** Split content into chunks for animated typing */
  parseChunks(content: string, toolArgs?: Record<string, unknown>): string[];
  /** Render content for instant (non-animated) display — returns HTML string */
  renderInstant(content: string, toolArgs?: Record<string, unknown>): string;
}
