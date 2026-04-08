/**
 * @module file-handlers
 * @role Handle file-related WebSocket messages (cache invalidation, live updates).
 *
 * Extracted from ws-client.ts (spec 05b) so file logic is isolated.
 */

import { usePanelStore } from '../../state/panelStore';
import { useActiveResourceStore } from '../../state/activeResourceStore';
import { useFileDataStore } from '../../state/fileDataStore';
import { showToast } from '../toast';
import type { WebSocketMessage } from '../../types';

/**
 * Handle file-related WebSocket messages.
 * Returns true if the message was handled, false if not recognized.
 */
export function handleFileMessage(msg: WebSocketMessage): boolean {
  switch (msg.type) {
    case 'file_changed': {
      // Invalidate central cache — triggers re-fetch for affected entries
      const fileData = useFileDataStore.getState();
      const changedPath = (msg as any).filePath || '';
      const changedPanel = (msg as any).panel;
      if (changedPanel && changedPath) {
        fileData.invalidate(changedPanel, changedPath);
      }

      // Also re-fetch if the active resource matches (page view live update)
      const activeRes = useActiveResourceStore.getState().activeResource;
      if (activeRes && changedPath.endsWith(activeRes.relativePath)) {
        const store = usePanelStore.getState();
        const ws = store.ws;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'file_content_request',
            panel: activeRes.panel,
            path: activeRes.relativePath,
          }));
        }
      }
      return true;
    }

    // --- Central file data cache population ---
    case 'file_tree_response': {
      const m = msg as any;
      if (m.panel && m.path) {
        useFileDataStore.getState().handleTreeResponse(m.panel, m.path, m.nodes || []);
      }
      return true;
    }

    case 'file_content_response': {
      const m = msg as any;
      if (m.panel && m.path && m.success) {
        useFileDataStore.getState().handleContentResponse(m.panel, m.path, m.content || '');
      }
      return true;
    }

    case 'file:moved':
      console.log('[WS] File moved:', msg);
      return true;

    case 'file:move_error':
      showToast(`File move failed: ${(msg as any).error}`);
      return true;

    default:
      return false;
  }
}
