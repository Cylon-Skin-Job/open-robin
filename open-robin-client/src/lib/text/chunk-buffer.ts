/**
 * Text Chunk Buffer — Pure FIFO queue for renderable chunks.
 *
 * Holds chunks and tracks the cursor position. Speed decisions
 * are delegated to the speed attenuator (speed-attenuator.ts).
 *
 * The buffer is the DATA. The attenuator is the DECISION.
 * They are separate concerns.
 */

import { computeSpeed, speedToMs, type AttenuatorOptions } from './speed-attenuator';

export interface RenderedChunk {
  content: string;
  /** Code blocks don't count as lookahead for speed decisions. */
  isCodeBlock?: boolean;
  /** Partial chunks (still streaming, no boundary yet) don't count as lookahead. */
  isPartial?: boolean;
}

export interface ChunkBuffer {
  push(chunk: RenderedChunk): void;
  hasNext(): boolean;
  next(): RenderedChunk | null;
  peek(): RenderedChunk | null;
  /** Speed decision — delegated to the attenuator. */
  getSpeed(): 'fast' | 'slow';
  /** Speed in ms per char — delegated to the attenuator. */
  getSpeedMs(): number;
  size(): number;
  clear(): void;
  /** Signal that content is pending but not ready (e.g., incomplete code fence). */
  setPendingBlock(pending: boolean): void;
}

export function createChunkBuffer(attenuatorOptions?: AttenuatorOptions): ChunkBuffer {
  const chunks: RenderedChunk[] = [];
  let cursor = 0;
  let pendingBlock = false;

  return {
    push(chunk: RenderedChunk) {
      chunks.push(chunk);
    },

    hasNext(): boolean {
      return cursor < chunks.length;
    },

    next(): RenderedChunk | null {
      if (!this.hasNext()) return null;
      return chunks[cursor++];
    },

    peek(): RenderedChunk | null {
      if (cursor >= chunks.length) return null;
      return chunks[cursor];
    },

    getSpeed(): 'fast' | 'slow' {
      return computeSpeed(chunks, cursor, pendingBlock, attenuatorOptions);
    },

    getSpeedMs(): number {
      return speedToMs(this.getSpeed());
    },

    size(): number {
      return chunks.length - cursor;
    },

    clear() {
      chunks.length = 0;
      cursor = 0;
      pendingBlock = false;
    },

    setPendingBlock(pending: boolean) {
      pendingBlock = pending;
    },
  };
}
