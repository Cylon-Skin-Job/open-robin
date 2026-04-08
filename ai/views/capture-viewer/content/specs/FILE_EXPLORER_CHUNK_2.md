# File Explorer - Chunk 2: File Store (State Only)

**Status:** Ready for Execution  
**Scope:** Zustand store for file explorer state (stubbed actions)  
**Full Plan:** [FILE_EXPLORER_IMPLEMENTATION_PLAN.md](./FILE_EXPLORER_IMPLEMENTATION_PLAN.md)

---

## Dependencies

- [Chunk 1: Types and Utilities](./FILE_EXPLORER_CHUNK_1.md) - Must be complete

---

## File to Create

- `kimi-ide-client/src/state/fileStore.ts`

---

## Requirements

```typescript
interface FileState {
  // View state
  viewMode: 'tree' | 'viewer';
  selectedFile: FileInfo | null;
  fileContent: string;

  // Tree state
  rootNodes: FileTreeNode[];
  expandedFolders: Set<string>;

  // Pending file request (set before WS request, consumed on response)
  pendingFile: FileInfo | null;

  // Loading / error
  isLoading: boolean;
  error: string | null;

  // Actions
  setRootNodes: (nodes: FileTreeNode[]) => void;
  setPendingFile: (file: FileInfo | null) => void;
  expandFolder: (path: string) => void;
  collapseFolder: (path: string) => void;
  toggleFolder: (path: string) => void;
  openFile: (file: FileInfo, content: string) => void;
  closeFile: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}
```

---

## Implementation Notes

- Use Zustand with `create`
- **Actions are STUBBED** - just update local state, no WebSocket calls yet
- `expandFolder` simply adds path to `expandedFolders` set
- `toggleFolder` expands if collapsed, collapses if expanded
- **No cache** - fetch fresh data from server every time (see Architecture Decision)

---

## Test Criteria

- Store initializes with correct defaults
- `expandFolder` adds path to `expandedFolders`
- `collapseFolder` removes path from `expandedFolders`
- `openFile` switches to viewer mode and stores file info
- `closeFile` returns to tree mode
- State updates trigger React re-renders

---

## Navigation

- Previous: [Chunk 1: Types and Utilities](./FILE_EXPLORER_CHUNK_1.md)
- Next: [Chunk 3: FileNode Component](./FILE_EXPLORER_CHUNK_3.md)

---

*Document created: 2026-03-07*
