/**
 * Chunk Strategy — per-tool definition of what constitutes a
 * speed-relevant unit in the queue.
 *
 * This is the THIRD registry per tool type:
 *   1. segmentCatalog.ts   → Visual identity (icon, label, colors)
 *   2. tool-renderers/     → Content presentation (style, format, grouping)
 *   3. chunk-strategies/   → Speed decomposition (what counts as a queue item)
 *
 * The speed attenuator is generic — it counts complete items ahead
 * of the cursor. Each tool's chunk strategy defines what "item" means
 * for that tool type.
 *
 * ADDING A NEW TOOL:
 *   1. Add visual identity to segmentCatalog.ts
 *   2. Add content renderer to tool-renderers/
 *   3. Add chunk strategy here
 */

export interface ChunkStrategy {
  /**
   * How this tool's content decomposes into speed-relevant items.
   *
   * 'paragraph'  — Semantic text blocks: paragraphs (\n\n), headers,
   *                code fences, lists. Each complete block is one item.
   *                Used by: text, think.
   *
   * 'line'       — Each newline is a boundary. Every line is one item.
   *                Used by: subagent, todo.
   *
   * 'line-group' — N lines grouped as one item. Prevents the attenuator
   *                from seeing 20 buffered lines as "way ahead" when
   *                it's really just a few seconds of output.
   *                Used by: shell.
   *
   * 'whole'      — Entire content is one item. The tool output is atomic.
   *                Used by: write, edit.
   *
   * 'per-call'   — Each consecutive tool call is one item. For grouped
   *                tools where multiple calls collapse into one block.
   *                Used by: read, glob, grep, web_search, fetch.
   */
  mode: 'paragraph' | 'line' | 'line-group' | 'whole' | 'per-call';

  /**
   * For 'line-group' mode: how many lines form one speed-relevant group.
   * If the segment completes with fewer than this, the remainder is one item.
   * Default: 5.
   */
  linesPerGroup?: number;

  /**
   * Does a complete code fence (``` ... ```) count as a lookahead item
   * for speed decisions? When true, a buffered complete code fence
   * contributes to the "ahead" count. When false, code fences are
   * invisible to the attenuator (decoration, not evidence of throughput).
   * Default: true.
   */
  codeFenceAsLookahead?: boolean;

  /**
   * Does the tool container (the shimmer/icon/label that appears before
   * content) count as the first chunk in the speed queue?
   * True for tool segments (the tag itself is work). False for bare text
   * (text has no container — first paragraph is chunk 0).
   * Default: true for tools, false for text.
   */
  tagAsFirstChunk?: boolean;
}
