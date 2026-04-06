import { create } from 'zustand';
import type { FileTreeNode, FileInfo, EditorTab } from '../types/file-explorer';

interface FileState {
  viewMode: 'tree' | 'viewer';
  tabs: EditorTab[];
  activeTabPath: string | null;

  rootNodes: FileTreeNode[];
  expandedFolders: Set<string>;
  folderChildren: Map<string, FileTreeNode[]>;

  isLoading: boolean;
  error: string | null;

  setRootNodes: (nodes: FileTreeNode[]) => void;
  expandFolder: (path: string) => void;
  collapseFolder: (path: string) => void;
  toggleFolder: (path: string) => void;
  setFolderChildren: (path: string, children: FileTreeNode[]) => void;
  getFolderChildren: (path: string) => FileTreeNode[] | undefined;

  /** Add or focus tab; returns whether to send file_content_request. */
  openFileTab: (file: FileInfo) => { shouldFetch: boolean };
  applyFileContent: (path: string, content: string, size: number) => void;
  removeTabAfterError: (path: string, message: string) => void;
  setActiveTab: (path: string) => void;
  /** Move active tab by delta (-1 = previous in strip, +1 = next). Wraps at ends. */
  activateAdjacentTab: (delta: -1 | 1) => void;
  closeTab: (path: string) => void;
  closeActiveTab: () => void;

  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

/** After removing the tab that was at `closedIdx`, prefer the tab to the left (reading order). */
function pickActiveAfterClose(newTabs: EditorTab[], closedIdx: number): string {
  const left = newTabs[closedIdx - 1];
  if (left) return left.file.path;
  return newTabs[closedIdx]!.file.path;
}

export const useFileStore = create<FileState>((set, get) => ({
  viewMode: 'tree',
  tabs: [],
  activeTabPath: null,
  rootNodes: [],
  expandedFolders: new Set(),
  folderChildren: new Map(),
  isLoading: false,
  error: null,

  setRootNodes: (nodes) => set({ rootNodes: nodes }),

  expandFolder: (path) => set((state) => {
    const next = new Set(state.expandedFolders);
    next.add(path);
    return { expandedFolders: next };
  }),

  collapseFolder: (path) => set((state) => {
    const next = new Set(state.expandedFolders);
    next.delete(path);
    return { expandedFolders: next };
  }),

  setFolderChildren: (path, children) => set((state) => {
    const next = new Map(state.folderChildren);
    next.set(path, children);
    return { folderChildren: next };
  }),

  getFolderChildren: (path) => get().folderChildren.get(path),

  toggleFolder: (path) => {
    const { expandedFolders } = get();
    if (expandedFolders.has(path)) {
      get().collapseFolder(path);
    } else {
      get().expandFolder(path);
    }
  },

  openFileTab: (file) => {
    const state = get();
    const path = file.path;
    const existingIdx = state.tabs.findIndex((t) => t.file.path === path);

    if (existingIdx !== -1) {
      const tabs = [...state.tabs];
      const [tab] = tabs.splice(existingIdx, 1);
      tabs.unshift(tab);
      set({
        tabs,
        activeTabPath: path,
        viewMode: 'viewer',
        error: null,
      });
      return { shouldFetch: false };
    }

    const newTab: EditorTab = {
      file,
      content: '',
      size: 0,
      loading: true,
    };
    set({
      tabs: [...state.tabs, newTab],
      activeTabPath: path,
      viewMode: 'viewer',
      error: null,
    });
    return { shouldFetch: true };
  },

  applyFileContent: (path, content, size) => set((state) => ({
    tabs: state.tabs.map((t) =>
      t.file.path === path ? { ...t, content, size, loading: false } : t,
    ),
    error: null,
  })),

  removeTabAfterError: (path, message) => set((state) => {
    const closedIdx = state.tabs.findIndex((t) => t.file.path === path);
    if (closedIdx === -1) return { error: message };
    const wasActive = state.activeTabPath === path;
    const newTabs = state.tabs.filter((t) => t.file.path !== path);
    if (newTabs.length === 0) {
      return {
        tabs: [],
        activeTabPath: null,
        viewMode: 'tree',
        error: message,
      };
    }
    let activeTabPath = state.activeTabPath;
    if (wasActive) {
      activeTabPath = pickActiveAfterClose(newTabs, closedIdx);
    }
    return {
      tabs: newTabs,
      activeTabPath,
      viewMode: 'viewer',
      error: message,
    };
  }),

  setActiveTab: (path) => set((state) => {
    if (!state.tabs.some((t) => t.file.path === path)) return {};
    return { activeTabPath: path };
  }),

  activateAdjacentTab: (delta) => set((state) => {
    const { tabs, activeTabPath } = state;
    if (tabs.length === 0) return {};
    const idx = tabs.findIndex((t) => t.file.path === activeTabPath);
    if (idx === -1) return {};
    const nextIdx = idx + delta;
    if (nextIdx < 0 || nextIdx >= tabs.length) return {};
    return { activeTabPath: tabs[nextIdx].file.path };
  }),

  closeTab: (path) => set((state) => {
    const closedIdx = state.tabs.findIndex((t) => t.file.path === path);
    if (closedIdx === -1) return {};
    const wasActive = state.activeTabPath === path;
    const newTabs = state.tabs.filter((t) => t.file.path !== path);
    if (newTabs.length === 0) {
      return {
        tabs: [],
        activeTabPath: null,
        viewMode: 'tree',
        error: null,
      };
    }
    let activeTabPath = state.activeTabPath;
    if (wasActive) {
      activeTabPath = pickActiveAfterClose(newTabs, closedIdx);
    }
    return {
      tabs: newTabs,
      activeTabPath,
      viewMode: 'viewer',
      error: null,
    };
  }),

  closeActiveTab: () => {
    const { activeTabPath } = get();
    if (!activeTabPath) return;
    get().closeTab(activeTabPath);
  },

  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),

  reset: () => set({
    viewMode: 'tree',
    tabs: [],
    activeTabPath: null,
    rootNodes: [],
    expandedFolders: new Set(),
    folderChildren: new Map(),
    isLoading: false,
    error: null,
  }),
}));
