# File Explorer - Chunk 7: FileExplorer Container (Tree Mode Only)

**Status:** Ready for Execution  
**Scope:** Main container component, tree mode only  
**Full Plan:** [FILE_EXPLORER_IMPLEMENTATION_PLAN.md](./FILE_EXPLORER_IMPLEMENTATION_PLAN.md)

---

## Dependencies

- [Chunk 1: Types and Utilities](./FILE_EXPLORER_CHUNK_1.md)
- [Chunk 2: File Store](./FILE_EXPLORER_CHUNK_2.md)
- [Chunk 5: FileTree Component](./FILE_EXPLORER_CHUNK_5.md)

---

## File to Create

- `kimi-ide-client/src/components/file-explorer/FileExplorer.tsx`

---

## Requirements

- Read `viewMode` from store
- If `viewMode === 'tree'`: Render FileTree with root nodes
- If `viewMode === 'viewer'`: Show placeholder (stub for later)
- On mount: Load root folder (path '')
- Show loading state while fetching root
- Show error state if root fails to load

---

## Stub Placeholder

```tsx
<div className="file-viewer-stub">
  <p>File viewer coming soon</p>
  <button onClick={closeFile}>Back to tree</button>
</div>
```

---

## Test Criteria

- Initially shows loading state
- Then shows file tree
- Can expand folders
- Can click files (switches to stub viewer)
- Back button returns to tree

---

## Navigation

- Previous: [Chunk 6: FileTreeNode Router](./FILE_EXPLORER_CHUNK_6.md)
- Next: [Chunk 8: WebSocket Integration](./FILE_EXPLORER_CHUNK_8.md)

---

*Document created: 2026-03-07*
