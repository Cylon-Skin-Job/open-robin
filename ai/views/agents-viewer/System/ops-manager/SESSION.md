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
  allowed: [read_file, glob, grep, git_log, git_diff, git_show, list_directory, todo_read]
  restricted:
    write_file: ["docs/**", "AGENTS.md"]
    edit_file: ["docs/**", "AGENTS.md"]
  denied: [shell_exec, git_commit, git_push, todo_write]

# DB access
db:
  read: [tickets, chat_history]
  write: []
  denied: [system_config, secrets]
---
