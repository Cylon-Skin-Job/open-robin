---
type: drag_file
layout: split
panels:
  left:
    role: source
    renderer: markdown-preview
    draggable: true
  right:
    role: target
    renderer: folder-drop
    icon: folder_special
    label: "settings/"
actions:
  drop:
    message: "file:move"
    dismiss: true
  cancel:
    dismiss: true
---

# Drag File Modal

Split-panel modal for deploying files into settings/ folders.
Left panel shows a draggable markdown preview of the source file.
Right panel is a drop target representing the destination folder.

User grabs the document on the left and drags it to the folder on the right.
On drop, the client sends a `file:move` WebSocket message. The server
archives the prior copy and moves the new file into place.
