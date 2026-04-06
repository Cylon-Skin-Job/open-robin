# File Explorer WebSocket Protocol SPEC

**Status:** Approved - Ready for Implementation  
**Related:** [FILE_EXPLORER_SPEC.md](./FILE_EXPLORER_SPEC.md) - Main file explorer UI specification  

---

## Overview

The file explorer uses **WebSocket messages** (not REST) for all file operations. This maintains consistency with the existing chat protocol and enables real-time updates.

### Why WebSocket?
- Consistent with existing chat/protocol architecture
- Enables server-pushed file change notifications (watching)
- Single connection for all workspace communication

### Performance Priority
**Fast over slow** - Optimize for quick initial load and responsive interactions.

---

## Protocol Design

### Base Message Structure

All messages extend the existing WebSocket protocol:

#### Client → Server

```typescript
// Request file tree for a folder
interface FileTreeRequest {
  type: 'file_tree_request';
  workspace: WorkspaceId;      // 'code' only (others are GUI-based)
  path?: string;               // optional: subfolder path (default: root)
}

// Request file content
interface FileContentRequest {
  type: 'file_content_request';
  workspace: WorkspaceId;      // 'code' only
  path: string;                // relative to workspace root
}
```

#### Server → Client (Success)

```typescript
interface FileTreeResponse {
  type: 'file_tree_response';
  workspace: WorkspaceId;
  path: string;                // the path that was requested (normalized)
  success: true;
  nodes: FileTreeNode[];
}

interface FileContentResponse {
  type: 'file_content_response';
  workspace: WorkspaceId;
  path: string;
  success: true;
  content: string;             // full file content
  size: number;                // bytes (useful for display)
  lastModified: number;        // timestamp for caching (future use)
}
```

#### Server → Client (Error)

```typescript
interface FileOperationError {
  type: 'file_tree_response' | 'file_content_response';
  workspace: WorkspaceId;
  path: string;
  success: false;
  error: string;               // human-readable: "File not found"
  code: FileErrorCode;         // machine-readable: 'ENOENT'
}

type FileErrorCode = 
  | 'ENOENT'        // File/folder not found
  | 'EACCES'        // Permission denied
  | 'ENOTDIR'       // Expected directory, got file
  | 'EISDIR'        // Expected file, got directory
  | 'ENOTWORKSPACE' // Not a filesystem workspace (wiki, rocket, etc.)
  | 'ETOOLARGE'     // File/folder too large (>1000 items)
  | 'UNKNOWN';      // Catch-all
```

### Node Structure

```typescript
interface FileTreeNode {
  name: string;                // filename on disk: "architecture.md"
  path: string;                // full relative path: "wiki/docs/architecture.md"
  type: 'file' | 'folder';
  extension?: string;          // for icon selection: "md" (files only, normalized lowercase)
  hasChildren?: boolean;       // for folder icon state (folders only)
}
```

---

## Decisions (All Resolved)

### Decision #1: Tree Depth Strategy ✅

**Choice:** One level at a time (lazy loading)

**Rationale:**
- Enables fast repo switching (< 100ms)
- Users typically only explore a subset of folders
- Network latency is negligible (localhost server)
- Small folders render in 10-30ms; large folders show spinner

### Decision #2: Folder Metadata ✅

**Choice:** `hasChildren: boolean` (not `childCount`)

**Rationale:**
- UI shows filled icon (has children) vs outline icon (empty)
- No count displayed; user explores to see contents
- Same server cost as count, but simpler protocol

### Decision #3: Extension Field ✅

**Choice:** Server provides `extension` (normalized, lowercase)

**Rationale:**
- Single source of truth for filename parsing
- Consistent across file explorer, chat display, search results
- Server handles edge cases (".gitignore" → no extension)

### Decision #4: File Content Request Format ✅

**Choice:** Explicit `workspace` + `path`

```typescript
{ type: 'file_content_request', workspace: 'code', path: 'docs/readme.md' }
```

**Rationale:**
- Unambiguous; matches `file_tree_request` pattern
- Client already tracks `currentWorkspace` in Zustand store
- Flexible for future path formats

### Decision #5: File Content Response Format ✅

**Choice:** Full content as string

