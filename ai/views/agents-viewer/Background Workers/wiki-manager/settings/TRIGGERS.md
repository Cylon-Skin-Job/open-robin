# Triggers

---
name: source-file-change
type: file-change
events: [modify, create, delete]
match: "open-robin-server/lib/**/*.js"
exclude: ["ai/views/capture-viewer/**"]
prompt: PROMPT_01.md
message: |
  Source file changed: {{filePath}} ({{event}})
  Delta: {{delta}}
---

---
name: wiki-page-changed
type: file-change
events: [modify]
match: "ai/views/wiki-viewer/content/project/**/PAGE.md"
prompt: PROMPT_03.md
message: |
  Wiki page changed: {{filePath}}
  Check edges for consistency.
---

---
name: daily-freshness
type: cron
schedule: "daily 09:00"
prompt: PROMPT_02.md
message: |
  Scheduled freshness check.
---

---
name: nightly-audit
type: cron
schedule: "daily 02:00"
condition: "lastChatMessage.age > 30m"
retry: "30m"
prompt: PROMPT_AUDIT.md
message: |
  Nightly audit. Consolidate HISTORY.md and review LESSONS.md.
---
