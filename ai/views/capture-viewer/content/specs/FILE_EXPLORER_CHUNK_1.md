# File Explorer - Chunk 1: Types and Utilities

**Status:** Ready for Execution  
**Scope:** Types and utility functions for file explorer  
**Full Plan:** [FILE_EXPLORER_IMPLEMENTATION_PLAN.md](./FILE_EXPLORER_IMPLEMENTATION_PLAN.md)

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

## Files to Create

1. `kimi-ide-client/src/types/file-explorer.ts`
2. `kimi-ide-client/src/lib/file-utils.ts`

---

## Requirements

### `types/file-explorer.ts`

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

// Folder state tracking - which folders are currently expanded
type ExpandedFolders = Set<string>;
```

### `lib/file-utils.ts`

**Icon Mapping Philosophy:**
- **TypeScript** → `bolt` (fast, energetic)
- **React (JSX/TSX)** → `experiment` (component experimentation)
- **CSS/SCSS/etc** → `tag` (styled tags)
- **HTML** → `code` (markup is code)
- **JavaScript** → `javascript` (standard)
- Other extensions have appropriate semantic icons

```typescript
// Icon mapping
const FILE_ICONS: Record<string, string> = { ... };

// Get icon for file extension (and filename for dotfiles)
export function getFileIcon(extension?: string, filename?: string): string;

// Format node name (no change - exact disk name)
export function formatNodeName(name: string): string;

// Calculate indentation padding
export function getIndentPadding(depth: number): string;
```

---

## Test Criteria

- Types compile without errors
- `getFileIcon('md')` returns `'description'`
- `formatNodeName('my-file.md')` returns `'my-file.md'`
- `getIndentPadding(0)` returns `'0.75rem'`, `getIndentPadding(1)` returns `'2rem'`

---

## Next Chunk

After completing this chunk, proceed to [Chunk 2: File Store](./FILE_EXPLORER_CHUNK_2.md) (if available) or see the full [Implementation Plan](./FILE_EXPLORER_IMPLEMENTATION_PLAN.md).

---

*Document created: 2026-03-07*
