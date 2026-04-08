# Domain 3: Project-Wide File Watcher

Monitors the entire project for file deletions, renames, and path changes. When a watched file disappears and a wiki topic references it in its `sources` array, creates a ticket for the wiki-updater.

**Prerequisites (all exist):**
- Wiki index.json at `ai/workspaces/wiki/index.json` with topic entries
- Ticket creation at `ai/workspaces/issues/scripts/create-ticket.js`
- Wiki hooks at `kimi-ide-server/lib/wiki/hooks.js` (already watching wiki folder)

**Output:**
- `kimi-ide-server/lib/watcher.js` — project-wide file watcher module
- Updated `ai/workspaces/wiki/index.json` schema — `sources` array per topic

---

## What the Watcher Does

1. On server startup, scan wiki `index.json` for all `sources` arrays
2. Build a reverse lookup: `{file path} → [topic names that reference it]`
3. Watch the project root recursively (with exclusions)
4. On file delete/rename: check the lookup, create tickets if affected

---

## Step-by-Step Implementation

### Step 1: Add `sources` to Wiki Index Schema

Each topic in `ai/workspaces/wiki/index.json` gets a `sources` array listing the file paths it references:

```json
"secrets": {
  "slug": "Secrets",
  "edges_out": ["GitLab"],
  "edges_in": ["Home", "GitLab", "Wiki-System"],
  "sources": [
    "kimi-ide-server/lib/secrets.js",
    "scripts/setup-secrets.js",
    "scripts/git-credential-kimi.sh"
  ]
}
```

**Initial population:** The sources arrays are empty to start. They get populated two ways:
- The wiki-updater fills them during its verify step (Step 4 in its prompt)
- The wiki-auditor fills them during its nightly fact-check (Step 2)

For the first run, manually populate a few topics to test the watcher. The agents will maintain them going forward.

### Step 2: Build the Reverse Lookup

```javascript
function buildSourceLookup(wikiIndexPath) {
  const index = JSON.parse(fs.readFileSync(wikiIndexPath, 'utf8'));
  const lookup = new Map();  // filePath → [topicName, ...]

  for (const [topicName, meta] of Object.entries(index.topics)) {
    if (!meta.sources) continue;
    for (const sourcePath of meta.sources) {
      if (!lookup.has(sourcePath)) lookup.set(sourcePath, []);
      lookup.get(sourcePath).push(topicName);
    }
  }

  return lookup;
}
```

**Rebuild trigger:** The lookup is rebuilt whenever `index.json` changes (the wiki hooks already trigger on this).

### Step 3: Exclusion List

The watcher ignores paths that produce noise:

```javascript
const EXCLUDED = [
  'node_modules',
  'dist',
  '.git',
  '.kimi',
  'ai/workspaces/*/threads',     // chat sessions
  'ai/workspaces/*/runs',        // agent execution history
  'ai/workspaces/issues/done',   // closed tickets
  '*.log',
  'CHAT.md',
  'history.json',
  'wire-debug.log',
  'server-live.log',
];

function isExcluded(filePath) {
  for (const pattern of EXCLUDED) {
    if (pattern.startsWith('*')) {
      // Extension match
      if (filePath.endsWith(pattern.slice(1))) return true;
    } else if (pattern.includes('*')) {
      // Glob-style (simple: split on *, check prefix and suffix)
      const [prefix, suffix] = pattern.split('*');
      if (filePath.includes(prefix) && filePath.includes(suffix)) return true;
    } else {
      // Direct path segment match
      if (filePath.includes(pattern)) return true;
    }
  }
  return false;
}
```

### Step 4: Watch for Deletions and Renames

`fs.watch` reports `rename` events for both renames and deletes. The watcher needs to distinguish:

```javascript
function handleFileEvent(eventType, filePath, projectRoot) {
  if (eventType !== 'rename') return;
  if (isExcluded(filePath)) return;

  // Debounce per file (500ms)
  clearTimeout(pending.get(filePath));
  pending.set(filePath, setTimeout(async () => {
    pending.delete(filePath);

    const absolutePath = path.join(projectRoot, filePath);
    const stillExists = fs.existsSync(absolutePath);

    if (stillExists) {
      // File was created or renamed TO this path — not a deletion
      // Check if this is the "new" half of a rename
      checkForRenameTarget(filePath);
      return;
    }

    // File is gone — check if any wiki topic references it
    const affectedTopics = sourceLookup.get(filePath) || [];
    if (affectedTopics.length === 0) return;

    console.log(`[Watcher] Source file removed: ${filePath} → affects: ${affectedTopics.join(', ')}`);

    // Check for rename (did a new file appear in the same directory within 2 seconds?)
    recentDeletes.set(filePath, { timestamp: Date.now(), topics: affectedTopics });

    // After 2-second window, if no matching create appeared, it's a delete
    setTimeout(() => {
      const entry = recentDeletes.get(filePath);
      if (!entry) return;  // Was matched to a rename, already handled
      recentDeletes.delete(filePath);
      createDeletionTicket(filePath, entry.topics);
    }, 2000);

  }, 500));
}
```

