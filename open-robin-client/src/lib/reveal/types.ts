/**
 * Reveal types — interfaces for chunk parsing and reveal orchestration.
 */

/** A chunk that has been parsed, transformed, and is ready to render */
export interface ParsedChunk {
  /** Ready-to-render content (already transformed) */
  text: string;
}

/**
 * Chunk Parser — content-type-specific boundary detection + transformation.
 *
 * Called repeatedly as tokens stream in. Returns an array of NEW complete
 * chunks since the last call. Each chunk is already transformed and ready
 * to render on the page.
 */
export interface ChunkParser {
  /**
   * Feed the full content so far. Returns any NEW complete chunks.
   * @param content - Full content string (grows as tokens arrive)
   * @param prevLength - Length of content on the previous call (0 on first call)
   */
  feed(content: string, prevLength: number): ParsedChunk[];

  /**
   * Flush any held-back partial content as a chunk.
   * Called by the orchestrator when content has been buffered too long
   * without a boundary (e.g., slow-streaming thinking content without \n).
   * Returns the partial chunk if any, otherwise an empty array.
   */
  flush?(content: string): ParsedChunk[];
}

/**
 * Options for controlling reveal speed and behavior.
 * All fields are optional — when absent, the orchestrator uses its defaults.
 * Passed from the pressure gauge to attenuate animation under backlog.
 */
export interface RevealOptions {
  speedFast?: number;
  speedSlow?: number;
  batchSizeFast?: number;
  interChunkPause?: number;
  /** Skip typing entirely — wait for content to be complete, then show at once. */
  instantReveal?: boolean;
}

/**
 * Reveal Controller — drives the animation for one segment.
 *
 * Gets content/complete refs that update as streaming progresses.
 * Runs until the closing tag arrives and all content is rendered.
 */
export interface RevealController {
  run(
    contentRef: { current: string },
    setDisplayed: (content: string) => void,
    cancelRef: { current: boolean },
    completeRef: { current: boolean },
    options?: RevealOptions,
  ): Promise<void>;
}
