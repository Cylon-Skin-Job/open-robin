// File Explorer Utilities
// Icon mapping and name formatting for file tree display

export const FILE_ICONS: Record<string, string> = {
  // JavaScript
  js: 'flowsheet',
  mjs: 'flowsheet',
  cjs: 'flowsheet',

  // TypeScript
  ts: 'bolt',
  
  // React
  jsx: 'dynamic_form',
  tsx: 'dynamic_form',

  // Web
  json: 'data_object',
  css: 'tag',
  scss: 'tag',
  sass: 'tag',
  less: 'tag',
  html: 'code',
  htm: 'code',

  // Python
  py: 'terminal',
  pyc: 'terminal',
  pyo: 'terminal',
  pyd: 'terminal',

  // Rust
  rs: 'memory',

  // Go
  go: 'directions_run',

  // Java
  java: 'coffee',
  jar: 'coffee',
  class: 'coffee',

  // C/C++
  c: 'memory',
  cpp: 'memory',
  cc: 'memory',
  cxx: 'memory',
  h: 'memory',
  hpp: 'memory',

  // C#
  cs: 'code',

  // Ruby
  rb: 'diamond',

  // PHP
  php: 'code',

  // Swift
  swift: 'speed',

  // Shell scripts
  sh: 'terminal',
  bash: 'terminal',
  zsh: 'terminal',
  fish: 'terminal',
  ps1: 'terminal',
  bat: 'terminal',
  cmd: 'terminal',

  // Docs
  md: 'description',
  mdx: 'description',
  txt: 'text_snippet',
  rtf: 'text_snippet',
  pdf: 'picture_as_pdf',

  // Config
  yml: 'settings',
  yaml: 'settings',
  toml: 'settings',
  ini: 'settings',
  cfg: 'settings',
  conf: 'settings',
  config: 'settings',
  env: 'key',
  lock: 'lock',

  // Git
  gitignore: 'source_control',
  gitattributes: 'source_control',
  gitmodules: 'source_control',

  // Media
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  svg: 'image',
  webp: 'image',
  ico: 'image',
  bmp: 'image',
  tiff: 'image',
  mp4: 'videocam',
  mov: 'videocam',
  avi: 'videocam',
  mkv: 'videocam',
  webm: 'videocam',
  mp3: 'audiotrack',
  wav: 'audiotrack',
  ogg: 'audiotrack',
  flac: 'audiotrack',

  // Data
  csv: 'table',
  tsv: 'table',
  sql: 'database',
  sqlite: 'database',
  db: 'database',

  // Archives
  zip: 'folder_zip',
  tar: 'folder_zip',
  gz: 'folder_zip',
  bz2: 'folder_zip',
  '7z': 'folder_zip',
  rar: 'folder_zip',

  // Docker
  dockerfile: 'view_in_ar',

  // Source maps
  map: 'map',
};

const DEFAULT_FILE_ICON = 'article';

export function getFileIcon(extension?: string, filename?: string): string {
  // Check for dotfiles (e.g., .gitignore, .env, .dockerfile)
  if (filename && filename.startsWith('.')) {
    const dotfileName = filename.slice(1); // Remove the leading dot
    if (FILE_ICONS[dotfileName]) {
      return FILE_ICONS[dotfileName];
    }
  }
  // Check extension
  if (extension && FILE_ICONS[extension]) {
    return FILE_ICONS[extension];
  }
  return DEFAULT_FILE_ICON;
}

/** File/folder names: display as-is (disk name = display name) */
export function formatNodeName(name: string): string {
  return name;
}

