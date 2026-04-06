import type { KeyboardEvent, MouseEvent } from 'react';
import { useFileStore } from '../../state/fileStore';
import { FileContentRenderer } from './FileContentRenderer';
import type { EditorTab } from '../../types/file-explorer';

// File extension to icon mapping
const FILE_ICONS: Record<string, string> = {
  js: 'javascript',
  jsx: 'code',
  ts: 'terminal',
  tsx: 'code',
  json: 'data_object',
  css: 'format_paint',
  scss: 'format_paint',
  html: 'html',
  htm: 'html',
  py: 'terminal',
  rb: 'terminal',
  go: 'terminal',
  rs: 'terminal',
  java: 'coffee',
  c: 'memory',
  cpp: 'memory',
  h: 'memory',
  sh: 'terminal',
  bash: 'terminal',
  yml: 'list',
  yaml: 'list',
  toml: 'settings',
  xml: 'code',
  sql: 'database',
  md: 'description',
  txt: 'description',
  env: 'settings',
  gitignore: 'settings',
};

// File extension to language name mapping
const LANGUAGE_NAMES: Record<string, string> = {
  js: 'JavaScript',
  jsx: 'JSX',
  ts: 'TypeScript',
  tsx: 'TSX',
  json: 'JSON',
  css: 'CSS',
  scss: 'SCSS',
  html: 'HTML',
  htm: 'HTML',
  py: 'Python',
  rb: 'Ruby',
  go: 'Go',
  rs: 'Rust',
  java: 'Java',
  c: 'C',
  cpp: 'C++',
  h: 'C Header',
  sh: 'Shell',
  bash: 'Bash',
  yml: 'YAML',
  yaml: 'YAML',
  toml: 'TOML',
  xml: 'XML',
  sql: 'SQL',
  md: 'Markdown',
  txt: 'Plain Text',
  env: 'Environment',
  gitignore: 'Git Ignore',
};

function getFileIcon(extension?: string): string {
  if (!extension) return 'description';
  return FILE_ICONS[extension] || 'description';
}

function getLanguageName(extension?: string): string {
  if (!extension) return 'Plain Text';
  return LANGUAGE_NAMES[extension] || extension.toUpperCase();
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatFilePath(path: string): string {
  const parts = path.split('/');
  if (parts.length <= 2) return path;
  return '.../' + parts.slice(-2).join('/');
}

function TabRow({
  tab,
  active,
  onClose,
}: {
  tab: EditorTab;
  active: boolean;
  onClose: (e: MouseEvent) => void;
}) {
  const fileIcon = getFileIcon(tab.file.extension);
  const path = tab.file.path;
  return (
    <div
      role="tab"
      aria-selected={active}
      data-tab-path={path}
      tabIndex={active ? 0 : -1}
      className={`file-viewer-tab${active ? ' active' : ''}`}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          useFileStore.getState().setActiveTab(path);
        }
      }}
    >
      <span className={`material-symbols-outlined tab-icon file-icon-${tab.file.extension}`}>
        {fileIcon}
      </span>
      <span className="tab-name">{tab.file.name}</span>
      <button
        type="button"
        className="tab-close"
        onClick={onClose}
        disabled={tab.loading}
        title="Close tab"
      >
        <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>
          close
        </span>
      </button>
    </div>
  );
}

export function FileViewer() {
  const tabs = useFileStore((s) => s.tabs);
  const activeTabPath = useFileStore((s) => s.activeTabPath);
  const activateAdjacentTab = useFileStore((s) => s.activateAdjacentTab);
  const closeTab = useFileStore((s) => s.closeTab);
  const closeActiveTab = useFileStore((s) => s.closeActiveTab);

  const activeTab = tabs.find((t) => t.file.path === activeTabPath) ?? null;

  if (!activeTab || !activeTabPath) return null;

  const selectedFile = activeTab.file;
  const fileContent = activeTab.content;
  const isLoading = activeTab.loading;
  const fileSize = activeTab.size;

  const languageName = getLanguageName(selectedFile.extension);
  const displaySize = fileSize ? formatFileSize(fileSize) : isLoading ? 'Loading...' : '—';
  const lineCount = fileContent.split('\n').length;

  const activeIdx = tabs.findIndex((t) => t.file.path === activeTabPath);
  const canGoPrev = tabs.length > 1 && activeIdx > 0;
  const canGoNext = tabs.length > 1 && activeIdx >= 0 && activeIdx < tabs.length - 1;

  function handleTabStripClick(e: MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('button.tab-close')) return;
    const row = (e.target as HTMLElement).closest('[data-tab-path]');
    if (!row) return;
    const path = row.getAttribute('data-tab-path');
    if (!path) return;
    e.stopPropagation();
    useFileStore.getState().setActiveTab(path);
  }

  return (
    <div className="file-viewer">
      <div className="file-viewer-header">
        <div className="file-viewer-nav">
          <button
            type="button"
            className="nav-btn"
            title="Previous tab"
            disabled={!canGoPrev}
            onClick={() => activateAdjacentTab(-1)}
          >
            <span className="material-symbols-outlined">chevron_left</span>
          </button>
          <button
            type="button"
            className="nav-btn"
            title="Next tab"
            disabled={!canGoNext}
            onClick={() => activateAdjacentTab(1)}
          >
            <span className="material-symbols-outlined">chevron_right</span>
          </button>
        </div>
        <div className="file-viewer-tabs" onClick={handleTabStripClick}>
          {tabs.map((tab) => (
            <TabRow
              key={tab.file.path}
              tab={tab}
              active={tab.file.path === activeTabPath}
              onClose={(e) => {
                e.stopPropagation();
                closeTab(tab.file.path);
              }}
            />
          ))}
        </div>

        <div className="file-viewer-actions">
          <button
            type="button"
            className="action-btn"
            onClick={closeActiveTab}
            disabled={isLoading}
            title="Back to explorer"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
              folder_open
            </span>
          </button>
        </div>
      </div>

      <div className="file-viewer-info">
        <div className="info-item">
          <span>{formatFilePath(selectedFile.path)}</span>
        </div>
        <div className="info-item" style={{ marginLeft: 'auto' }}>
          <span className="material-symbols-outlined">code</span>
          <span>{languageName}</span>
        </div>
        <div className="info-item">
          <span className="material-symbols-outlined">straighten</span>
          <span>{displaySize}</span>
        </div>
        <div className="info-item">
          <span className="material-symbols-outlined">format_list_numbered</span>
          <span>{lineCount} lines</span>
        </div>
      </div>

      <div className={`file-viewer-content${isLoading ? ' loading' : ''}`}>
        <FileContentRenderer
          content={fileContent}
          extension={selectedFile.extension}
          fileName={selectedFile.name}
        />
      </div>
    </div>
  );
}
