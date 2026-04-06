# File Explorer SPEC

**Read-only file tree for the content area.**  
**Protocol:** [FILE_EXPLORER_WEBSOCKET_SPEC.md](./FILE_EXPLORER_WEBSOCKET_SPEC.md) - WebSocket message definitions

---

## Overview

The File Explorer is a read-only, collapsible tree view that displays in the content area. Folders expand/collapse in place to reveal their contents. Clicking a file opens it in full-screen file viewer mode with a back button to return to the tree.

All file mutations (create, move, delete, rename) are handled externally via CLI - the explorer only reads and displays.

---

## End UX

### Tree View (Content Area)

```
┌─────────────────────────────────────────────────────────────┐
│  wiki / docs / architecture                                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  📂 assets  ▼                                               │
│    📄 images.md                                             │
│    📄 diagrams.png                                          │
│                                                             │
│  📁 components  ▶                                           │
│                                                             │
│  📄 README.md                                               │
│  📄 SPEC.md                                                 │
│  📄 TODO.md                                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Behavior:**
- **Folder click**: Expands/collapses in place (▼ = expanded, ▶ = collapsed)
- **File click**: Opens file viewer full-screen
- **Indentation**: Each level indents 1.25rem deeper
- **Path breadcrumb**: Shows current location at top (optional)

**Folder Icon States:**
| State | Icon | Meaning |
|-------|------|---------|
| Collapsed with contents | `folder` (filled) | Can expand |
| Collapsed empty | `folder` (outline) | Empty, can still expand |
| Expanded | `folder_open` | Currently showing children |

*Note: `hasChildren` boolean from server determines filled vs outline.*

### File Viewer View

```
┌─────────────────────────────────────────────────────────────┐
│  ←  README.md                                               │
│                                                             │
│  # Project Title                                            │
│                                                             │
│  Content rendered here...                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Behavior:**
- **Back button**: `arrow_back` icon at top-left of content area, returns to tree view
- **File name**: Shown next to back button
- **No header bar**: Transparent, no border line, integrated into content area top margin
- **NOT in main app header**: This lives entirely within the content area
- **Loading state**: UI grays out/disables controls while fetching file content

---

## Architecture

### Component Hierarchy

```
ContentArea
└── FileExplorer (new)
    ├── FileTreeHeader (optional breadcrumb)
    └── FileTree (tree view)
        └── FileTreeNode[] (recursive)
            ├── FolderNode (expandable)
            │   ├── FolderHeader (icon + name + expand/collapse)
            │   └── FolderChildren (indented child nodes)
            └── FileNode (clickable)
    └── FileViewer (when viewing file)
        ├── FileViewerHeader (back button + filename)
        └── FileContentRenderer
```

### State Management

**Zustand Store Additions** (`state/fileStore.ts`):

```typescript
interface FileState {
  // Current view state
  viewMode: 'tree' | 'viewer';     // 'tree' = show file tree, 'viewer' = show file content
  selectedFile: FileInfo | null;   // Currently viewing file
  expandedFolders: Set<string>;    // Set of expanded folder paths
  isLoading: boolean;              // Loading state for operations
  
  // File tree cache (one level only - no nested children stored)
  fileTree: FileTreeNode[];        // Current folder contents only
  currentPath: string;             // Current folder path (default: '')
  
  // Actions
  expandFolder: (path: string) => Promise<void>;      // Fetches children
  collapseFolder: (path: string) => void;
  toggleFolder: (path: string) => Promise<void>;
  openFile: (file: FileInfo) => Promise<void>;        // Fetches content
  closeFile: () => void;                              // Return to tree view
  refreshFiles: () => Promise<void>;
}
```

### Data Types

```typescript
// types/file-explorer.ts

// From WebSocket server
interface FileTreeNode {
  name: string;              // Filename on disk
  path: string;              // Full relative path from workspace root
  type: 'file' | 'folder';
  extension?: string;        // Normalized, lowercase (from server)
  hasChildren?: boolean;     // True if folder has contents (from server)
}

// Local file info (extends server type)
interface FileInfo {
  name: string;
  path: string;
  type: 'file' | 'folder';
  extension?: string;
}

// Icon mapping by extension (client-side display logic)
const FILE_ICONS: Record<string, string> = {
  // Default
  'default': 'article',
  
  // Code
  'js': 'javascript',
  'jsx': 'javascript',
  'ts': 'typescript', 
  'tsx': 'typescript',
  'json': 'data_object',
  'css': 'style',
  'scss': 'style',
  'html': 'html',
  'htm': 'html',
  
  // Docs
  'md': 'description',
  'mdx': 'description',
  'txt': 'text_snippet',
  
  // Config
  'yml': 'settings',
  'yaml': 'settings',
  'toml': 'settings',
  'env': 'key',
  
  // Media
  'png': 'image',
  'jpg': 'image',
  'jpeg': 'image',
  'gif': 'image',
  'svg': 'image',
  'mp4': 'videocam',
  'mov': 'videocam',
  
  // Data
  'csv': 'table',
  'sql': 'database',
};
```

