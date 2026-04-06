import { useEffect } from 'react';
import { useFileStore } from '../../state/fileStore';
import { useFileTreeListener, loadExpandedFolders } from '../../hooks/useFileTree';
import { useCodeViewerWorkspaceStyles } from '../../hooks/usePanelWorkspaceStyles';
import { FileTree } from './FileTree';
import { FileViewer } from './FileViewer';

export function FileExplorer() {
  useCodeViewerWorkspaceStyles();

  const viewMode = useFileStore((s) => s.viewMode);
  const rootNodes = useFileStore((s) => s.rootNodes);
  const isLoading = useFileStore((s) => s.isLoading);
  const error = useFileStore((s) => s.error);

  // Single WebSocket listener for file operations
  useFileTreeListener();

  // Keep expanded folders loaded whenever tree is visible
  useEffect(() => {
    loadExpandedFolders();
  }, []);

  return (
    <div className="file-explorer-layout">
      {/* Main viewer area */}
      <div className="file-explorer-main">
        {viewMode === 'viewer' ? (
          <FileViewer />
        ) : (
          <div className="file-explorer-empty">
            <span className="material-symbols-outlined">description</span>
            <span>Select a file to view</span>
          </div>
        )}
      </div>

      {/* Right sidebar: file tree */}
      <div className="file-tree-sidebar">
        {error && (
          <div className="file-explorer-error">
            <span className="material-symbols-outlined" style={{ fontSize: '1rem' }}>error</span>
            <span>{error}</span>
          </div>
        )}
        {isLoading && rootNodes.length === 0 ? (
          <div className="file-explorer-loading">
            <span style={{ color: 'var(--text-dim)' }}>Loading files...</span>
          </div>
        ) : (
          <div className="file-explorer">
            <FileTree nodes={rootNodes} />
          </div>
        )}
      </div>
    </div>
  );
}
