---
name: server-config-change
events: [modify, delete]
match: ["kimi-ide-server/config.js", "kimi-ide-server/package.json"]
action: log
message: "Server config changed: {{basename}} ({{event}}) in {{parentDir}}"
---

# Server Config Change

Logs when server configuration files are modified or deleted.
Future: could trigger a server restart notification.
