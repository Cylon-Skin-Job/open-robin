# Workspace Index Convention

Every workspace has an `index.json` at its root. This is the universal data loading pattern — the client always requests `index.json`, gets the full workspace state in one response, and renders it. No directory listings, no multi-step loading, no client-side parsing of raw files.

## The Rule

```
ai/workspaces/{workspace-id}/
├── workspace.json      ← identity, type, theme, settings
├── index.json          ← workspace state (the data the client renders)
└── ...                 ← workspace-specific files (tickets, pages, agents)
```

- `workspace.json` defines **what** the workspace is (type, theme, icon)
- `index.json` defines **what's in it** (the current state, ready to render)

## Why

The original issue: the issues workspace used a different loading paradigm than the wiki. The wiki requested `index.json` and got everything in one shot. The issues workspace did a directory listing (`file_tree_request`), then requested each ticket file individually, then parsed frontmatter on the client. This created timing bugs, race conditions, and put business logic in the client.

**Decision (2026-03-21):** All workspaces use `index.json`. One request, one response, one pattern. The workspace type determines how the data is displayed, not how it's loaded.

## Loading Pattern (Client)

Every workspace hook follows the same structure. Compare wiki and issues — they're identical:

```typescript
// Request
ws.send(JSON.stringify({
  type: 'file_content_request',
  workspace: WORKSPACE,
  path: 'index.json',
}));

// Response handler
if (msg.path === 'index.json' && msg.success) {
  const index = JSON.parse(msg.content);
  store.setFromIndex(index.domainKey || {});
}
```

The `domainKey` varies by workspace type:
- Wiki: `index.topics`
- Issues: `index.tickets`
- Agents: `index.agents`

## Index Structure

Every `index.json` has a common envelope:

```json
{
  "version": "1.0",
  "last_updated": "2026-03-21T12:00:00Z",
  "<domain_key>": { ... }
}
```

The domain key contains workspace-specific data, keyed by item ID:

### Wiki (`topics`)
```json
{
  "home": {
    "slug": "Home",
    "edges_out": ["Secrets"],
    "edges_in": ["Workspaces"]
  }
}
```

### Issues (`tickets`)
```json
{
  "KIMI-0001": {
    "title": "Fix the thing",
    "assignee": "kimi-wiki",
    "created": "2026-03-21T10:00:00Z",
    "author": "local",
    "state": "open",
    "body": "Description here"
  }
}
```

### Background Agents (`agents`)
```json
{
  "kimi-wiki": {
    "folder": "agents/wiki-updater",
    "status": "idle"
  }
}
```

## Who Maintains index.json

The workspace's own scripts maintain it. The server never writes to `index.json` directly — it only reads and serves it.

| Workspace | Maintained By |
|-----------|--------------|
| Wiki | Wiki sync scripts, edge discovery |
| Issues | `create-ticket.js`, sync scripts |
| Agents | Runner (on status changes) |

## What This Replaces

- No `file_tree_request` for workspace content — only for the coding-agent file explorer
- No client-side frontmatter parsing — server delivers parsed data via `index.json`
- No multi-step loading — one request, one response
- No workspace-specific loading hooks with different patterns

## Related

- [Workspaces](Workspaces) — overview of all workspace types
- [Session-Scoping](Session-Scoping) — how workspace sessions are isolated
