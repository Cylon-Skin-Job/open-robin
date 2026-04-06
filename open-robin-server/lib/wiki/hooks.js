/**
 * Wiki lifecycle hooks — watches ai/views/wiki-viewer/content/ tree for topic creation and page edits.
 *
 * The wiki tree has collections (project/, system/, etc.) each containing topic folders.
 * This module scans all collections, builds a merged topics.json at the wiki root,
 * and watches for changes across all collections.
 *
 * topics.json is the client-facing index — it merges all collections into one flat
 * topic map with a `collection` field per topic so file paths resolve correctly.
 *
 * Pure data-access + filesystem module (Layer 4).
 * Does not emit events or touch DOM.
 */

const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

const DEBOUNCE_MS = 500;
const pending = new Map();
const watchers = [];
const knownTopics = new Map(); // "collection/topic" → true
let onIndexRebuilt = null;

/**
 * Discover collections by reading the root index.json children array.
 * Falls back to scanning for directories if no index.json exists.
 */
async function discoverCollections(wikiRoot) {
  const indexPath = path.join(wikiRoot, 'index.json');
  try {
    const raw = JSON.parse(await fsPromises.readFile(indexPath, 'utf8'));
    if (raw.children && Array.isArray(raw.children)) {
      return raw.children;
    }
  } catch {}

  // Fallback: scan for directories that contain an index.json
  const entries = await fsPromises.readdir(wikiRoot, { withFileTypes: true });
  return entries
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .filter(name => {
      try {
        fs.accessSync(path.join(wikiRoot, name, 'index.json'));
        return true;
      } catch { return false; }
    });
}

/**
 * Build the merged topics.json from all collections.
 * Each topic gets a `collection` field so the client knows the file path.
 * Topic IDs are prefixed with collection: "system/evidence-gated-execution"
 */
async function rebuildTopicsIndex(wikiRoot) {
  const collections = await discoverCollections(wikiRoot);
  const topics = {};
  const collectionMeta = [];

  for (const collectionId of collections) {
    const collectionPath = path.join(wikiRoot, collectionId);

    // Read collection index.json for metadata
    let collectionIndex = { label: formatSlug(collectionId), rank: 50, sort: 'ranked', frozen: false };
    try {
      const raw = JSON.parse(await fsPromises.readFile(path.join(collectionPath, 'index.json'), 'utf8'));
      collectionIndex = {
        label: raw.label || formatSlug(collectionId),
        rank: raw.rank ?? 50,
        sort: raw.sort || 'ranked',
        frozen: raw.frozen || false,
      };
    } catch {}

    collectionMeta.push({ id: collectionId, ...collectionIndex });

    // Scan for topic folders with PAGE.md
    let entries;
    try {
      entries = await fsPromises.readdir(collectionPath, { withFileTypes: true });
    } catch { continue; }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pagePath = path.join(collectionPath, entry.name, 'PAGE.md');
      try {
        await fsPromises.access(pagePath);
      } catch { continue; }

      // Read topic's own index.json for metadata
      let topicIndex = {};
      try {
        topicIndex = JSON.parse(await fsPromises.readFile(
          path.join(collectionPath, entry.name, 'index.json'), 'utf8'
        ));
      } catch {}

      const topicId = `${collectionId}/${entry.name}`;
      topics[topicId] = {
        slug: topicIndex.label || formatSlug(entry.name),
        collection: collectionId,
        collectionLabel: collectionIndex.label,
        collectionRank: collectionIndex.rank,
        rank: topicIndex.rank ?? 10,
        frozen: topicIndex.frozen ?? collectionIndex.frozen,
        edges_out: topicIndex.edges_out || [],
        edges_in: topicIndex.edges_in || [],
        sources: topicIndex.sources || [],
      };
    }
  }

  // Sort collections by rank
  collectionMeta.sort((a, b) => a.rank - b.rank);

  const index = {
    version: '1.0',
    last_updated: new Date().toISOString(),
    collections: collectionMeta,
    topics,
  };

  const topicsPath = path.join(wikiRoot, 'topics.json');
  await fsPromises.writeFile(topicsPath, JSON.stringify(index, null, 2) + '\n', 'utf8');
  console.log(`[WikiHooks] Rebuilt topics.json — ${Object.keys(topics).length} topics across ${collections.length} collections`);

  if (typeof onIndexRebuilt === 'function') {
    try { onIndexRebuilt(topicsPath); } catch (err) {
      console.error('[WikiHooks] onIndexRebuilt callback error:', err);
    }
  }

  return index;
}

/**
 * Format a folder name into a display slug.
 * "workspace-index" → "Workspace-Index"
 */
function formatSlug(name) {
  return name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('-');
}

/**
 * Append a dated entry to a topic's LOG.md.
 */
