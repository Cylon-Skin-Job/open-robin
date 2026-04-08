# File Explorer UI - Assumptions & Questions

**Status:** In Review  
**Scope:** Client-side UI, state management, styling (NOT WebSocket protocol)  
**Related:** [FILE_EXPLORER_SPEC.md](./FILE_EXPLORER_SPEC.md), [FILE_EXPLORER_WEBSOCKET_SPEC.md](./FILE_EXPLORER_WEBSOCKET_SPEC.md)

---

## Critical Architecture Questions

### 1. Nested Children Storage (Inconsistency in Spec)

**Issue:** The spec contradicts itself on how folder children are stored.

**State interface says:**
```typescript
fileTree: FileTreeNode[]  // Current folder contents only - ONE LEVEL
```

**Component structure shows:**
```
FolderChildren
  └── <FileTree nodes={children} depth={depth + 1} />
```

**Problem:** If we fetch one level at a time, where do we store the children of expanded subfolders?

**Options:**
- A) Store ALL nodes in a flat map keyed by path: `Map<string, FileTreeNode[]>`
- B) Extend `FileTreeNode` to have optional `children?: FileTreeNode[]` that gets populated
- C) Store only current folder, collapse other folders when navigating (loses expanded state)

**Decision needed:** _________________

---

### 2. Non-Filesystem Workspaces (wiki, rocket, etc.)

**Question:** What does the content area show for non-`code` workspaces?

**Options:**
- A) Empty state with message: "Wiki workspace has no file explorer"
- B) Placeholder graphic/icon
- C) File explorer component that returns "ENOTWORKSPACE" error on every operation
- D) Don't render FileExplorer at all (ContentArea shows something else)

**Decision needed:** _________________

---

### 3. Empty Folder Display

**Question:** What should an empty folder show when expanded?

**Options:**
- A) Nothing (blank space under folder header)
- B) "(empty)" placeholder text in gray
- C) Don't allow expand if `hasChildren: false` (but spec says we still show outline icon)

**Decision needed:** _________________

---

## Loading State Questions

### 4. Loading UX Specifics

**Spec says:** "Gray out UI + disable controls during file operations"

**Questions:**
- What does "gray out" mean exactly?
  - Opacity: 0.5 on the entire file tree?
  - Overlay with semi-transparent background + spinner?
  - Just the specific folder being expanded?
  
- What about the file viewer loading state?
  - Skeleton placeholder?
  - Spinner in content area?
  - "Loading..." text?

**Decisions needed:** _________________

---

### 5. Per-Item vs Global Loading

**Question:** When expanding a folder, is loading global or per-folder?

**Scenario:** User expands `/docs` (takes 50ms), then quickly expands `/src` (takes 100ms)

**Options:**
- A) Global: Entire file tree grays out, can't interact with anything
- B) Per-folder: Only the expanding folder shows spinner, rest is interactive
- C) Hybrid: Global for file fetch, per-folder for tree fetch

**Decision needed:** _________________

---

## Error Handling Questions

### 6. Error Display UI

**Question:** How should errors be presented?

**Error types:**
- `ENOENT` - Folder/file not found (maybe deleted externally)
- `EACCES` - Permission denied
- `ETOOLARGE` - >1000 items
- `ENOTWORKSPACE` - Wrong workspace (shouldn't happen if we check first)

**Options:**
- A) Toast notification (auto-dismiss?)
- B) Inline error message within content area
- C) Modal dialog
- D) Replace tree with error message

**Decision needed:** _________________

---

### 7. ETOOLARGE Specific UX

**Question:** Specific UI for "folder too large" error?

**Spec says:** Error message suggests "Use terminal to explore"

**Questions:**
- Should we show the first 100 items + "...and 900 more"?
- Should there be a "Open in Terminal" button/action?
- Or just show error and user is stuck?

**Decision needed:** _________________

---

## UI Component Questions

### 8. Breadcrumb Navigation

**Spec says:** "Path breadcrumb: Shows current location at top (optional)"

**Questions:**
- Are we implementing this or deferring?
- If implementing: Clickable segments to jump up the tree?
- Root shows as "/" or workspace name or nothing?

**Decision:** _________________

---

### 9. File Content Rendering

**Question:** What libraries for rendering?

**Markdown:**
- Use existing project library? (Check if `marked` or similar is already installed)
- Syntax highlighting for code blocks within markdown?

**Code files:**
- `highlight.js` is in node_modules - use that?
- Which theme? (Should match Tron/cyan color scheme)

