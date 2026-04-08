# Hooks

Lifecycle hooks that fire when wiki content changes. These keep `index.json` current and can trigger downstream work (tickets, sync, edge discovery).

## Events

| Event | Trigger | What Happens |
|-------|---------|-------------|
| `on_create` | New topic folder + PAGE.md created | Rebuild index.json, assign edges, optionally create sync ticket |
| `on_edit` | Existing PAGE.md modified | Update index.json timestamps, check if edges changed, optionally create freshness ticket |

## on_create

Fires when a new topic folder appears with a `PAGE.md` inside it.

**Steps:**
1. Read the new PAGE.md
2. Add the topic to `index.json` with empty edges
3. Scan all existing topics — evaluate whether the new page should link to any of them
4. Write initial edges to `index.json`
5. Create a LOG.md entry: `## {date} — Created`
6. If GitLab sync is configured, create a ticket for `kimi-wiki` to push the new page

**What triggers it:**
- `fs.watch` on the `ai/workspaces/wiki/` directory for new folders
- The server detects a new subfolder containing `PAGE.md`

**Edge discovery on create:**
When a new topic is created, every existing topic is a candidate for cross-linking. The hook evaluates each pair (`new_page ↔ existing_page`) and writes edges where relevant. This mirrors what the LaunchPad `onWikiEvent` does on the cloud side, but locally.

## on_edit

Fires when an existing `PAGE.md` is modified.

**Steps:**
1. Read the updated PAGE.md
2. Update `last_updated` in `index.json` for this topic
3. Re-evaluate edges — content may have changed enough to add or remove links
4. Append to LOG.md: `## {date} — Updated`
5. If the edit changes the topic's scope significantly, create a ticket for `kimi-wiki` to check downstream pages

**What triggers it:**
- `fs.watch` on individual `PAGE.md` files within topic folders
- Debounced (500ms) to avoid double-fires from editors that write + rename

**Edge re-evaluation on edit:**
Strip the existing `## Related` section, re-evaluate all pairs, write updated edges. This prevents stale links from persisting after content changes.

## Implementation

Hooks live as a server module. The wiki workspace registers its watchers on server startup.

```
kimi-ide-server/
└── lib/
    └── wiki/
        └── hooks.js       ← fs.watch setup, on_create, on_edit handlers
```

**hooks.js contract:**

```javascript
module.exports = {
  // Called by server on startup
  start(wikiPath) {
    // Set up fs.watch on wikiPath
    // Watch for new folders (on_create)
    // Watch for PAGE.md changes (on_edit)
  },

  // Called by server on shutdown
  stop() {
    // Close all watchers
  }
};
```

**Debouncing:**
Both hooks use a 500ms debounce per file path. `fs.watch` fires multiple events for a single save — the debounce ensures the hook runs once with the final state.

**Index rebuild:**
Both hooks call the same `rebuildIndex()` function that scans all topic folders and regenerates `index.json`. This is idempotent — running it twice produces the same result. No partial updates, no merge conflicts.

```javascript
async function rebuildIndex(wikiPath) {
  const topics = {};
  const folders = await fs.readdir(wikiPath, { withFileTypes: true });

  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    const pagePath = path.join(wikiPath, folder.name, 'PAGE.md');
    if (!await exists(pagePath)) continue;

    topics[folder.name] = {
      slug: formatSlug(folder.name),
      edges_out: existingEdges[folder.name]?.edges_out || [],
      edges_in: existingEdges[folder.name]?.edges_in || []
    };
  }

  await fs.writeFile(indexPath, JSON.stringify({
    version: '1.0',
    last_updated: new Date().toISOString(),
    topics
  }, null, 2));
}
```

## Edge Discovery

Edge evaluation is the expensive part — it requires reading page content and deciding if two topics are related. Two approaches:

**Fast (keyword matching):**
- Extract headings and key terms from both pages
- Match on shared terms, linked slugs, or explicit `[Topic-Name]` references
- No LLM call — runs in milliseconds

**Deep (agent-assisted):**
- Create a ticket assigned to `kimi-wiki` with both page contents
- The wiki-updater orchestrator evaluates the pair and writes edges
- Used for `on_create` (new topic needs full evaluation against all existing topics)

The fast path runs on every `on_edit`. The deep path runs on `on_create` or when the fast path detects significant content changes.

## Source File Monitoring

Beyond wiki-internal changes, a project-wide file watcher monitors for deletions, renames, and path changes that affect wiki content.

### on_delete / on_rename

When a file disappears from the filesystem (deleted or renamed):

1. Check every topic's `sources` array in `index.json`
2. If the deleted path appears in any topic's sources, create a ticket:
   ```
   Title: "Source file removed: {path} — check {topic-name}"
   Assignee: kimi-wiki
   Body: "The file {path} was deleted or renamed. The wiki topic
          {topic-name} references this file in its sources. Verify
          the page is still accurate and update the sources array."
   ```
3. If the file reappears at a new path (rename detected as delete + create within a short window), include the new path in the ticket body

### How sources are populated

The wiki-updater maintains the `sources` array as part of its verify step. Every time it updates a page, it records which files the page references. The auditor also checks for missing source entries during its nightly review.

### What gets watched

Everything except:
- `node_modules/`, `dist/`, `.git/`
- `ai/workspaces/*/threads/` (chat sessions)
- `ai/workspaces/*/runs/` (agent execution history)
- `*.log`, `CHAT.md`, `history.json`

### Edge Updates via Tickets

Edge discovery no longer runs inline during hooks. Instead:

1. The wiki-updater evaluates after each content update whether edges may have changed
2. If yes, it creates an edge review ticket assigned to itself
3. The ticket includes a `blocks: {topic-name}` field, preventing future content updates to that topic until the edge review completes
4. The edge review runs as a normal ticket — gathers the changed topic + all related topics, evaluates pairs, updates `index.json` edges
5. On completion, the block is released

This keeps edge evaluation out of the hot path (no inline LLM calls during hooks) and ensures edges are always current before the next content update.

## What This Does NOT Do

- **No GitLab sync.** Hooks update the local `index.json` only. GitLab sync is a separate concern handled by the issues workspace sync scripts.
- **No full re-index on every edit.** The rebuild function is efficient (reads directory + existing index), but edge discovery only runs when content actually changes.
- **No blocking the server.** Hooks run async. A slow edge evaluation doesn't block WebSocket messages or other workspace operations.

## Related

- [Wiki-System](Wiki-System) — overall wiki architecture
- [Workspace-Index](Workspace-Index) — the index.json convention that hooks maintain
- [Ticket-Routing](Ticket-Routing) — how hooks create tickets for deeper evaluation
