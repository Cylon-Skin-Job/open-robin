# File Explorer - Chunk 4: FolderNode Component

**Status:** Ready for Execution  
**Scope:** Individual folder node component with expand/collapse  
**Full Plan:** [FILE_EXPLORER_IMPLEMENTATION_PLAN.md](./FILE_EXPLORER_IMPLEMENTATION_PLAN.md)

---

## Dependencies

- [Chunk 1: Types and Utilities](./FILE_EXPLORER_CHUNK_1.md)
- [Chunk 2: File Store](./FILE_EXPLORER_CHUNK_2.md)

---

## File to Create

- `kimi-ide-client/src/components/file-explorer/FolderNode.tsx`

---

## Props

```typescript
interface FolderNodeProps {
  node: FileTreeNode;
  depth: number;
  isExpanded: boolean;
  isLoading?: boolean;
  hasError?: boolean;
  errorMessage?: string;
  onToggle: () => void;
}
```

---

## Requirements

- Render folder icon based on state:
  - Collapsed + hasChildren: `folder` (filled)
  - Collapsed + !hasChildren: `folder` (outline)
  - Expanded: `folder_open`
- Show folder name (exact disk name, no formatting)
- Correct indentation
- Click toggles expand/collapse
- Loading state: Show spinner icon or "..."
- Error state: Grayed out + X icon with tooltip on hover

---

## Styling (CSS)

```css
.folder-node {
  /* Same base as file-node */
}

.folder-node .icon {
  /* Same as file-node */
}

.folder-node .icon.folder-filled {
  font-variation-settings: 'FILL' 1;
}

.folder-node .icon.folder-outline {
  font-variation-settings: 'FILL' 0;
}

.folder-node .icon.error-x {
  color: var(--error-color, #ef4444);
}

.folder-node .error-tooltip {
  /* Position absolute tooltip */
}
```

---

## Test Criteria

- Shows filled icon when hasChildren=true and collapsed
- Shows outline icon when hasChildren=false and collapsed
- Shows folder_open when expanded
- Click calls onToggle
- Loading state visible
- Error state shows X icon and tooltip on hover

---

## Navigation

- Previous: [Chunk 3: FileNode Component](./FILE_EXPLORER_CHUNK_3.md)
- Next: [Chunk 5: FileTree Component](./FILE_EXPLORER_CHUNK_5.md)

---

*Document created: 2026-03-07*
