# File Explorer - Chunk 3: FileNode Component

**Status:** Ready for Execution  
**Scope:** Individual file node component  
**Full Plan:** [FILE_EXPLORER_IMPLEMENTATION_PLAN.md](./FILE_EXPLORER_IMPLEMENTATION_PLAN.md)

---

## Dependencies

- [Chunk 1: Types and Utilities](./FILE_EXPLORER_CHUNK_1.md)
- [Chunk 2: File Store](./FILE_EXPLORER_CHUNK_2.md)

---

## File to Create

- `kimi-ide-client/src/components/file-explorer/FileNode.tsx`

---

## Props

```typescript
interface FileNodeProps {
  node: FileTreeNode;
  depth: number;
  isDisabled?: boolean;
  onClick: () => void;
}
```

---

## Requirements

- Render file icon (from `getFileIcon`)
- Render file name as-is (disk name = display name)
- Apply correct indentation (from `getIndentPadding`)
- Show hover effect
- Disabled state: opacity 0.5, no pointer events
- Click triggers `onClick` callback

---

## Styling (CSS)

```css
.file-node {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.75rem;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.15s ease;
  margin-bottom: 2px;
}

.file-node:hover:not(.disabled) {
  background: var(--bg-tertiary);
}

.file-node.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.file-node .icon {
  font-size: 1.1rem;
  width: 1.5rem;
  text-align: center;
  color: var(--text-secondary);
}

.file-node .label {
  flex: 1;
  font-size: 0.85rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

---

## Test Criteria

- Renders with correct icon for extension
- Shows file name as-is from disk
- Correct indentation at different depths
- Hover effect works
- Disabled state prevents click and grays out
- Click calls onClick handler

---

## Navigation

- Previous: [Chunk 2: File Store](./FILE_EXPLORER_CHUNK_2.md)
- Next: [Chunk 4: FolderNode Component](./FILE_EXPLORER_CHUNK_4.md)

---

*Document created: 2026-03-07*
