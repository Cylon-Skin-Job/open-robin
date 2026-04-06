/**
 * @module FilePageView
 * @role Full-content file viewer for the Capture workspace
 *
 * Displays a single file at readable size filling the content area.
 * Back arrow top-left, sibling files in a ribbon at the bottom.
 *
 * Content rendering is intentionally basic — the inner renderer
 * will be replaced by a unified content module later.
 */

import { useState, useEffect } from 'react';
import type { FileWithContent } from '../tile-row/TileRow';
import { DocumentTile, isImageFile } from '../tile-row/DocumentTile';
import { CodeView } from '../CodeView';
import { copyResourcePath } from '../../lib/resource-path';
import { useActiveResourceStore } from '../../state/activeResourceStore';

interface FilePageViewProps {
  file: FileWithContent;
  siblings: FileWithContent[];
  panel: string;
  folder: string;
  onBack: () => void;
  onSelectSibling: (file: FileWithContent) => void;
}

export function FilePageView({
  file,
  siblings,
  panel,
  folder,
  onBack,
  onSelectSibling,
}: FilePageViewProps) {
  const isImage = isImageFile(file.name);
  const isMarkdown = file.extension === 'md' || file.name.endsWith('.md');
  const [viewMode, setViewMode] = useState<'code' | 'markdown'>('code');
  const setActiveResource = useActiveResourceStore((s) => s.setActiveResource);

  useEffect(() => {
    setActiveResource('capture-viewer', file.path);
  }, [file.path]);

  return (
    <div className="file-page-view">
      {/* Top bar — back arrow + filename + toggle */}
      <div className="file-page-topbar">
        <button className="file-page-back" onClick={onBack} title="Back to tiles">
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <span className="file-page-filename">{file.name}</span>
        <div className="file-page-actions">
          <button
            className="file-page-action"
            onClick={() => copyResourcePath('capture-viewer', file.path)}
            title="Copy file path"
          >
            <span className="material-symbols-outlined">link_2</span>
          </button>
          {isMarkdown && (
            <button
              className="file-page-action"
              onClick={() => setViewMode(viewMode === 'code' ? 'markdown' : 'code')}
              title={viewMode === 'code' ? 'Switch to document view' : 'Switch to code view'}
            >
              <span className="material-symbols-outlined">
                {viewMode === 'code' ? 'toggle_off' : 'toggle_on'}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Content area — fills remaining space; document-surface unifies padding with file explorer + wiki */}
      <div
        className={`file-page-content${!isImage ? ' document-surface' : ''}${!isImage && !(isMarkdown && viewMode === 'markdown') ? ' file-page-document' : ''}`}
      >
        {isImage ? (
          <img
            src={`/api/panel-file/${panel}/${folder}/${encodeURIComponent(file.name)}`}
            alt={file.name}
            className="file-page-image"
          />
        ) : (
          <CodeView content={file.content} extension={file.extension} mode={isMarkdown ? viewMode : 'code'} />
        )}
      </div>

      {/* Bottom ribbon — sibling tiles */}
      <div className="file-page-ribbon">
        <div className="file-page-ribbon-scroll">
          {siblings.map((sib) => (
            <DocumentTile
              key={sib.path}
              name={sib.name}
              content={sib.content}
              extension={sib.extension}
              panel={panel}
              folderPath={folder}
              size="small"
              active={sib.path === file.path}
              onClick={() => onSelectSibling(sib)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