**Rationale:**
- Target files are under 1000 lines (typically under 500)
- ~100KB max over local WebSocket is trivial
- Include `size` and `lastModified` for future caching/validation

### Decision #6: File Watching / Real-time Updates ✅

**Choice:** Stubbed, active workspace only

```typescript
interface FileChangedNotification {
  type: 'file_changed';
  workspace: WorkspaceId;
  path: string;
  change: 'created' | 'modified' | 'deleted';
  timestamp: number;
}
```

**Rationale:**
- Plumbing in place for future diff view, auto-reload
- Currently no UI badges or auto-refresh
- Scope: active workspace only (resource efficiency)

### Decision #7: Workspace Path Mapping ✅

**Choice:** Only `code` workspace is filesystem-backed

```typescript
const WORKSPACE_PATHS: Record<WorkspaceId, string | null> = {
  code: '.',           // Maps to current working directory
  wiki: null,          // GUI-based
  rocket: null,        // GUI-based
  issues: null,        // GUI-based
  scheduler: null,     // GUI-based
  skills: null,        // GUI-based
  claw: null           // GUI-based
};
```

**Rationale:**
- All files live in the repo
- Other workspaces will have custom GUIs
- File operations return `ENOTWORKSPACE` for non-filesystem workspaces

### Decision #8: Error Handling Specificity ✅

**Choice:** Typed error codes

**Rationale:**
- Frontend can show contextual UI ("Create file?" for ENOENT, lock icon for EACCES)
- Wiring in place now; UI handling designed later
- Extensible for new error types

### Decision #9: Request IDs ✅

**Choice:** Not needed

**Rationale:**
- Loading state pattern preferred: gray out UI during operations
- Sequential operations (click → wait → done) prevent race conditions
- Request ID matching unnecessary with this UX pattern

### Decision #10: Caching ✅

**Choice:** No client-side caching

**Rationale:**
- ~10ms fetch time is fast enough
- Always-fresh data simplifies mental model
- Can add caching later if needed

### Decision #11: Large Folder Handling ✅

**Choice:** Return `ETOOLARGE` error for folders > 1000 items

**Rationale:**
- Prevents UI lockup on `node_modules`-like folders
- Error message suggests terminal alternative
- User can navigate to subfolders instead

---

## Implementation Notes

### Server-Side

1. **Workspace validation:** Check if workspace is filesystem-backed before operations
2. **Extension parsing:** Normalize to lowercase; handle edge cases (no extension for dotfiles)
3. **hasChildren check:** Stat directory entries, return true if any exist
4. **Error mapping:** Map Node.js errors (`ENOENT`, `EACCES`) to protocol codes
5. **Size limit:** Count entries before building response; abort if > 1000
6. **File watching:** Use `fs.watch()` or `chokidar` for active workspace only

### Client-Side

1. **Loading states:** Disable controls during file operations, re-enable on response
2. **Workspace check:** Only show file explorer for `code` workspace
3. **Icon logic:** Filled folder = `hasChildren: true`, outline = `hasChildren: false` or empty, `folder_open` when expanded
4. **Error display:** Show human-readable error; log code for debugging

---

## Future Extensions

The following may be added in future iterations:

- [ ] Line range requests for large files: `range?: [start, end]`
- [ ] Client-side caching with `lastModified` validation
- [ ] File change notification UI (badges, auto-reload)
- [ ] Pagination for large folders (alternative to `ETOOLARGE`)
- [ ] File operations: create, rename, delete
- [ ] Search within workspace

---

## Resolved Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Transport | WebSocket | Consistent with chat protocol |
| Performance priority | Fast over slow | User experience priority |
| Tree depth | One level | Fast repo switching |
| Folder metadata | `hasChildren` | Icon state without count |
| Extension | Server-provided | Single source of truth |
| Content request | Explicit workspace | Unambiguous, matches pattern |
| Content response | Full content | Files under 1000 lines |
| File watching | Stubbed | Future diff view support |
| Workspace mapping | `code` only | Others are GUI-based |
| Error handling | Typed codes | Contextual UI handling |
| Request IDs | No | Loading state pattern |
| Caching | None | 10ms fetch is fast enough |
| Large folders | `ETOOLARGE` error | Prevent UI lockup |

---

*Document updated: 2026-03-07*  
*Next step: Implement server handlers for file_tree_request and file_content_request*
