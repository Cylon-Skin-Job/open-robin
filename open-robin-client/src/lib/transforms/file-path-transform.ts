/**
 * File Path Transform — Truncate paths for tool dropdown labels.
 *
 * In text segments, file paths are content — never truncated, fully copy-pasteable.
 * In tool dropdowns, paths are labels — truncated to '.../parent/filename.ext'.
 *
 * Three levels of progressive disclosure:
 *   Label (visible):   .../renderers/paragraph.ts
 *   Tooltip (hover):   kimi-ide-client/src/lib/text/renderers/paragraph.ts
 *   Copy (clipboard):  /Users/.../paragraph.ts (absolute)
 */

import type { TaggedChunk } from '../../types/tagged-chunk';

/**
 * Extract the file path from a tagged chunk.
 * Looks in toolArgs for common path fields.
 */
function extractPath(_chunk: TaggedChunk, toolArgs?: Record<string, unknown>): string | null {
  if (toolArgs) {
    // Wire protocol uses 'path' for ReadFile, 'file_path' for Write/Edit
    const p = toolArgs.path ?? toolArgs.file_path;
    if (typeof p === 'string') return p;
  }
  return null;
}

/**
 * Strip everything before the project directory.
 * Heuristic: find '/projects/' or similar markers, take the path after the project name.
 */
function toProjectRelative(fullPath: string): string {
  // Look for common project root markers
  const markers = ['/projects/', '/repos/', '/src/', '/home/'];
  for (const marker of markers) {
    const idx = fullPath.indexOf(marker);
    if (idx !== -1) {
      // Skip the marker, then skip the project name directory
      const afterMarker = fullPath.slice(idx + marker.length);
      const slashIdx = afterMarker.indexOf('/');
      if (slashIdx !== -1) {
        return afterMarker.slice(slashIdx + 1);
      }
      return afterMarker;
    }
  }
  return fullPath;
}

/**
 * Truncate to .../parent/filename.ext
 */
function truncateLabel(fullPath: string): string {
  const parts = fullPath.split('/').filter(Boolean);
  const filename = parts.at(-1) || fullPath;
  const parent = parts.at(-2);

  if (!parent) return filename; // root file, no ellipsis needed
  return `.../${parent}/${filename}`;
}

/**
 * Apply file path transform to a tagged chunk.
 * Sets displayLabel, tooltip, and copyValue.
 */
export function filePathTransform(
  chunk: TaggedChunk,
  toolArgs?: Record<string, unknown>,
): TaggedChunk {
  const fullPath = extractPath(chunk, toolArgs);
  if (!fullPath) return chunk;

  return {
    ...chunk,
    displayLabel: truncateLabel(fullPath),
    tooltip: toProjectRelative(fullPath),
    copyValue: fullPath,
  };
}
