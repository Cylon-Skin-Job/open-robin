# Triggers

---
name: dependency-change
type: file-change
events: [modify]
match: "*/package.json"
prompt: PROMPT.md
message: |
  Package manifest changed: {{filePath}}
---

---
name: weekly-audit
type: cron
schedule: "0 6 * * 1"
prompt: PROMPT.md
message: |
  Weekly dependency audit. Check for vulnerabilities and outdated packages.
---
