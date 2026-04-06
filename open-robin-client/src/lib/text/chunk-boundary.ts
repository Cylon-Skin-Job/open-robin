/**
 * Text Chunk Boundary Detection
 *
 * Detects semantic boundaries in streaming markdown text for chunk-based
 * typing animation. Each boundary type gets its own detector function
 * so sub-type renderers can use them independently.
 *
 * Pure utility — no React or queue dependencies.
 */

/** Maximum chars to accumulate before forcing a render at the best available boundary */
const STALL_THRESHOLD = 500;

/**
 * Check whether formatting markers are balanced in the given text.
 * Scans for unmatched `**` (bold) and `` ` `` (inline code) markers.
 */
export function formattingIsBalanced(text: string): boolean {
  let inCode = false;
  let boldCount = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === '\\' && i + 1 < text.length) {
      i++;
      continue;
    }

    if (ch === '`') {
      inCode = !inCode;
      continue;
    }

    if (!inCode && ch === '*' && i + 1 < text.length && text[i + 1] === '*') {
      boldCount++;
      i++;
    }
  }

  return !inCode && boldCount % 2 === 0;
}

/**
 * Find the next safe text chunk boundary.
 *
 * Scans forward from `fromIndex` looking for:
 *   1. Paragraph break (`\n\n`)
 *   2. Header line (`# ` at line start + `\n`)
 *   3. List item (`- `, `* `, `1. ` at line start + `\n`)
 *   4. Single newline (line boundary)
 *
 * Before accepting, verifies formatting is balanced up to that point.
 * If 500+ chars with no balanced boundary, forces break at last safe point.
 * Returns `fromIndex` if no boundary found yet — caller should poll again.
 */
export function getTextChunkBoundary(
  content: string,
  fromIndex: number
): number {
  if (fromIndex >= content.length) return fromIndex;

  const region = content.slice(fromIndex);

  let bestBoundary = -1;
  let searchFrom = 0;

  while (searchFrom < region.length) {
    let boundaryEnd = -1;

    const paraIdx = region.indexOf('\n\n', searchFrom);
    if (paraIdx !== -1) {
      boundaryEnd = paraIdx + 2;
    }

    const nlIdx = region.indexOf('\n', searchFrom);
    if (nlIdx !== -1 && nlIdx + 1 < region.length) {
      const afterNl = nlIdx + 1;
      const restAfterNl = region.slice(afterNl);

      const isStructural =
        /^#{1,6}\s/.test(restAfterNl) ||
        /^[-*]\s/.test(restAfterNl) ||
        /^\d+\.\s/.test(restAfterNl);

      if (isStructural && (boundaryEnd === -1 || afterNl < boundaryEnd)) {
        boundaryEnd = afterNl;
      }

      if (boundaryEnd === -1 && nlIdx + 1 > 0) {
        boundaryEnd = nlIdx + 1;
      }
    }

    if (boundaryEnd === -1) break;

    const candidate = fromIndex + boundaryEnd;
    if (formattingIsBalanced(content.slice(fromIndex, candidate))) {
      bestBoundary = candidate;
      break;
    }

    searchFrom = boundaryEnd;
  }

  if (bestBoundary > fromIndex) return bestBoundary;

  const pendingLength = content.length - fromIndex;
  if (pendingLength >= STALL_THRESHOLD) {
    for (let i = content.length; i > fromIndex; i--) {
      const ch = content[i - 1];
      if (ch === ' ' || ch === '\n') {
        if (formattingIsBalanced(content.slice(fromIndex, i))) {
          return i;
        }
      }
    }
    return content.length;
  }

  return fromIndex;
}

/**
 * Find the next code chunk boundary.
 * Each line is a chunk. Returns position after last `\n`.
 */
export function getCodeChunkBoundary(
  content: string,
  fromIndex: number
): number {
  if (fromIndex >= content.length) return fromIndex;

  const lastNl = content.lastIndexOf('\n', content.length - 1);
  if (lastNl >= fromIndex) {
    return lastNl + 1;
  }

  return fromIndex;
}

/**
 * Find the next code chunk boundary for // comment-based chunking.
 */
export function getCodeCommentBoundary(content: string, fromIndex: number): number {
  if (fromIndex >= content.length) return fromIndex;

  const region = content.slice(fromIndex);

  let searchFrom = 0;
  while (searchFrom < region.length) {
    const nlIdx = region.indexOf('\n', searchFrom);
    if (nlIdx === -1) break;

    const nextLineStart = nlIdx + 1;
    if (nextLineStart >= region.length) break;

    const restAfterNl = region.slice(nextLineStart);
    if (/^\s*\/\//.test(restAfterNl)) {
      return fromIndex + nextLineStart;
    }

    searchFrom = nextLineStart;
  }

  const lastNl = region.lastIndexOf('\n');
  if (lastNl > 0) return fromIndex + lastNl + 1;

  return fromIndex;
}
