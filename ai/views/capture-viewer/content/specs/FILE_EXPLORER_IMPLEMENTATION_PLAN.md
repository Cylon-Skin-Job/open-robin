# File Explorer Implementation Plan

**Status:** Ready for Execution  
**Scope:** Client-side UI components and state  
**Protocol:** [FILE_EXPLORER_WEBSOCKET_SPEC.md](./FILE_EXPLORER_WEBSOCKET_SPEC.md) - Claude's domain, already implemented  
**Questions:** [FILE_EXPLORER_UI_QUESTIONS.md](./FILE_EXPLORER_UI_QUESTIONS.md) - Decisions documented here

---

## Architecture Decisions (Locked)

| Topic | Decision |
|-------|----------|
| **Children Storage** | No client cache. Fetch from server every time a folder is expanded. |
| **Non-filesystem workspaces** | Show GUI placeholder (not file explorer) |
| **Empty folder** | Empty folder icon (outline) + no children rendered |
| **Error display** | Grayed out row with X icon, tooltip on hover |
| **Priority** | File picker UI first, file display stubbed |

---

## Implementation Chunks

Each chunk is designed to be:
- Self-contained and testable
- Reasonable size for a Claude loop (~30-60 min)
- Builds on previous chunks

---

### Chunk 1: Types and Utilities

**Files to create:**
- `kimi-ide-client/src/types/file-explorer.ts`
- `kimi-ide-client/src/lib/file-utils.ts`

**Requirements:**

`types/file-explorer.ts`:
```typescript
// Server response type (from WebSocket)
interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  extension?: string;
  hasChildren?: boolean;
}

// Local file info (subset for operations)
interface FileInfo {
  name: string;
  path: string;
  type: 'file' | 'folder';
  extension?: string;
}

// File tree cache - flat map structure
// Key: folder path, Value: children of that folder
type FileTreeCache = Map<string, FileTreeNode[]>;

// Folder state tracking
type ExpandedFolders = Set<string>;  // Set of expanded folder paths
```

`lib/file-utils.ts`:
```typescript
// Icon mapping - semantic icons by file type
const FILE_ICONS: Record<string, string> = { ... };

// Special icons:
// - TypeScript (.ts) → 'bolt'
// - React (.jsx/.tsx) → 'experiment'  
// - CSS/SCSS → 'tag'
// - HTML → 'code'
// - JavaScript → 'javascript'

// Get icon for file extension (and filename for dotfiles like .gitignore)
export function getFileIcon(extension?: string, filename?: string): string;

// Format node name (no change - exact disk name)
export function formatNodeName(name: string): string;

// Calculate indentation padding
export function getIndentPadding(depth: number): string;
```

**Test criteria:**
- Types compile without errors
- `getFileIcon('ts')` returns `'bolt'`
- `getFileIcon('tsx')` returns `'experiment'`
- `getFileIcon('css')` returns `'tag'`
- `getFileIcon('html')` returns `'code'`
- `getFileIcon('md')` returns `'description'`
- `formatNodeName('my-file.md')` returns `'my-file.md'`
- `getIndentPadding(0)` returns `'0.75rem'`, `getIndentPadding(1)` returns `'2rem'`

---

### Chunk 2: File Store (State Only)

**File to create:**
- `kimi-ide-client/src/state/fileStore.ts`

**Requirements:**

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

**Implementation notes:**
- Use Zustand with `create`
- Actions are STUBBED - just update local state, no WebSocket calls yet
- `expandFolder` simply adds path to `expandedFolders` set
- `toggleFolder` expands if collapsed, collapses if expanded
- **No cache** - fetch fresh data from server every time (see Architecture Decision)

**Test criteria:**
- Store initializes with correct defaults
- `expandFolder` adds path to `expandedFolders`
- `collapseFolder` removes path from `expandedFolders`
- `openFile` switches to viewer mode and stores file info
- `closeFile` returns to tree mode
- State updates trigger React re-renders

---

### Chunk 3: FileNode Component

**File to create:**
- `kimi-ide-client/src/components/file-explorer/FileNode.tsx`

**Props:**
```typescript
interface FileNodeProps {
  node: FileTreeNode;
  depth: number;
  isDisabled?: boolean;
  onClick: () => void;
}
```

**Requirements:**
- Render file icon (from `getFileIcon`)
- Render file name as-is (disk name = display name)
- Apply correct indentation (from `getIndentPadding`)
- Show hover effect
- Disabled state: opacity 0.5, no pointer events
- Click triggers `onClick` callback

**Styling (CSS):**
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

**Test criteria:**
- Renders with correct icon for extension
- Shows formatted name
- Correct indentation at different depths
- Hover effect works
- Disabled state prevents click and grays out
- Click calls onClick handler

---

### Chunk 4: FolderNode Component

**File to create:**
- `kimi-ide-client/src/components/file-explorer/FolderNode.tsx`

**Props:**
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

**Requirements:**
- Render folder icon based on state:
  - Collapsed + hasChildren: `folder` (filled)
  - Collapsed + !hasChildren: `folder` (outline)
  - Expanded: `folder_open`
- Show folder name (exact disk name, no formatting)
- Correct indentation
- Click toggles expand/collapse
- Loading state: Show spinner icon or "..."
- Error state: Grayed out + X icon with tooltip on hover

**Styling (CSS):**
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

**Test criteria:**
- Shows filled icon when hasChildren=true and collapsed
- Shows outline icon when hasChildren=false and collapsed
- Shows folder_open when expanded
- Click calls onToggle
- Loading state visible
- Error state shows X icon and tooltip on hover

---

