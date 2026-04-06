/**
 * Markdown Chunk Strategy — Adapter wrapping parseTextChunks.
 *
 * Used by: text segments.
 *
 * Thin adapter that calls the existing parseTextChunks() from lib/text/
 * and converts ParsedBlock[] to TaggedChunk[]. The text parser already
 * handles cursor-forward parsing, code fence holding, and pre-rendered HTML.
 *
 * This strategy does NOT replace parseTextChunks — it wraps it so it
 * conforms to the ActiveChunkStrategy interface for the unified pipeline.
 */

import type { TaggedChunk } from '../../../types/tagged-chunk';
import type { ActiveChunkStrategy } from '../../../types/active-strategy';
import { parseTextChunks } from '../../text/index';
import type { ParsedBlock } from '../../text/index';

function parsedBlockToTaggedChunk(block: ParsedBlock): TaggedChunk {
  return {
    content: block.content,
    block: block.isCodeBlock ? 'code' : 'text',
    parent: 'text',
    position: block.isPartial ? 'continue' : 'complete',
  };
}

export function createMarkdownChunkStrategy(): ActiveChunkStrategy {
  let content = '';
  let cursor = 0;
  let isComplete = false;
  const ready: TaggedChunk[] = [];

  function parse() {
    if (cursor >= content.length) return;
    const result = parseTextChunks(content, cursor, isComplete);
    for (const block of result.blocks) {
      ready.push(parsedBlockToTaggedChunk(block));
    }
    cursor = result.consumed;
  }

  return {
    onContent(data: string) {
      content += data;
      parse();
    },

    onResult() {
      isComplete = true;
      parse();
    },

    next(): TaggedChunk | null {
      return ready.length > 0 ? ready.shift()! : null;
    },

    flush(): TaggedChunk[] {
      isComplete = true;
      parse();
      const chunks = [...ready];
      ready.length = 0;
      return chunks;
    },
  };
}
