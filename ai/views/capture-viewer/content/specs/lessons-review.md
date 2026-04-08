---
name: lessons-review
events: [modify]
match: "ai/workspaces/background-agents/**/LESSONS.md"
condition: "fileStats.tokens > 500"
action: create-ticket
ticket:
  assignee: local
  title: "Review lessons for {{basename}} (~{{fileStats.tokens}} tokens)"
  body: "LESSONS.md at `{{filePath}}` has ~{{fileStats.tokens}} tokens ({{fileStats.lines}} lines, {{fileStats.words}} words). Read, evaluate, and promote useful lessons into prompt.md. Then clear the reviewed entries."
---

# Lessons Review Trigger (Domain 4)

When an agent's LESSONS.md exceeds 500 estimated tokens after a run appends
to it, creates a review ticket for the human operator.

The human reads the lessons, promotes valuable ones into the agent's prompt.md
as permanent instructions, and clears the reviewed entries.

Token estimate: word count x 1.3 (standard approximation).