### Chunk 5: FileTree Component

**File to create:**
- `kimi-ide-client/src/components/file-explorer/FileTree.tsx`

**Props:**
```typescript
interface FileTreeProps {
  path: string;           // Current folder path
  nodes: FileTreeNode[];  // Nodes to render
  depth?: number;         // Starting depth (default 0)
}
```

**Requirements:**
- Map through nodes and render either FileNode or FolderNode
- For folders: Check if expanded in store, render children recursively if so
- Children are passed via `nodes` prop from parent (fetched fresh from server each time)
- Pass correct depth to children
- Handle empty folder (no children to render)

**Structure:**
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

**Test criteria:**
- Renders files and folders
- Expanded folders show children
- Collapsed folders hide children
- Correct indentation nesting
- Empty folders show nothing when expanded

---

### Chunk 6: FileTreeNode Router

**File to create:**
- `kimi-ide-client/src/components/file-explorer/FileTreeNode.tsx`

**Purpose:** Thin router component that decides FileNode vs FolderNode

**Props:** Same as FileTree for a single node

**Requirements:**
- Read from store: expanded state, loading state, error state
- Render FileNode or FolderNode based on node.type
- Connect onClick handlers to store actions

**Note:** This could be merged into FileTree, but separate router keeps FileTree clean

---

### Chunk 7: FileExplorer Container (Tree Mode Only)

**File to create:**
- `kimi-ide-client/src/components/file-explorer/FileExplorer.tsx`

**Requirements:**
- Read `viewMode` from store
- If `viewMode === 'tree'`: Render FileTree with root nodes
- If `viewMode === 'viewer'`: Show placeholder (stub for later)
- On mount: Load root folder (path '')
- Show loading state while fetching root
- Show error state if root fails to load

**Stub placeholder:**
```tsx
<div className="file-viewer-stub">
  <p>File viewer coming soon</p>
  <button onClick={closeFile}>Back to tree</button>
</div>
```

**Test criteria:**
- Initially shows loading state
- Then shows file tree
- Can expand folders
- Can click files (switches to stub viewer)
- Back button returns to tree

---

### Chunk 8: WebSocket Integration

**Files to modify:**
- `kimi-ide-client/src/components/file-explorer/FileExplorer.tsx` - Fetch on expand
- `kimi-ide-client/src/hooks/useWebSocket.ts` - Add message handlers

**Requirements:**

In `FileExplorer.tsx`:
- When user expands a folder:
  1. Set loading state
  2. Send WebSocket message: `{ type: 'file_tree_request', workspace: 'code', path }`
  3. On response: Store children in local component state, expand folder
  4. On error: Show error state

- When user opens a file:
  1. Set loading state
  2. Send WebSocket message: `{ type: 'file_content_request', workspace: 'code', path: file.path }`
  3. On response: Call `fileStore.openFile(file, content)` to switch to viewer
  4. On error: Show error state

**No cache** - Fetch fresh data every time a folder is expanded.

In `useWebSocket.ts`:
- Handle `file_tree_response`: Pass children to FileExplorer component
- Handle `file_content_response`: Pass content to FileExplorer component
- Handle errors: Set error state in FileExplorer

**WebSocket message format:**
```typescript
// Send
{ type: 'file_tree_request', workspace: 'code', path }
{ type: 'file_content_request', workspace: 'code', path: file.path }

// Receive (already implemented by Claude)
{ type: 'file_tree_response', workspace, path, success, nodes }
{ type: 'file_content_response', workspace, path, success, content, size, lastModified }
```

**Test criteria:**
- Expanding folder sends WebSocket message
- Response displays children in tree
- Opening file sends WebSocket message
- File content received and displayed in viewer
- Errors displayed correctly
- Re-expanding a folder re-fetches fresh data

---

### Chunk 9: ContentArea Integration

**Files to modify:**
- `kimi-ide-client/src/components/ContentArea.tsx` (or wherever content area is)

**Requirements:**
- Import FileExplorer
- Only show for `code` workspace
- For other workspaces, show placeholder (GUI coming soon)
- FileExplorer takes full content area

**Test criteria:**
- Switching to code workspace shows file explorer
- Switching to wiki shows placeholder
- File explorer renders and works

---

### Chunk 10: File Display (Deferred)

**Files to create (stub only):**
- `kimi-ide-client/src/components/file-explorer/FileViewer.tsx`
- `kimi-ide-client/src/components/file-explorer/FileContentRenderer.tsx`

**Requirements:**
- Basic working version that shows:
  - Back button
  - File name
  - Raw content in `<pre>` tag
- Full rendering (markdown, syntax highlighting) deferred

---

## Execution Order

```
Chunk 1: Types & Utils
    ↓
Chunk 2: File Store (stubbed actions)
    ↓
Chunk 3: FileNode
    ↓
Chunk 4: FolderNode
    ↓
Chunk 5: FileTree
    ↓
Chunk 6: FileTreeNode (optional - can merge with FileTree)
    ↓
Chunk 7: FileExplorer Container
    ↓
Chunk 8: WebSocket Integration (requires Claude's server to be ready)
    ↓
Chunk 9: ContentArea Integration
    ↓
Chunk 10: File Display (basic version)
```

---

## Notes for Claude Implementation

- Each chunk should be testable standalone
- Use existing project patterns (Zustand, CSS structure)
- Import types from `types/file-explorer.ts` in all components
- Components are read-only, no mutations
- Error states: Grayed out with X icon, tooltip on hover
- Styling: Match existing Tron/cyan theme (use CSS variables)

---

*Document created: 2026-03-07*  
*Ready for chunk-by-chunk implementation*