**Decision needed:** _________________

---

### 10. File Viewer - Scroll Position

**Question:** Scroll behavior when opening files?

**Options:**
- A) Always scroll to top
- B) Restore previous scroll position if re-opening same file
- C) Remember scroll position per file for session duration

**Decision needed:** _________________

---

### 11. Back Button Behavior

**Question:** What happens on "back" from file viewer?

**Options:**
- A) Return to tree, folder expansion state preserved
- B) Return to tree, all folders collapsed (reset)
- C) Browser-style back stack (can go back through multiple files)

**Decision needed:** _________________

---

## State Management Questions

### 12. Expanded State Persistence

**Question:** How long is folder expansion state remembered?

**Options:**
- A) Session only (lost on page refresh)
- B) Per-workspace switching (expand /code/docs, switch to wiki, back to code - still expanded?)
- C) LocalStorage persistence across sessions

**Decision needed:** _________________

---

### 13. Selected File State

**Question:** Should selected file be in URL?

**Options:**
- A) URL hash: `#file=docs/readme.md` (allows bookmarking/copy-paste)
- B) Pure in-memory state (simpler, no URL sync)

**Decision needed:** _________________

---

### 14. Refresh Mechanism

**Spec mentions:** Manual refresh

**Questions:**
- Refresh button location? (Header? Context menu? Keyboard shortcut?)
- What does refresh do?
  - Re-fetch current folder only?
  - Re-fetch all expanded folders?
  - Collapse all and reset to root?

**Decision needed:** _________________

---

## Accessibility & UX Questions

### 15. Keyboard Navigation

**Question:** Keyboard support level?

**Options:**
- A) None (mouse/touch only)
- B) Basic: Tab to focus, Enter to open/expand
- C) Full: Arrow keys to navigate, Enter to open, space to expand, typeahead search

**Decision needed:** _________________

---

### 16. Right-Click / Context Menu

**Spec says:** Context menus are discarded (read-only)

**Question:** But should right-click do anything?

**Options:**
- A) Nothing (native browser context menu)
- B) Simple menu: "Copy path", "Refresh"
- C) Truly nothing (prevent default)

**Decision needed:** _________________

---

### 17. File Watching - UI Behavior

**Spec says:** File watching is stubbed for future

**Question:** When file changes arrive, what happens?

**Options:**
- A) Auto-refresh the file if currently viewing it
- B) Show "File changed" indicator with manual refresh button
- C) Ignore (current behavior)
- D) Show toast: "File X was modified externally"

**Decision needed:** _________________

---

## Styling Questions

### 18. CSS Scope

**Question:** Where do file explorer styles live?

**Options:**
- A) `FileExplorer.css` separate file
- B) Add to existing `variables.css` and component CSS modules
- C) Inline styles (currently project seems to use CSS)

**Decision needed:** _________________

---

### 19. Scroll Behavior

**Question:** Scrollbars in file tree?

**Options:**
- A) Native scrollbars (default browser)
- B) Custom styled scrollbars (match Tron theme)
- C) Hide scrollbars, use mouse wheel only

**Decision needed:** _________________

---

### 20. Max Depth / Indentation

**Question:** What happens with very deep nesting? (e.g., 10+ levels)

**Options:**
- A) Keep indenting, let horizontal scroll happen
- B) Cap indentation at some max (e.g., 8 levels deep)
- C) Horizontal scroll within file tree container

**Decision needed:** _________________

---

## Assumptions We're Making

| # | Assumption | Risk if Wrong |
|---|------------|---------------|
| 1 | Project uses `highlight.js` for syntax highlighting | May need to install/configure different library |
| 2 | Material Symbols font is available for icons | Icons won't render |
| 3 | Zustand is already set up and working | State won't persist/manage correctly |
| 4 | CSS variables like `--bg-tertiary`, `--text-secondary` exist | Styles will be broken |
| 5 | ContentArea component exists and accepts children | No place to render file explorer |
| 6 | File content is UTF-8 text only | Binary files will garble |
| 7 | Max file size ~100KB for full content loading | Larger files may crash/hang |
| 8 | Filesystem workspace is always `code` | Wrong workspace mapping |

---

## Resolved Decisions (Fill in as we go)

| Question | Decision | Date |
|----------|----------|------|
| (Example) Breadcrumb | Deferred to Phase 2 | 2026-03-07 |

---

*Document created: 2026-03-07*  
*Next: Review with user, fill in decisions, then begin implementation*