async function appendLog(topicPath, message) {
  const logPath = path.join(topicPath, 'LOG.md');
  const date = new Date().toISOString().slice(0, 10);
  const entry = `\n## ${date} — ${message}\n`;

  try {
    await fsPromises.access(logPath);
    await fsPromises.appendFile(logPath, entry, 'utf8');
  } catch {
    const topicName = path.basename(topicPath);
    const header = `# ${formatSlug(topicName)} — Log\n${entry}`;
    await fsPromises.writeFile(logPath, header, 'utf8');
  }
  console.log(`[WikiHooks] Logged: ${path.basename(topicPath)} — ${message}`);
}

/**
 * Watch a topic folder for PAGE.md changes.
 */
function watchTopicFolder(wikiRoot, collectionId, topicName) {
  const key = `${collectionId}/${topicName}`;
  if (knownTopics.has(key)) return;
  knownTopics.set(key, true);

  const folderPath = path.join(wikiRoot, collectionId, topicName);
  try {
    const tw = fs.watch(folderPath, (event, filename) => {
      if (filename !== 'PAGE.md') return;

      const debounceKey = `${key}/PAGE.md`;
      if (pending.has(debounceKey)) clearTimeout(pending.get(debounceKey));

      pending.set(debounceKey, setTimeout(async () => {
        pending.delete(debounceKey);
        console.log(`[WikiHooks] on_edit: ${key}`);
        await rebuildTopicsIndex(wikiRoot);
        await appendLog(folderPath, 'Updated');
      }, DEBOUNCE_MS));
    });
    watchers.push(tw);
  } catch (err) {
    console.error(`[WikiHooks] Failed to watch ${key}:`, err.message);
  }
}

/**
 * Watch a collection folder for new topic folders.
 */
function watchCollection(wikiRoot, collectionId) {
  const collectionPath = path.join(wikiRoot, collectionId);

  try {
    const tw = fs.watch(collectionPath, (event, filename) => {
      if (!filename) return;

      const debounceKey = `collection:${collectionId}:${filename}`;
      if (pending.has(debounceKey)) clearTimeout(pending.get(debounceKey));

      pending.set(debounceKey, setTimeout(async () => {
        pending.delete(debounceKey);

        const fullPath = path.join(collectionPath, filename);
        const stat = await fsPromises.stat(fullPath).catch(() => null);
        if (!stat || !stat.isDirectory()) return;

        const key = `${collectionId}/${filename}`;
        if (knownTopics.has(key)) return;

        // Check if PAGE.md exists
        try {
          await fsPromises.access(path.join(fullPath, 'PAGE.md'));
          console.log(`[WikiHooks] on_create: ${key}`);
          watchTopicFolder(wikiRoot, collectionId, filename);
          await rebuildTopicsIndex(wikiRoot);
          await appendLog(fullPath, 'Created');
        } catch {}
      }, DEBOUNCE_MS));
    });
    watchers.push(tw);
  } catch (err) {
    console.error(`[WikiHooks] Failed to watch collection ${collectionId}:`, err.message);
  }
}

/**
 * Start watching the wiki tree for changes.
 * Scans all collections, sets up watchers on each collection and topic folder,
 * and builds the initial topics.json.
 */
function start(wikiRoot) {
  if (!fs.existsSync(wikiRoot)) {
    console.error(`[WikiHooks] Wiki root not found: ${wikiRoot}`);
    return null;
  }

  // Discover collections synchronously for startup
  let collections;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(wikiRoot, 'index.json'), 'utf8'));
    collections = raw.children || [];
  } catch {
    collections = fs.readdirSync(wikiRoot, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
  }

  // Scan each collection for existing topics and set up watchers
  for (const collectionId of collections) {
    const collectionPath = path.join(wikiRoot, collectionId);
    if (!fs.existsSync(collectionPath)) continue;

    const entries = fs.readdirSync(collectionPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pagePath = path.join(collectionPath, entry.name, 'PAGE.md');
      if (fs.existsSync(pagePath)) {
        watchTopicFolder(wikiRoot, collectionId, entry.name);
      }
    }

    watchCollection(wikiRoot, collectionId);
  }

  // Build initial topics.json
  rebuildTopicsIndex(wikiRoot).catch(err => {
    console.error('[WikiHooks] Failed to build initial topics.json:', err);
  });

  console.log(`[WikiHooks] Watching ${wikiRoot} — ${knownTopics.size} topics across ${collections.length} collections`);

  return {
    close() {
      for (const tw of watchers) { tw.close(); }
      watchers.length = 0;
      knownTopics.clear();
      pending.clear();
      console.log('[WikiHooks] Stopped watching');
    }
  };
}

/**
 * Register a callback to be called after every index rebuild.
 * @param {Function} fn - Receives the topicsPath as argument
 */
function setOnIndexRebuilt(fn) { onIndexRebuilt = fn; }

module.exports = { start, rebuildTopicsIndex, setOnIndexRebuilt };
