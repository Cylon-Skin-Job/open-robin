# File Explorer - Chunk 6: FileTreeNode Router

**Status:** Ready for Execution  
**Scope:** Thin router component that decides FileNode vs FolderNode  
**Full Plan:** [FILE_EXPLORER_IMPLEMENTATION_PLAN.md](./FILE_EXPLORER_IMPLEMENTATION_PLAN.md)

---

## Dependencies

- [Chunk 1: Types and Utilities](./FILE_EXPLORER_CHUNK_1.md)
- [Chunk 2: File Store](./FILE_EXPLORER_CHUNK_2.md)
- [Chunk 3: FileNode Component](./FILE_EXPLORER_CHUNK_3.md)
- [Chunk 4: FolderNode Component](./FILE_EXPLORER_CHUNK_4.md)
- [Chunk 5: FileTree Component](./FILE_EXPLORER_CHUNK_5.md)

---

## File to Create

- `kimi-ide-client/src/components/file-explorer/FileTreeNode.tsx`

---

## Purpose

Thin router component that decides whether to render FileNode or FolderNode based on node type.

---

## Props

Same as FileTree for a single node:

```typescript
interface FileTreeNodeProps {
  node: FileTreeNode;
  depth: number;
}
```

---

## Requirements

- Read from store: expanded state, loading state, error state
- Render FileNode or FolderNode based on node.type
- Connect onClick handlers to store actions

---

## Notes

This could be merged into FileTree, but separate router keeps FileTree clean and focused on recursion logic.

---

## Navigation

- Previous: [Chunk 5: FileTree Component](./FILE_EXPLORER_CHUNK_5.md)
- Next: [Chunk 7: FileExplorer Container](./FILE_EXPLORER_CHUNK_7.md)

---

*Document created: 2026-03-07*
