---
title: View Spec — File Explorer
created: 2026-03-28
status: active
parent: MASTER_SYSTEM_SPEC.md
preserves: FILE_EXPLORER_CHUNK_1-10.md, FILE_EXPLORER_IMPLEMENTATION_PLAN.md
---

# File Explorer View

The code workspace renders a tree view of the project filesystem with file viewing.

---

## Layout

```
┌───────────────────┬──────────────────────────┐
│  File Tree        │  File Viewer             │
│                   │                          │
│  ▶ src/           │  (selected file content) │
│    ▶ components/  │                          │
│    ▶ lib/         │                          │
│  ▶ ai/           │                          │
│  ▶ server/       │                          │
│    package.json   │                          │
│    README.md      │                          │
└───────────────────┴──────────────────────────┘
```

- Tree on left, file content on right
- Click folder to expand (fetches fresh from server each time — no client cache)
- Click file to view content
- Symlinks show `folder_special` icon

---

## Architecture Decisions (Locked)

| Decision | Choice |
|----------|--------|
| Children storage | No client cache. Fetch fresh every expand. |
| Non-filesystem workspaces | Show GUI placeholder, not file explorer |
| Empty folder | Empty folder icon (outline), no children |
| Error display | Grayed row with X icon, tooltip on hover |

---

## Implementation Chunks

Detailed implementation is broken into 10 chunks (FILE_EXPLORER_CHUNK_1-10.md):
1. Types and utilities
2. File store (Zustand)
3. FileNode component
4. FolderNode component
5. FileTree component
6. FileTreeNode router
7. FileExplorer container
8. WebSocket integration
9. ContentArea integration
10. File display (deferred — basic `<pre>` for now)

---

## WebSocket Protocol

```
Client -> Server:  { type: 'file_tree_request', workspace, path }
Server -> Client:  { type: 'file_tree_response', workspace, path, success, nodes }

Client -> Server:  { type: 'file_content_request', workspace, path }
Server -> Client:  { type: 'file_content_response', workspace, path, success, content }
```

---

## TODO

- [ ] Syntax highlighting in file viewer
- [ ] Markdown rendering for .md files
- [ ] File search (Ctrl+P style)
- [ ] Keyboard navigation
- [ ] Right-click context menu
- [ ] File watching (auto-refresh on external changes)
