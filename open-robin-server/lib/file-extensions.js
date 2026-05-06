/**
 * Canonical list of file extensions known to this app.
 *
 * Used by the clipboard secret detector to allow-list "string ends in a
 * known file extension" — bare filenames and paths shouldn't get
 * fingerprinted as credentials.
 *
 * The client also tracks file extensions in three places:
 *   - open-robin-client/src/components/file-explorer/FileViewer.tsx
 *     (FILE_ICONS, LANGUAGE_NAMES — extension → icon / language name)
 *   - open-robin-client/src/components/tile-row/DocumentTile.tsx
 *     (IMAGE_EXTENSIONS — set of image extensions)
 *   - open-robin-client/src/hooks/useFolderFiles.ts
 *     (duplicate IMAGE_EXTENSIONS)
 *
 * Consolidating those three maps against this list is a follow-up. The
 * catalog here is the union of what they cover plus a handful of common
 * filetypes the clipboard is likely to see in paste content.
 */

'use strict';

const KNOWN_EXTENSIONS = [
  // Code / config
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx',
  'json', 'jsonc',
  'css', 'scss', 'sass', 'less',
  'html', 'htm', 'xml', 'svg',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift',
  'c', 'cc', 'cpp', 'cxx', 'h', 'hpp',
  'sh', 'bash', 'zsh', 'fish',
  'yml', 'yaml', 'toml', 'ini', 'env',
  'sql',
  'lua', 'php', 'pl', 'r',

  // Docs / text
  'md', 'mdx', 'markdown',
  'txt', 'rtf',
  'pdf',
  'doc', 'docx',
  'xls', 'xlsx', 'csv', 'tsv',
  'ppt', 'pptx',

  // Images
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff', 'tif',
  'heic', 'heif', 'avif',

  // Audio / video
  'mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg',
  'mp4', 'mov', 'webm', 'mkv', 'avi',

  // Archives / binaries
  'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar',
  'dmg', 'pkg', 'app', 'exe', 'msi', 'deb', 'rpm',

  // Misc common
  'log', 'lock',
  'gitignore', 'gitattributes',
  'editorconfig', 'eslintrc', 'prettierrc',
  'dockerfile',
];

const KNOWN_EXTENSIONS_SET = new Set(KNOWN_EXTENSIONS.map((e) => e.toLowerCase()));

/**
 * Returns true if the string ends with `.<ext>` where <ext> is in the
 * canonical list. Case-insensitive.
 */
function endsWithKnownExtension(value) {
  if (typeof value !== 'string') return false;
  const lastDot = value.lastIndexOf('.');
  if (lastDot < 0 || lastDot === value.length - 1) return false;
  const ext = value.slice(lastDot + 1).toLowerCase();
  return KNOWN_EXTENSIONS_SET.has(ext);
}

module.exports = {
  KNOWN_EXTENSIONS,
  KNOWN_EXTENSIONS_SET,
  endsWithKnownExtension,
};