---

## Component Specifications

### FileExplorer

**Role**: Main container. Switches between tree view and file viewer.

**Props**: None (reads from store)

**Behavior**:
- On mount: Load file tree for current workspace (only if `code` workspace)
- Renders either `FileTree` or `FileViewer` based on `viewMode`
- Shows empty state or placeholder for non-filesystem workspaces (wiki, rocket, etc.)

### FileTree

**Role**: Renders the root of the file tree.

**Props**:
```typescript
interface FileTreeProps {
  nodes: FileTreeNode[];
  depth?: number;  // Starting depth (default 0)
}
```

**Behavior**:
- Maps nodes to `FileTreeNode` components
- Root level has no indentation
- Shows loading spinner when `isLoading` true

### FileTreeNode

**Role**: Renders either a FolderNode or FileNode based on type.

**Props**:
```typescript
interface FileTreeNodeProps {
  node: FileTreeNode;
  depth: number;
}
```

**Behavior**:
- If `node.type === 'folder'`: Render `FolderNode`
- If `node.type === 'file'`: Render `FileNode`

### FolderNode

**Role**: Expandable folder with header and collapsible children.

**Props**:
```typescript
interface FolderNodeProps {
  node: FileTreeNode;
  depth: number;
}
```

**Behavior**:
- **Click header**: Toggles expand/collapse
  - If expanding: Fetches children via WebSocket (`file_tree_request`)
  - Sets `isLoading` true during fetch, false after
- **Expanded state**: Stored in `fileStore.expandedFolders`
- **Icon**:
  - Collapsed with `hasChildren: true`: `folder` (filled)
  - Collapsed with `hasChildren: false`: `folder` (outline style)
  - Expanded: `folder_open`
- **Indentation**: `paddingLeft: ${0.75 + depth * 1.25}rem`

**Structure**:
```
<div class="folder-node">
  <div class="folder-header">     <!-- Click to toggle -->
    <span class="folder-icon">
      <!-- filled if hasChildren, outline if empty -->
    </span>
    <span class="folder-name">folder-name-on-disk</span>
  </div>
  <div class="folder-children">   <!-- Shown when expanded -->
    <FileTree nodes={children} depth={depth + 1} />
  </div>
</div>
```

### FileNode

**Role**: Clickable file that opens the file viewer.

**Props**:
```typescript
interface FileNodeProps {
  node: FileTreeNode;
  depth: number;
}
```

**Behavior**:
- **Click**: Calls `fileStore.openFile(node)` - sends `file_content_request` via WebSocket
- **Icon**: Determined by `FILE_ICONS[extension]` or 'article' default
- **Name**: Display name (prettified from filename)
- **Indentation**: Same as folder: `paddingLeft: ${0.75 + depth * 1.25}rem`
- Disabled when `isLoading` true

### FileViewer

**Role**: Displays file content with back navigation.

**Props**:
```typescript
interface FileViewerProps {
  file: FileInfo;
  content: string;
  onBack: () => void;
}
```

**Behavior**:
- Shows back button (`arrow_back`) in top-left
- Displays file content (already fetched by store)
- Shows loading state while `isLoading` true
- Grayed out / non-interactive during load

### FileViewerHeader

**Role**: Simple back navigation at top of content area. Transparent, no border.

**Props**:
```typescript
interface FileViewerHeaderProps {
  filename: string;
  onBack: () => void;
}
```

**Structure**:
```
<div class="file-viewer-nav">
  <button class="back-btn" onClick={onBack} disabled={isLoading}>
    <span class="material-symbols-outlined">arrow_back</span>
  </button>
  <span class="filename">{filename}</span>
</div>
```

**Styling Notes**:
- No background color (transparent)
- No border-bottom line
- Positioned at top of content area, NOT the main app header
- Simple flex row with gap

### FileContentRenderer

**Role**: Renders file content based on type.

**Supported Types**:
| Extension | Renderer |
|-----------|----------|
| .md, .mdx | Markdown with syntax highlighting |
| .ts, .tsx, .js, .jsx | Code with syntax highlighting |
| .json | Formatted JSON with highlighting |
| .css, .scss | CSS with syntax highlighting |
| .html, .htm | HTML with syntax highlighting |
| others | Plain text with monospace font |

---

## Styling

### CSS Variables (add to variables.css)

