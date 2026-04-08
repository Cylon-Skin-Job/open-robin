# Progressive Disclosure

How context flows from always-present orientation to on-demand depth. Agents don't load everything — they load what they need, when they need it.

## The Four Layers

```
Layer 1: CLAUDE.md (always loaded, ~500 tokens)
  → What this project is
  → Permanent constraints
  → "A wiki exists at ai/workspaces/wiki/"

Layer 2: Skills (loaded on trigger, ~500-2000 tokens each)
  → Durable heuristics and guardrails
  → "Check wiki/secrets for auth details"
  → Thin pointers to wiki depth

Layer 3: Wiki PAGE.md (loaded on demand, full articles)
  → Living truth — architecture, decisions, procedures
  → Changes with the system
  → Agent reads via file system, not preloaded

Layer 4: Upstream docs (fetched when needed)
  → External documentation sites
  → Wiki articles link here when deeper context needed
```

## How It Works in kimi-claude

### Agent Session Start

The agent gets Layer 1 (PROMPT.md + STATE.md) automatically. That's ~500 tokens of orientation — who it is, what it owns, what happened recently across workspaces.

### During Work

The agent encounters a situation that needs depth. It reads the relevant PAGE.md from the wiki workspace. This is Layer 3 — loaded on demand, not preloaded.

For the wiki agent specifically, it reads `index.json` (a lightweight graph) at session start, then traverses to specific PAGE.md files only when the workflow loop reaches them.

### Cross-Layer Pointers

Each layer points to the next:
- CLAUDE.md → "wiki exists at ai/workspaces/wiki/"
- Skills → "check wiki/{topic} for details on X"
- Wiki PAGE.md → links to other wiki pages and upstream docs
- Upstream docs → the external source of truth

An agent never skips a layer. It follows pointers down. If Layer 2 (a skill) has enough information, the agent doesn't load Layer 3.

## What Goes Where

| Content | Layer | Why |
|---------|-------|-----|
| "This is a web-based IDE using CLI wire protocols" | CLAUDE.md | Never changes |
| "All code is TypeScript + React 19" | CLAUDE.md | Permanent constraint |
| "Check exports before modifying" | Skill | Durable guardrail |
| "Async functions must be awaited" | Skill | Stable pattern |
| "GitLab token stored in Keychain as GITLAB_TOKEN" | Wiki | Changes when auth changes |
| "Wiki agent uses ticket-driven runs" | Wiki | Architecture evolves |
| "How to create a CLI skill" | Wiki | Procedure evolves |
| "CLI docs (Kimi, Claude, etc.)" | Upstream | External truth |

## Rules

1. **No layer loads the one below it automatically.** Each layer is opt-in. The agent decides when to go deeper.
2. **Skills never embed volatile detail.** If it changes when a tool updates, put it in the wiki.
3. **The wiki is the single source of truth for anything that drifts.** Don't maintain the same info in a skill and a wiki page.
4. **CLAUDE.md is orientation, not documentation.** Readable in 30 seconds. Never exceed ~500 tokens.
5. **index.json is the wiki's own progressive disclosure.** Topic names and edges (Layer 2-ish) before full page content (Layer 3).

## Applied to Workspaces

Each workspace's PROMPT.md is Layer 1 for that agent. The workspace's PAGE.md topics are Layer 3. The workspace never preloads everything — it loads what the current task needs.

```
Wiki agent:     PROMPT.md → index.json → specific PAGE.md files (on demand)
Coding agent:   PROMPT.md → STATE.md → specific source files (on demand)
Issues agent:   PROMPT.md → ticket queue → specific tickets (on demand)
```

The pattern is universal. Only load what the current step of the current workflow needs.

## Related

- [Workspace-Agent-Model](Workspace-Agent-Model) — how agents load context via the 5-file model
- [Wiki-System](Wiki-System) — how the wiki implements Layer 3
- [Session-Scoping](Session-Scoping) — how each workspace session loads its own context
