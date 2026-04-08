---
name: lib-inventory-drift
events: [create, delete, rename]
match: "kimi-ide-server/lib/**/*.js"
action: create-ticket
ticket:
  assignee: local
  title: "Server lib inventory drift: {{basename}} {{event}}d"
  body: "A module was {{event}}d at `{{filePath}}`. The Server-Lib-Modules wiki page may need updating.\n\nParent folder `{{parentDir}}` now has {{parentStats.files}} files and {{parentStats.folders}} folders.\n\nWiki: https://gitlab.com/Cylon-Skin-Job/kimi-claude/-/wikis/Server-Lib-Modules"
---

# Lib Inventory Drift Detector

When a .js file is added, removed, or renamed in kimi-ide-server/lib/,
creates a ticket reminding the human to update the Server-Lib-Modules
wiki page.

Does not fire on modify — only structural changes (new files, deleted
files, renames) that would make the inventory stale.
