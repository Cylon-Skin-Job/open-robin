/**
 * @module file-tree
 * @role Standalone file-tree WebSocket operations
 *
 * Pure send functions — no React hooks. Safe to call from any module.
 * The React listener hook stays in hooks/useFileTree.ts.
 */

import { usePanelStore } from '../state/panelStore';
import { useFileStore } from '../state/fileStore';
import type { FileInfo, FileTreeNode } from '../types/file-explorer';

export function loadRootTree() {
  const ws = usePanelStore.getState().ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  useFileStore.getState().setLoading(true);
  useFileStore.getState().setError(null);
  ws.send(JSON.stringify({
    type: 'file_tree_request',
    panel: 'code-viewer',
  }));
}

export function loadFolderChildren(folderPath: string): Promise<FileTreeNode[]> {
  const ws = usePanelStore.getState().ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error('WebSocket not connected'));
  }

  const cached = useFileStore.getState().getFolderChildren(folderPath);
  if (cached !== undefined) {
    return Promise.resolve(cached);
  }

  return new Promise((resolve, reject) => {
    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'file_tree_response' && msg.path === folderPath) {
          ws.removeEventListener('message', handleMessage);
          if (msg.success) {
            useFileStore.getState().setFolderChildren(folderPath, msg.nodes);
            resolve(msg.nodes);
          } else {
            reject(new Error(msg.error || 'Failed to load folder'));
          }
        }
      } catch {
        // Ignore parse errors
      }
    };

    ws.addEventListener('message', handleMessage);
    ws.send(JSON.stringify({
      type: 'file_tree_request',
      panel: 'code-viewer',
      path: folderPath,
    }));

    setTimeout(() => {
      ws.removeEventListener('message', handleMessage);
      reject(new Error('Timeout loading folder: ' + folderPath));
    }, 5000);
  });
}

export async function loadExpandedFolders(): Promise<void> {
  const ws = usePanelStore.getState().ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  const { expandedFolders, getFolderChildren } = useFileStore.getState();

  const foldersToLoad: string[] = [];
  expandedFolders.forEach((p) => {
    if (getFolderChildren(p) === undefined) {
      foldersToLoad.push(p);
    }
  });

  if (foldersToLoad.length === 0) return;

  await Promise.all(
    foldersToLoad.map(async (p) => {
      try {
        await loadFolderChildren(p);
      } catch (err) {
        console.error(`Failed to load folder ${p}:`, err);
      }
    })
  );
}

export function loadFileContent(file: FileInfo) {
  const ws = usePanelStore.getState().ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  useFileStore.getState().setError(null);
  const { shouldFetch } = useFileStore.getState().openFileTab(file);
  if (!shouldFetch) return;
  ws.send(JSON.stringify({
    type: 'file_content_request',
    panel: 'code-viewer',
    path: file.path,
  }));
}
