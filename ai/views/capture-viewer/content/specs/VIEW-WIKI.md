---
title: View Spec — Wiki
created: 2026-03-28
status: active
parent: MASTER_SYSTEM_SPEC.md
---

# Wiki View

The project wiki is a knowledge graph of interconnected pages. Each topic is a folder with a PAGE.md and metadata. Edges connect topics. Agents maintain freshness.

---

## Layout

```
┌───────────────────┬──────────────────────────┐
│  Topic Tree       │  Page Viewer             │
│                   │                          │
│  ● Home           │  # Secrets               │
│  ● Secrets        │                          │
│  ● GitLab         │  How secrets work...     │
│  ● Wiki-System    │                          │
│  ● Architecture   │  Edges: Home, GitLab     │
│                   │  Sources: secrets.js     │
└───────────────────┴──────────────────────────┘
```

---

## Two Wikis

### Project Wiki (in repo)
- Lives in `ai/views/wiki/` or `ai/wiki-data/`
- Folder-based: each topic is a folder with PAGE.md
- Has edges (links between topics), sources (files it references)
- Syncs via repo — collaborators see the same wiki
- Agents maintain it via tickets (wiki-updater, wiki-auditor)

### System Wiki (in SQLite, Robin's domain)
- Not browsable as a standalone view
- Surfaces as tooltips, contextual content, inline help
- Hardcoded into the app
- See VIEW-ROBIN.md

---

## Topic Structure

```
wiki/{topic-slug}/
  PAGE.md           ← the content
  LOG.md            ← change history
  metadata.json     ← edges, sources, freshness
```

### topics.json (index)

```json
{
  "secrets": {
    "slug": "Secrets",
    "edges_out": ["GitLab"],
    "edges_in": ["Home", "GitLab"],
    "sources": ["kimi-ide-server/lib/secrets.js"]
  }
}
```

---

## Agent Integration

- **wiki-updater**: Receives tickets when source files change, updates PAGE.md
- **wiki-auditor**: Nightly freshness check, creates tickets for stale pages
- **File watcher** (DOMAIN-3): Monitors source files, creates tickets when they're renamed/deleted

---

## GitLab Sync

Project wiki can sync bidirectionally with GitLab wiki pages. Local is source of truth for locally-created pages. GitLab is source of truth for externally-created pages.

---

## TODO

- [ ] Edge graph visualization
- [ ] Topic search
- [ ] Freshness indicators (green/yellow/red based on last update vs source changes)
- [ ] Pop-up chat scoped to wiki workspace
- [ ] Inline page editing
