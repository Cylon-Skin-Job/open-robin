/**
 * Path truncation for file-list renderers (read, glob).
 *
 * Always shows filename + project-relative prefix.
 * Truncates the middle with ... when too long.
 */

const MAX_DISPLAY_LENGTH = 60;

export function truncatePath(filePath: string): string {
  if (!filePath) return '';
  if (filePath.length <= MAX_DISPLAY_LENGTH) return filePath;

  const parts = filePath.split('/');
  const filename = parts[parts.length - 1];

  // Keep first 2 path segments + filename, collapse the middle
  if (parts.length <= 3) return filePath;

  const prefix = parts.slice(0, 2).join('/');
  return `${prefix}/.../${filename}`;
}
