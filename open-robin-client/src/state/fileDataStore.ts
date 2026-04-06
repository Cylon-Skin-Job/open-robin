/**
 * @module fileDataStore
 * @role Central cache for file trees and file content across all workspaces
 *
 * Single source of truth for file data fetched via WebSocket.
 * Components read from this store instead of managing their own WS listeners.
 *
 * Cache keys: "${panel}:${path}" for both trees and content.
 * Invalidation: file_changed events clear the affected entries and re-fetch.
 */

import { create } from 'zustand';
import { usePanelStore } from './panelStore';

// --- Types ---

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  extension?: string;
}

export interface FileWithContent extends FileNode {
  content: string;
}

// --- Store ---

interface FileDataState {
  /** Cached file tree listings: key = "panel:folder" */
  trees: Record<string, FileNode[]>;
  /** Cached file content: key = "panel:path" */
  contents: Record<string, string>;
  /** In-flight tree requests (prevents duplicate sends) */
  pendingTrees: Set<string>;
  /** In-flight content requests (prevents duplicate sends) */
  pendingContents: Set<string>;

  // --- Actions called by ws-client ---
  handleTreeResponse: (panel: string, path: string, nodes: FileNode[]) => void;
  handleContentResponse: (panel: string, path: string, content: string) => void;

  // --- Actions called by components ---
  requestTree: (panel: string, folder: string) => void;
  requestContent: (panel: string, path: string) => void;

  // --- Invalidation (called by file_changed handler) ---
  invalidate: (panel: string, filePath: string) => void;

  // --- Full reset (e.g. on reconnect) ---
  clearAll: () => void;
}

function cacheKey(panel: string, path: string): string {
  return `${panel}:${path}`;
}

function sendWs(msg: Record<string, unknown>) {
  const ws = usePanelStore.getState().ws;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export const useFileDataStore = create<FileDataState>((set, get) => ({
  trees: {},
  contents: {},
  pendingTrees: new Set(),
  pendingContents: new Set(),

  handleTreeResponse: (panel, path, nodes) => {
    const key = cacheKey(panel, path);
    set((s) => {
      const pending = new Set(s.pendingTrees);
      pending.delete(key);
      return {
        trees: { ...s.trees, [key]: nodes },
        pendingTrees: pending,
      };
    });
  },

  handleContentResponse: (panel, path, content) => {
    const key = cacheKey(panel, path);
    set((s) => {
      const pending = new Set(s.pendingContents);
      pending.delete(key);
      return {
        contents: { ...s.contents, [key]: content },
        pendingContents: pending,
      };
    });
  },

  requestTree: (panel, folder) => {
    const key = cacheKey(panel, folder);
    const state = get();
    // Already cached or in-flight — skip
    if (state.trees[key] || state.pendingTrees.has(key)) return;
    set((s) => {
      const pending = new Set(s.pendingTrees);
      pending.add(key);
      return { pendingTrees: pending };
    });
    sendWs({ type: 'file_tree_request', panel, path: folder });
  },

  requestContent: (panel, path) => {
    const key = cacheKey(panel, path);
    const state = get();
    if (state.contents[key] !== undefined || state.pendingContents.has(key)) return;
    set((s) => {
      const pending = new Set(s.pendingContents);
      pending.add(key);
      return { pendingContents: pending };
    });
    sendWs({ type: 'file_content_request', panel, path });
  },

  invalidate: (panel, filePath) => {
    const state = get();
    const contentKey = cacheKey(panel, filePath);
    const treesToInvalidate: string[] = [];

    // Find which tree folders contain this file
    for (const key of Object.keys(state.trees)) {
      if (!key.startsWith(`${panel}:`)) continue;
      const folder = key.slice(panel.length + 1);
      // If the file is in this folder, invalidate the tree
      if (filePath.startsWith(folder + '/') || filePath === folder) {
        treesToInvalidate.push(key);
      }
    }

    set((s) => {
      const trees = { ...s.trees };
      const contents = { ...s.contents };
      for (const key of treesToInvalidate) {
        delete trees[key];
      }
      delete contents[contentKey];
      return { trees, contents };
    });

    // Re-fetch invalidated trees
    for (const key of treesToInvalidate) {
      const folder = key.slice(panel.length + 1);
      get().requestTree(panel, folder);
    }

    // Re-fetch content if it was cached
    if (state.contents[contentKey] !== undefined) {
      get().requestContent(panel, filePath);
    }
  },

  clearAll: () => set({
    trees: {},
    contents: {},
    pendingTrees: new Set(),
    pendingContents: new Set(),
  }),
}));
