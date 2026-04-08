# kimi-claude Wiki

Living reference layer for architecture, decisions, and evolving knowledge.

## Getting Started

- [Setup-Wizard](Setup-Wizard) — Onboarding checklist (required, recommended, opt-in steps)
- [Screenshot-Capture](Screenshot-Capture) — How Kimi accesses user screenshots via symlink

## Infrastructure

- [Secrets](Secrets) — macOS Keychain secrets manager
- [GitLab](GitLab) — Namespace, auth, API, token rotation

## Architecture

- [Workspace-Agent-Model](Workspace-Agent-Model) — The 5-file pattern every workspace follows
- [Workspaces](Workspaces) — Overview of all 8 workspaces (readers, router, executor)
- [Background-Agents](Background-Agents) — Agent folders, numbered prompts, wire protocol runner
- [Progressive-Disclosure](Progressive-Disclosure) — How agents load context layer by layer
- [Session-Scoping](Session-Scoping) — Isolated sessions per workspace
- [Model-Config](Model-Config) — Per-workspace model preferences and hot-swapping

## Wiki System

- [Wiki-System](Wiki-System) — How this wiki works, topic folders, syncing
- [Wiki-Interface](Wiki-Interface) — Build plan for the wiki UI (three-column layout)
- [Ticket-Routing](Ticket-Routing) — Three-column model: INBOX, OPEN, COMPLETED (assignment-based dispatch)
- [Run-Auditing](Run-Auditing) — DSPy-style process inspection and optimization

## Principles

- **Skills are durable. Wikis are living.** — Skills define capabilities. The wiki captures the reasoning, decisions, and context behind them.
- **Local-first** — Wiki pages live in `ai/workspaces/wiki/` alongside the code. Push to GitLab to publish.
- **One truth** — If it's a decision or architecture rationale, it belongs here, not in code comments.
- **Progressive disclosure** — Load what you need, when you need it. Not everything at once.