```css
:root {
  /* File Tree */
  --file-tree-indent: 1.25rem;
  --file-tree-item-padding: 0.6rem 0.75rem;
  --file-tree-icon-size: 1.1rem;
  --file-tree-icon-width: 1.5rem;
  --file-tree-font-size: 0.85rem;
  
  /* File Viewer Header */
  --file-viewer-header-height: 48px;
}
```

### File Tree Item (Folder + File)

```css
.file-tree-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: var(--file-tree-item-padding);
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.15s ease;
  margin-bottom: 2px;
}

.file-tree-item:hover {
  background: var(--bg-tertiary);
}

.file-tree-item .tree-icon {
  font-size: var(--file-tree-icon-size);
  width: var(--file-tree-icon-width);
  text-align: center;
  color: var(--text-secondary);
}

/* Filled vs outline folder icons */
.file-tree-item .tree-icon.folder-filled {
  font-variation-settings: 'FILL' 1;
}

.file-tree-item .tree-icon.folder-outline {
  font-variation-settings: 'FILL' 0;
}

.file-tree-item .tree-label {
  flex: 1;
  font-size: var(--file-tree-font-size);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Loading state */
.file-tree-item.disabled,
.file-viewer-nav .back-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

### Folder Children Container

```css
.folder-children {
  /* No additional padding - indentation handled by item paddingLeft */
}
```

### File Viewer Navigation (Transparent)

```css
.file-viewer-nav {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0;
  /* NO background - transparent */
  /* NO border-bottom */
}

.file-viewer-nav .back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.25rem;
  border-radius: 4px;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
}

.file-viewer-nav .back-btn:hover:not(:disabled) {
  color: var(--text-white);
}

.file-viewer-nav .filename {
  font-size: 0.9rem;
  color: var(--text-secondary);
}
```

---

## Naming & Display

### Naming Conventions

**File/Folder Display Names (As-Is)**:
```typescript
// File names displayed exactly as they appear on disk
// No transformation of hyphens, underscores, or other characters
// my-file.md → "my-file.md"
// my_component.ts → "my_component.ts"
function formatNodeName(name: string): string {
  return name; // Return as-is
}
```

**Indentation Formula**:
```typescript
// Depth 0: 0.75rem
// Depth 1: 2.0rem  (0.75 + 1 * 1.25)
// Depth 2: 3.25rem (0.75 + 2 * 1.25)
const paddingLeft = `${0.75 + depth * 1.25}rem`;
```

---

## Icons (From Old Code, Simplified)

### Default Icons

| Type | Icon | Notes |
|------|------|-------|
| Folder (collapsed, has children) | `folder` | Filled style (font-variation-settings: 'FILL' 1) |
| Folder (collapsed, empty) | `folder` | Outline style (font-variation-settings: 'FILL' 0) |
| Folder (expanded) | `folder_open` | Always filled |
| File (default) | `article` | |

### File Type Icons

| Extension | Icon |
|-----------|------|
| .js, .jsx | `javascript` |
| .ts, .tsx | `typescript` |
| .json | `data_object` |
| .css, .scss | `style` |
| .html | `html` |
| .md, .mdx | `description` |
| .txt | `text_snippet` |
| .yml, .yaml | `settings` |
| .png, .jpg, .svg | `image` |
| .mp4, .mov | `videocam` |
| .csv | `table` |
| .sql | `database` |

**Note**: No custom manifest.json overrides. These are the defaults only.

---

## WebSocket API

See [FILE_EXPLORER_WEBSOCKET_SPEC.md](./FILE_EXPLORER_WEBSOCKET_SPEC.md) for complete protocol definitions.

### Quick Reference

**Client → Server:**
```typescript
// Fetch folder contents (one level)
{ type: 'file_tree_request', workspace: 'code', path?: string }

// Fetch file content
{ type: 'file_content_request', workspace: 'code', path: string }
```

**Server → Client:**
```typescript
// Folder contents
{ type: 'file_tree_response', workspace: 'code', path: string, success: true, nodes: FileTreeNode[] }

// File content
{ type: 'file_content_response', workspace: 'code', path: string, success: true, content: string, size: number, lastModified: number }

