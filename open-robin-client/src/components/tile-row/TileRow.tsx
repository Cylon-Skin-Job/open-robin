/**
 * @module TileRow
 * @role Generic horizontal row of document tiles for a folder
 *
 * Reads from the central fileDataStore via useFolderFiles hook.
 * No WebSocket logic — the store handles fetching and caching.
 *
 * Reusable across any panel — Capture, Agents, etc.
 */

import { useFolderFiles } from '../../hooks/useFolderFiles';
import { DocumentTile } from './DocumentTile';
import type { FileWithContent } from '../../state/fileDataStore';

// Re-export for consumers that import from here
export type { FileWithContent } from '../../state/fileDataStore';

interface TileRowProps {
  label: string;
  panel: string;
  folder: string;
  onFileClick?: (filePath: string) => void;
  onFileSelect?: (file: FileWithContent, siblings: FileWithContent[]) => void;
}

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'folder';
  extension?: string;
}

export function TileRow({ label, panel, folder, onFileClick, onFileSelect }: TileRowProps) {
  const { files, loading } = useFolderFiles(panel, folder);

  return (
    <div className="tile-row">
      <div className="tile-row-header">
        <span className="tile-row-label">{label}</span>
        <span className="tile-row-count">
          {loading ? '...' : files.length > 0 ? `${files.length}` : ''}
        </span>
      </div>
      <div className="tile-row-scroll">
        {loading ? (
          <div className="tile-row-empty">Loading...</div>
        ) : files.length === 0 ? (
          <div className="tile-row-empty">Empty</div>
        ) : (
          files.map((file) => (
            <DocumentTile
              key={file.path}
              name={file.name}
              content={file.content}
              extension={file.extension}
              panel={panel}
              folderPath={folder}
              onClick={() => {
                onFileClick?.(file.path);
                onFileSelect?.(file, files);
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}
