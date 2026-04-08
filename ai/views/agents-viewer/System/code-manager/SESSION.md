---
thread-model: daily-rolling
session-invalidation: memory-mtime
idle-timeout: 9m
system-context: ["PROMPT.md", "MEMORY.md"]

# CLI profile
cli: kimi
profile: default
model: claude-sonnet-4-6
endpoint: https://api.anthropic.com/v1/messages

# Tool permissions
tools:
  allowed: [read_file, glob, grep, git_log, git_diff, git_show, list_directory, todo_read, todo_write]
  restricted:
    write_file: ["open-robin-server/**", "open-robin-client/src/**"]
    edit_file: ["open-robin-server/**", "open-robin-client/src/**"]
  denied: [shell_exec, git_commit, git_push]

# DB access
db:
  read: [tickets, chat_history]
  write: [tickets]
  denied: [system_config, secrets]
---