// Error
{ type: 'file_tree_response' | 'file_content_response', workspace: 'code', path: string, success: false, error: string, code: FileErrorCode }
```

**Error Codes:**
| Code | Meaning |
|------|---------|
| `ENOENT` | File/folder not found |
| `EACCES` | Permission denied |
| `ENOTDIR` | Expected directory, got file |
| `EISDIR` | Expected file, got directory |
| `ENOTWORKSPACE` | Not a filesystem workspace (wiki, rocket, etc.) |
| `ETOOLARGE` | Folder too large (>1000 items) |
| `UNKNOWN` | Catch-all |

### Workspace Mapping

| Workspace | Type | File Explorer |
|-----------|------|---------------|
| `code` | Filesystem-backed | ✅ Active |
| `wiki` | GUI-based | ❌ Hidden / placeholder |
| `rocket` | GUI-based | ❌ Hidden / placeholder |
| `issues` | GUI-based | ❌ Hidden / placeholder |
| `scheduler` | GUI-based | ❌ Hidden / placeholder |
| `skills` | GUI-based | ❌ Hidden / placeholder |
| `claw` | GUI-based | ❌ Hidden / placeholder |

---

## File Organization

```
kimi-ide-client/src/
├── components/
│   └── file-explorer/
│       ├── FileExplorer.tsx       # Main container (tree ↔ viewer switcher)
│       ├── FileTree.tsx           # Tree root component
│       ├── FileTreeNode.tsx       # Node router (folder vs file)
│       ├── FolderNode.tsx         # Expandable folder
│       ├── FileNode.tsx           # Clickable file
│       ├── FileViewer.tsx         # File content display
│       └── FileContentRenderer.tsx # Content type renderers
├── state/
│   ├── workspaceStore.ts          # Existing
│   └── fileStore.ts               # NEW: File explorer state
├── types/
│   ├── index.ts                   # Existing
│   └── file-explorer.ts           # NEW: File explorer types
├── hooks/
│   └── useFileTree.ts             # NEW: WebSocket file fetching hook
└── lib/
    └── file-utils.ts              # NEW: Icon mapping, name prettifying
```

---

## Implementation Phases

### Phase 1: Core Types & Utils
- [ ] Create `types/file-explorer.ts`
- [ ] Create `lib/file-utils.ts` (icon mapping, name formatting)
- [ ] Create `state/fileStore.ts`

### Phase 2: Tree Components
- [ ] Create `FileNode.tsx`
- [ ] Create `FolderNode.tsx` (with filled/outline icon logic)
- [ ] Create `FileTreeNode.tsx` (router)
- [ ] Create `FileTree.tsx`

### Phase 3: Viewer Components
- [ ] Create `FileContentRenderer.tsx`
- [ ] Create `FileViewer.tsx` (with loading state)

### Phase 4: Integration
- [ ] Create `FileExplorer.tsx` container
- [ ] Integrate into `ContentArea.tsx`
- [ ] Show only for `code` workspace

### Phase 5: Polish
- [ ] Add CSS styles
- [ ] Loading states (gray out UI)
- [ ] Error handling (display error messages)
- [ ] Empty states

### Phase 6: WebSocket Wiring
- [ ] Server handlers for `file_tree_request`
- [ ] Server handlers for `file_content_request`
- [ ] Error code mapping
- [ ] File watching stub (receive but don't act on notifications)

---

## What We Keep From Fusion Studios

| Feature | Source | Notes |
|---------|--------|-------|
| Tree indentation | `renderFolder()` | `0.75 + depth * 1.25rem` |
| Folder icons | `renderFolder()` | `folder`/`folder_open` with filled/outline states |
| File icon mapping | Derived from old code | Simplified defaults |
| File name formatting | `formatting.js` | Hyphens/underscores → spaces |
| Item styling | CSS `.tree-item` | Spacing, hover, colors |
| Expand/collapse | `renderFolder()` | Toggle children visibility |

## What We Discard

| Feature | Reason |
|---------|--------|
| Context menus | Read-only, no file operations |
| Drag and drop | No move/reorder capability |
| Rename modal | No rename capability |
| Move modal | No move capability |
| New file/folder | No create capability |
| Delete modal | No delete capability |
| manifest.json icons | Simplified defaults only |
| Special folder styling | No custom overrides |
| Version stacking | Simplified file display |
| Recent files section | Simpler scope |
| REST API | WebSocket protocol instead |

---

## Decisions Summary

| Topic | Decision | Rationale |
|-------|----------|-----------|
| **Protocol** | WebSocket | Consistent with chat, real-time capable |
| **Tree depth** | One level at a time | Fast repo switching, lazy loading |
| **Folder metadata** | `hasChildren: boolean` | Filled vs outline icons |
| **Extension** | Server-provided | Single source of truth |
| **Content loading** | Full file | Files under 1000 lines |
| **Workspace support** | `code` only | Others are GUI-based |
| **Loading UX** | Gray out + disable | Prevents race conditions |
| **Caching** | None | 10ms fetch is fast enough |
| **Large folders** | `ETOOLARGE` error | >1000 items rejected |
| **File watching** | Stubbed | Future diff support |
| **Error handling** | Typed codes | Contextual UI handling |

---

*Last Updated: 2026-03-07*  
*Applies to: kimi-ide-client (React + TypeScript)*  
*Protocol: FILE_EXPLORER_WEBSOCKET_SPEC.md*
