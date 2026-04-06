/**
 * Tagged Chunk — A chunk of content with rendering metadata attached.
 *
 * The chunker attaches these tags. The renderer reads them.
 * No re-parsing. No detection. No inference downstream.
 */

/** Block type determines which renderer handles this chunk */
export type ChunkBlockType = 'text' | 'code' | 'think' | 'diff' | 'shell';

/** Position within a multi-chunk block */
export type ChunkPosition = 'complete' | 'open' | 'continue' | 'close';

export interface TaggedChunk {
  /** Raw content of this chunk */
  content: string;

  /** Block type — determines which renderer sub-function handles this */
  block: ChunkBlockType;

  /** Parent segment type (e.g., 'text', 'think', 'write') — provides rendering context */
  parent: string;

  /** Language hint for code blocks (e.g., 'javascript', 'typescript') */
  lang?: string;

  /** Position within a multi-chunk block (for long tool output sub-chunked across multiple pieces) */
  position: ChunkPosition;

  // ── Display fields (set by transform, if any) ──

  /** Truncated path for tool dropdown labels: '.../parent/filename.ext' */
  displayLabel?: string;

  /** Full project-relative path for tooltip on hover */
  tooltip?: string;

  /** Absolute path for clipboard copy */
  copyValue?: string;

  // ── Result (set by strategy for awaitsResult tools) ──

  /** Tool call result content (confirms the operation completed) */
  result?: string;
}
