---
name: agent-prompt-change
events: [modify, create, delete]
match: "ai/workspaces/background-agents/**/PROMPT_*.md"
exclude: ["*.retry-*"]
action: create-ticket
ticket:
  assignee: kimi-code
  title: "Agent prompt {{event}}d: {{basename}}"
  body: "The prompt file `{{filePath}}` was {{event}}d. {{parentStats.files}} files remain in {{parentDir}}. Review for consistency with PROMPT.md."
---

# Agent Prompt Change Watcher

When a PROMPT_NN.md file is added, modified, or removed from an agent's
folder, creates a review ticket. Ensures prompt changes are intentional
and consistent with the agent's identity and standards.
