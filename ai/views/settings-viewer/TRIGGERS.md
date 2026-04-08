# System Triggers

Triggers that manage core system behavior. These are loaded by the trigger-loader
on startup via the recursive `ai/components/` scan.

---
name: prompt-deploy-modal
type: file-change
events: [create]
match: "**/chat/PROMPT.md"
exclude: ["**/settings/**", "**/archive/**"]
action: show-modal
modal:
  type: drag_file
  source: "{{filePath}}"
  target: "{{parentDir}}/settings/"
  title: "Deploy PROMPT.md"
  message: "Drag to settings to activate"
---

---
name: session-deploy-modal
type: file-change
events: [create]
match: "**/chat/SESSION.md"
exclude: ["**/settings/**", "**/archive/**"]
action: show-modal
modal:
  type: drag_file
  source: "{{filePath}}"
  target: "{{parentDir}}/settings/"
  title: "Deploy SESSION.md"
  message: "Drag to settings to activate"
---
