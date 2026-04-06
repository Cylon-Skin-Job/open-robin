import { useEffect, useRef } from 'react';
import { usePanelStore } from '../state/panelStore';
import { useFileStore } from '../state/fileStore';

// Re-export standalone functions so existing imports don't break
import { loadRootTree as _loadRootTree } from '../lib/file-tree';
export { loadRootTree, loadFolderChildren, loadExpandedFolders, loadFileContent } from '../lib/file-tree';

/**
 * Hook: call once in FileExplorer to set up WebSocket listener
 * for root tree and file content responses.
 */
export function useFileTreeListener() {
  const ws = usePanelStore((state) => state.ws);
  const currentPanel = usePanelStore((state) => state.currentPanel);
  const lastWsRef = useRef<WebSocket | null>(null);

  // Listen for file-related WebSocket responses
  useEffect(() => {
    if (!ws) return;

    function handleMessage(event: MessageEvent) {
      try {
        const msg = JSON.parse(event.data);

        // Handle file tree response (root or subfolder)
        if (msg.type === 'file_tree_response') {
          useFileStore.getState().setLoading(false);
          if (msg.success) {
            const path = msg.path || '';
            if (path === '') {
              // Root response
              useFileStore.getState().setRootNodes(msg.nodes);
            } else {
              // Subfolder response - store in folderChildren
              useFileStore.getState().setFolderChildren(path, msg.nodes);
            }
          } else {
            useFileStore.getState().setError(msg.error || 'Failed to load file tree');
          }
        }

        if (msg.type === 'file_content_response' && msg.panel === 'code-viewer') {
          if (msg.success) {
            useFileStore.getState().applyFileContent(msg.path, msg.content, msg.size);
          } else {
            useFileStore.getState().removeTabAfterError(
              msg.path,
              msg.error || 'Failed to load file',
            );
          }
        }
      } catch (_) {
        // Not our message or parse error
      }
    }

    ws.addEventListener('message', handleMessage);
    return () => ws.removeEventListener('message', handleMessage);
  }, [ws]);

  // Load root tree when first connecting or reconnecting.
  // Reset lastWsRef on cleanup so strict-mode remount re-sends the request.
  useEffect(() => {
    if (!ws || currentPanel !== 'code-viewer') return;
    if (ws === lastWsRef.current) return;
    if (ws.readyState !== WebSocket.OPEN) return;

    lastWsRef.current = ws;
    _loadRootTree();

    return () => {
      lastWsRef.current = null;
    };
  }, [ws, currentPanel]);
}
