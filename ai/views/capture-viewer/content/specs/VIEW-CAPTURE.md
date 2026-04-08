---
title: View Spec — Capture
created: 2026-03-28
status: active
parent: MASTER_SYSTEM_SPEC.md
---

# Capture — Tile Grid View

The capture workspace renders documents, screenshots, specs, and files as tile rows with folder grouping.

---

## Layout

```
┌──────────────────────────────────────────────┐
│  Folder Label                                │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐           │
│  │tile │ │tile │ │tile │ │tile │  → scroll  │
│  └─────┘ └─────┘ └─────┘ └─────┘           │
│                                              │
│  Folder Label                                │
│  ┌─────┐ ┌─────┐                            │
│  │tile │ │tile │                    → scroll  │
│  └─────┘ └─────┘                            │
└──────────────────────────────────────────────┘
```

- Each folder becomes a labeled row
- Tiles scroll horizontally within their row
- Image files render as thumbnails (`object-fit: cover`)
- Text files render as document previews

---

## What's Built

- [x] TileRow + DocumentTile components
- [x] Image detection and thumbnail rendering
- [x] Screenshot symlink (~/Desktop/Screenshots -> capture/screenshots/)
- [x] Server route: `GET /api/workspace-file/:workspace/{*filePath}`
- [x] Symlink resolution + Unicode space fuzzy-matching for macOS filenames

---

## Folder Structure

```
ai/views/capture-viewer/
  ├── captures/
  ├── screenshots/     ← symlink to ~/Desktop/Screenshots/
  ├── specs/
  ├── playground/
  ├── todo/
  └── assets/
```

---

## TODO

- [ ] Tile click -> detail view / file preview
- [ ] Drag-and-drop file import
- [ ] Search/filter across all capture folders
