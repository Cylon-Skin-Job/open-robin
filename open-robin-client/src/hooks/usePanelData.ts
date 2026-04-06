/**
 * @module usePanelData
 * @role Generic WebSocket data loader for any panel
 * @reads index.json (or custom indexPath) via file_content_request
 *
 * Replaces useWikiData, useAgentData, useTicketData with one hook.
 * Uses object identity check (lastWsRef) for reconnect handling —
 * the pattern proven in useFileTree.ts.
 */

import { useEffect, useRef, useCallback } from 'react';
import { usePanelStore } from '../state/panelStore';

interface UsePanelDataOptions {
  /** Panel ID (folder name in ai/views/) */
  panel: string;
  /** Path to the index file to load on connect (default: 'index.json') */
  indexPath?: string;
  /** Called when index file content arrives */
  onIndex?: (content: string) => void;
  /** Called when any file_content_response arrives for this panel */
  onFileContent?: (path: string, content: string) => void;
  /** Called on error responses */
  onError?: (error: string, path: string) => void;
}

/**
 * Generic panel data hook.
 *
 * Sets up a WebSocket listener filtered by panel ID,
 * loads the index file on first connect and after reconnect,
 * and provides a `request(path)` function for loading additional files.
 */
export function usePanelData({
  panel,
  indexPath = 'index.json',
  onIndex,
  onFileContent,
  onError,
}: UsePanelDataOptions) {
  const ws = usePanelStore((state) => state.ws);
  const lastWsRef = useRef<WebSocket | null>(null);

  // Listen for file_content_response messages for this panel
  useEffect(() => {
    if (!ws) return;

    function handleMessage(event: MessageEvent) {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type !== 'file_content_response' || msg.panel !== panel) return;

        if (!msg.success) {
          onError?.(msg.error || 'Failed to load content', msg.path || '');
          return;
        }

        // Index file response
        if (msg.path === indexPath) {
          onIndex?.(msg.content);
          return;
        }

        // Any other file response
        onFileContent?.(msg.path, msg.content);
      } catch { /* ignore parse errors */ }
    }

    ws.addEventListener('message', handleMessage);
    return () => ws.removeEventListener('message', handleMessage);
  }, [ws, panel, indexPath, onIndex, onFileContent, onError]);

  // Load index on first connect and after reconnect.
  // Reset lastWsRef on cleanup so strict-mode remount re-sends the request.
  useEffect(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (ws === lastWsRef.current) return;
    lastWsRef.current = ws;
    ws.send(JSON.stringify({
      type: 'file_content_request',
      panel,
      path: indexPath,
    }));

    return () => {
      lastWsRef.current = null;
    };
  }, [ws, panel, indexPath]);

  // Request any file from this panel
  const request = useCallback((path: string) => {
    const socket = usePanelStore.getState().ws;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
      type: 'file_content_request',
      panel,
      path,
    }));
  }, [panel]);

  return { request };
}