### Step 5: Rename Detection

A rename appears as a delete + create within a short window. If a file disappears and a new file appears in the same directory shortly after, it's likely a rename.

```javascript
const recentDeletes = new Map();  // filePath → { timestamp, topics }

function checkForRenameTarget(newPath) {
  const dir = path.dirname(newPath);

  for (const [deletedPath, entry] of recentDeletes) {
    if (path.dirname(deletedPath) !== dir) continue;
    if (Date.now() - entry.timestamp > 2000) continue;

    // Likely a rename: deletedPath → newPath
    console.log(`[Watcher] Rename detected: ${deletedPath} → ${newPath}`);
    recentDeletes.delete(deletedPath);
    createRenameTicket(deletedPath, newPath, entry.topics);
    return;
  }
}
```

### Step 6: Create Tickets

**Deletion ticket:**
```javascript
async function createDeletionTicket(filePath, topics) {
  const { createTicket } = require('../../ai/workspaces/issues/scripts/create-ticket');
  createTicket({
    title: `Source file removed: ${path.basename(filePath)}`,
    assignee: 'kimi-wiki',
    body: `The file \`${filePath}\` was deleted. The following wiki topics reference this file in their sources:\n\n${topics.map(t => `- ${t}`).join('\n')}\n\nVerify these pages are still accurate and update their sources arrays.`
  });
}
```

**Rename ticket:**
```javascript
async function createRenameTicket(oldPath, newPath, topics) {
  const { createTicket } = require('../../ai/workspaces/issues/scripts/create-ticket');
  createTicket({
    title: `Source file renamed: ${path.basename(oldPath)} → ${path.basename(newPath)}`,
    assignee: 'kimi-wiki',
    body: `The file \`${oldPath}\` was renamed to \`${newPath}\`. The following wiki topics still reference the old path:\n\n${topics.map(t => `- ${t}`).join('\n')}\n\nUpdate these pages to reference the new path and update their sources arrays.`
  });
}
```

---

## Module Interface

```javascript
// kimi-ide-server/lib/watcher.js

/**
 * Start the project-wide file watcher.
 *
 * @param {string} projectRoot - Absolute path to project root
 * @param {string} wikiIndexPath - Path to ai/workspaces/wiki/index.json
 * @returns {{ close: () => void }} - Cleanup handle
 */
function start(projectRoot, wikiIndexPath) { }

/**
 * Rebuild the source lookup from index.json.
 * Called when index.json changes.
 *
 * @param {string} wikiIndexPath
 */
function rebuildLookup(wikiIndexPath) { }

module.exports = { start, rebuildLookup };
```

---

## Integration Points

**Server startup:**
```javascript
// In server.js, after server.listen
const watcher = require('./lib/watcher');
const wikiIndexPath = path.join(AI_WORKSPACES_PATH, 'wiki', 'index.json');
watcher.start(getDefaultProjectRoot(), wikiIndexPath);
```

**Wiki hooks trigger lookup rebuild:**
When `rebuildIndex()` in `lib/wiki/hooks.js` completes, call `watcher.rebuildLookup()` so the source lookup stays current.

---

## Test Plan

1. Manually add `sources` to a wiki topic in `index.json`:
   ```json
   "secrets": {
     ...
     "sources": ["kimi-ide-server/lib/secrets.js"]
   }
   ```
2. Start the server, verify watcher logs: `[Watcher] Watching {projectRoot} — {N} source paths tracked`
3. Rename `kimi-ide-server/lib/secrets.js` to `kimi-ide-server/lib/secrets-old.js`
4. Verify a ticket is created: "Source file renamed: secrets.js → secrets-old.js"
5. Rename it back
6. Delete a tracked file (create a temp file, add it to sources, delete it)
7. Verify a deletion ticket is created
8. Verify excluded paths don't trigger events

---

## Key Files

| File | Action |
|------|--------|
| `kimi-ide-server/lib/watcher.js` | **Create** — project-wide file watcher |
| `kimi-ide-server/server.js` | **Modify** — start watcher on boot |
| `kimi-ide-server/lib/wiki/hooks.js` | **Modify** — call rebuildLookup after index rebuild |
| `ai/workspaces/wiki/index.json` | **Modify** — add sources arrays to topics |

---

## What This Does NOT Build

- Source array population (agents do this during runs)
- Edge evaluation (handled by wiki-updater and wiki-auditor)
- Wiki content updates (wiki-updater handles tickets this watcher creates)
- Recursive `fs.watch` implementation may need `chokidar` or manual directory walking — Node's `fs.watch` recursive option is platform-dependent (works on macOS, not all Linux)
