# Workspace as Distributable

## Core Insight

A fully configured Open Robin workspace IS the product. The distribution channel is a git repo. No app store, no deployment, no backend. Clone the repo, open Robin, select the workspace.

## What's in a Distributable Workspace

```
my-workspace/
├── ai/
│   ├── system/                 ← System-level config (optional overrides)
│   └── views/
│       ├── {view}/
│       │   ├── index.json      ← View identity
│       │   ├── content.json    ← How content renders
│       │   ├── chat/           ← AI prompts and thread config
│       │   ├── content/        ← Data and files
│       │   └── settings/       ← Styling, scripts, themes
│       └── agents-viewer/
│           └── System/
│               └── {agent}/
│                   ├── PROMPT.md
│                   ├── TRIGGERS.md
│                   ├── SESSION.md
│                   ├── WORKFLOW.md
│                   └── scripts/
├── CLAUDE.md (or equivalent)   ← Project-level AI instructions
└── README.md                   ← What this workspace does
```

Everything is files. Everything is shareable. Everything is forkable.

## The Inversion

Traditional SaaS:
- Company builds the product
- Company hosts it
- Company charges for it
- User configures within constraints
- Data lives on someone else's server

Open Robin workspace:
- Anyone builds the workspace
- It runs on your machine
- It's free
- You configure everything (files in folders)
- Data lives on your machine
- The "product" is the configuration itself

## Distribution Model

1. **Creator** builds a workspace (views, agents, prompts, scripts, wiki, styling)
2. **Creator** pushes to GitHub/GitLab
3. **User** clones the repo
4. **User** opens Open Robin, selects the workspace from the menu
5. Everything works — views, agents, scripts, prompts, wiki
6. **User** customizes colors, swaps scripts, tunes prompts for their needs
7. **User** can push their fork — the cycle continues

## What This Enables

- **Personal SaaS replacements** — Bookkeeping, CRM, project management, media library — all as workspace configs
- **Prompt engineering as a product** — The prompts, agent configs, and wiki ARE the value. Shareable, forkable, improvable.
- **Community templates** — Not just view templates, but entire workflow configurations. "Here's how I run my freelance business with Open Robin."
- **Signal/Telegram bots** — A workspace with agents that respond to messages from your phone. Your personal assistant runs at home, you talk to it remotely.
- **One-user apps** — Software designed for a single person, running locally, talking to your own data. The opposite of multi-tenant SaaS.

## Why This Works

- Files in folders = universal, versionable, diffable, mergeable
- Git = distribution, collaboration, history, rollback
- AI = the automation layer that makes configuration powerful
- Local = private, fast, no subscription, no downtime
- The runtime (Open Robin) is free and open source
- The value is in the workspace configuration, which is community-driven
