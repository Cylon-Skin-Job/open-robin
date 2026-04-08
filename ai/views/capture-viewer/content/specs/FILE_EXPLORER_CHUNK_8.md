# File Explorer - Chunk 8: WebSocket Integration

**Status:** Ready for Execution  
**Scope:** Connect components to WebSocket for real-time file data  
**Full Plan:** [FILE_EXPLORER_IMPLEMENTATION_PLAN.md](./FILE_EXPLORER_IMPLEMENTATION_PLAN.md)

---

## Dependencies

- [Chunk 1: Types and Utilities](./FILE_EXPLORER_CHUNK_1.md)
- [Chunk 2: File Store](./FILE_EXPLORER_CHUNK_2.md)
- [Chunk 7: FileExplorer Container](./FILE_EXPLORER_CHUNK_7.md)
- Server WebSocket implementation (Claude's domain - already implemented)

---

## Files to Modify

- `kimi-ide-client/src/components/file-explorer/FileExplorer.tsx` - Fetch on expand
- `kimi-ide-client/src/hooks/useWebSocket.ts` - Add message handlers

---

## Requirements

### In `FileExplorer.tsx`

When user expands a folder:
1. Set loading state
2. Send WebSocket message: `{ type: 'file_tree_request', workspace: 'code', path }`
3. On response: Store children in local component state, expand folder
4. On error: Show error state

When user opens a file:
1. Set loading state
2. Send WebSocket message: `{ type: 'file_content_request', workspace: 'code', path: file.path }`
3. On response: Call `fileStore.openFile(file, content)` to switch to viewer
4. On error: Show error state

**No cache** - Fetch fresh data every time a folder is expanded.

### In `useWebSocket.ts`

- Handle `file_tree_response`: Pass children to FileExplorer component
- Handle `file_content_response`: Pass content to FileExplorer component
- Handle errors: Set error state in FileExplorer

---

## WebSocket Message Format

```typescript
// Send
{ type: 'file_tree_request', workspace: 'code', path }
{ type: 'file_content_request', workspace: 'code', path: file.path }

// Receive (already implemented by Claude)
{ type: 'file_tree_response', workspace, path, success, nodes }
{ type: 'file_content_response', workspace, path, success, content, size, lastModified }
```

---

## Test Criteria

- Expanding folder sends WebSocket message
- Response displays children in tree
- Opening file sends WebSocket message
- File content received and displayed in viewer
- Errors displayed correctly
- Re-expanding a folder re-fetches fresh data

---

## Navigation

- Previous: [Chunk 7: FileExplorer Container](./FILE_EXPLORER_CHUNK_7.md)
- Next: [Chunk 9: ContentArea Integration](./FILE_EXPLORER_CHUNK_9.md)

---

*Document created: 2026-03-07*
