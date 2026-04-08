# File Explorer - Chunk 5: FileTree Component

**Status:** Ready for Execution  
**Scope:** Recursive tree component that renders nodes  
**Full Plan:** [FILE_EXPLORER_IMPLEMENTATION_PLAN.md](./FILE_EXPLORER_IMPLEMENTATION_PLAN.md)

---

## Dependencies

- [Chunk 1: Types and Utilities](./FILE_EXPLORER_CHUNK_1.md)
- [Chunk 2: File Store](./FILE_EXPLORER_CHUNK_2.md)
- [Chunk 3: FileNode Component](./FILE_EXPLORER_CHUNK_3.md)
- [Chunk 4: FolderNode Component](./FILE_EXPLORER_CHUNK_4.md)

---

## File to Create

- `kimi-ide-client/src/components/file-explorer/FileTree.tsx`

---

## Props

```typescript
interface FileTreeProps {
  path: string;           // Current folder path
  nodes: FileTreeNode[];  // Nodes to render
  depth?: number;         // Starting depth (default 0)
}
```

---

## Requirements

- Map through nodes and render either FileNode or FolderNode
- For folders: Check if expanded in store, render children recursively if so
- Children are passed via `nodes` prop from parent (fetched fresh from server each time)
- Pass correct depth to children
- Handle empty folder (no children to render)

---

## Structure

```tsx
<div className="file-tree">
  {nodes.map(node => (
    node.type === 'folder' ? (
      <div key={node.path}>
        <FolderNode 
          node={node} 
          depth={depth} 
          isExpanded={expandedFolders.has(node.path)}
          onToggle={() => toggleFolder(node.path)}
        />
        {expandedFolders.has(node.path) && (
          <div className="folder-children">
            <FileTree 
              path={node.path}
              nodes={folderChildren}  // Passed from parent after fetch
              depth={depth + 1}
            />
          </div>
        )}
      </div>
    ) : (
      <FileNode 
        key={node.path}
        node={node}
        depth={depth}
        onClick={() => openFile(node)}
      />
    )
  ))}
</div>
```

---

## Test Criteria

- Renders files and folders
- Expanded folders show children
- Collapsed folders hide children
- Correct indentation nesting
- Empty folders show nothing when expanded

---

## Navigation

- Previous: [Chunk 4: FolderNode Component](./FILE_EXPLORER_CHUNK_4.md)
- Next: [Chunk 6: FileTreeNode Router](./FILE_EXPLORER_CHUNK_6.md)

---

*Document created: 2026-03-07*
