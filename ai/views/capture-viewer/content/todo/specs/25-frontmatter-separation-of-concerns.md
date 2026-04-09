# SPEC-25 — Frontmatter Separation of Concerns

**Parent:** none (standalone precursor to SPEC-24b)
**Position:** Unblocks SPEC-24b (ChatFile rework). Also paves the way for SPEC-30 (hot reload on settings/ changes) by giving it a single canonical parser import point to wire a watcher subscription into.
**Depends on:** SPEC-24a merged (the commit that introduces `lib/frontmatter/` as a new directory must land on a clean post-24a tree).
**Model recommendation:** **Sonnet 4.6** is sufficient. This is a mechanical extraction — one new directory with four small files, four importers rewired, one duplicate parser deleted, zero behavior change on the happy path.
**Estimated blast radius:** **Low.** No wire-protocol changes, no DB changes, no client changes, no new deletions of code the user might miss. The one risk area is a latent semantic drift in tickets (flat-string parser → typed parser), which is called out explicitly below and mitigated by a grep check before editing.

---

## Your mission

Extract the YAML frontmatter parser from `lib/watcher/filter-loader.js` and the duplicate inline parser from `lib/tickets/loader.js` into a new canonical module at `lib/frontmatter/`. Add a **catalog** that declares which file types are allowed to participate in frontmatter-driven behavior. Any caller asking to parse an uncatalogued type gets a loud error — this is the enforcement bite that makes the activation surface explicit and auditable.

After this phase:
- `lib/frontmatter/parser.js` — the parser logic (adapted from `filter-loader.js:16-85`)
- `lib/frontmatter/serializer.js` — the serializer (new, for SPEC-24b to consume)
- `lib/frontmatter/catalog.js` — the registry of known frontmatter file types
- `lib/frontmatter/index.js` — the public API, with a type-gate wrapper that throws on uncatalogued types
- Four importers rewired: `trigger-parser.js`, `component-loader.js`, `filter-loader.js` (internal), `tickets/loader.js`
- `tickets/loader.js`'s inline 11-line duplicate parser is deleted
- `filter-loader.js` no longer exports `parseFrontmatter` (no more cross-subsystem `require('../watcher/filter-loader')` for parsing)
- The `chat` catalog entry exists as a **stub** — declared but unused until SPEC-24b wires up ChatFile.js

**The catalog has five entries at creation:**

| Type | What it parses | Activates event bus? |
|---|---|---|
| `trigger` | TRIGGERS.md files under agent/view settings/ folders | **yes** |
| `ticket` | Ticket .md files under issues-viewer/tickets/ | no |
| `filter` | Filter definition .md files (watcher-internal) | **yes** |
| `component` | Component config.md under ai/components/*/settings/ | no |
| `chat` | (stub) Chat thread .md files under ai/views/*/chat/threads/ | no |

No `prompt`, no `lesson`, no `workflow`. Per feedback memory: the agent/workflow/prompts area is intentionally in flux — do not add entries for subsystems that don't exist yet. Future catalog entries are a one-line addition when the subsystems crystallize.

**You are not touching:**
- `lib/thread/ChatFile.js` (SPEC-24b will add the first real `chat` caller)
- Any client code (no frontmatter handling lives on the client)
- Any DB schema
- Any wire protocol
- `lib/startup.js` (trigger loading still happens at boot via the same `loadTriggers()` call chain — only the import path inside trigger-parser.js changes)
- Any hot-reload wiring (that's SPEC-30)

Resist the urge to add field validation, schema enforcement, path-based pattern matching, or runtime type checking. The `fields` array in the catalog is **documentation-only** in this spec. Those are consumers of the catalog, not part of it. Keep the precursor tiny and orthogonal.

---

## Context before you touch code

Read these in order:

1. **`ai/views/wiki-viewer/content/enforcement/code-standards/PAGE.md`** — the house rules. Pay attention to "one job per file", "delete don't deprecate", and "no premature abstractions".
2. **`ai/views/capture-viewer/content/todo/specs/24-chat-simplification.md`** — SPEC-24 parent. Understand that SPEC-25 is a precursor for 24b.
3. **`open-robin-server/lib/watcher/filter-loader.js`** — read all of `parseFrontmatter()` (L16-63), `parseValue()` (L65-85), and the exports (L310). You are lifting the first two out wholesale.
4. **`open-robin-server/lib/triggers/trigger-parser.js`** — all 73 lines. Understands the TRIGGERS.md multi-block format and calls `parseFrontmatter(wrapped)` at L54.
5. **`open-robin-server/lib/components/component-loader.js`** — read L1-90. Calls `parseFrontmatter(configContent)` at L69.
6. **`open-robin-server/lib/tickets/loader.js`** — all 79 lines. Has its own inline 11-line frontmatter parser at L24-34. This is the duplicate you're deleting.

### Line-number drift verification

Before editing, run:

```bash
cd open-robin-server

wc -l lib/watcher/filter-loader.js lib/triggers/trigger-parser.js \
      lib/components/component-loader.js lib/tickets/loader.js
```

Expected (tolerate ±3 lines):
- `filter-loader.js` ≈ 310
- `trigger-parser.js` ≈ 73
- `component-loader.js` ≈ 90+
- `tickets/loader.js` ≈ 79

Then grep for every touchpoint:

```bash
grep -rn "parseFrontmatter\|require.*watcher/filter-loader" lib server.js
```

Expected matches (after filtering out `wire-debug.log.old`):
- `lib/watcher/filter-loader.js` — definition at L16, internal call at L281, export at L310
- `lib/triggers/trigger-parser.js` — import at L9, call at L54
- `lib/components/component-loader.js` — import at L15, call at L69

If drift is more than ±3 lines, re-read and re-pick insertion points from context.

### Behavioral-difference audit (the one real risk)

Before editing, verify no ticket code relies on the old flat-string parser's type behavior:

```bash
grep -rn "ticket\.\(priority\|blocks\|blocked_by\|status\|id\)" lib server.js
grep -rn 'frontmatter\.\(priority\|blocks\|blocked_by\|status\|id\)\s*===' lib server.js
```

**What you're looking for:** string comparisons like `ticket.priority === "3"` that would break when the new parser coerces `priority: 3` to number `3`. If you find any, flag them in the report-back — the fix is to change the comparison to numeric (`=== 3`), which is the correct behavior anyway. The old inline parser was silently wrong.

**What's safe:** string-typed fields like `id`, `status`, `assignee`, `title` — these are unchanged because parseValue leaves unquoted non-numeric strings alone.

**Special case — `null`:** both old and new parsers return the literal string `"null"` when a field is set to `null` in YAML (neither parser recognizes the token). `tickets/loader.js:36-37` has post-processing that sets `blocks`/`blocked_by` to JS null when they're *absent*, not when they're the string `"null"`. That post-processing stays in place after the rewire — it handles a different case.

---

## Changes — file by file

### 1. Create `open-robin-server/lib/frontmatter/parser.js`

New file. Lift `parseFrontmatter` + `parseValue` from `filter-loader.js:16-85` unchanged. Add a module header.

```js
/**
 * Frontmatter parser — lift-and-shifted from lib/watcher/filter-loader.js
 * as part of SPEC-25.
 *
 * Parses YAML frontmatter from a markdown string. Returns
 * { frontmatter: {}, body: '' }. When no --- block is present, returns
 * { frontmatter: {}, body: content } (empty frontmatter, body = full input).
 *
 * Supports: nested objects (via indentation stack), inline arrays,
 * booleans, numbers, quoted strings, and line comments (#).
 *
 * Does NOT enforce catalog types — see lib/frontmatter/index.js for the
 * type-gated public API. Callers should import from there, not from
 * this file directly.
 */

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const fm = {};
  let stack = [];

  for (const line of match[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const raw = line.slice(colonIdx + 1).trim();
    const indent = line.search(/\S/);

    while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
      const popped = stack.pop();
      const parent = stack.length > 0 ? stack[stack.length - 1].obj : fm;
      parent[popped.key] = popped.obj;
    }

    if (raw === '' || raw === '|') {
      stack.push({ key, obj: {}, indent });
      continue;
    }

    const target = stack.length > 0 ? stack[stack.length - 1].obj : fm;
    target[key] = parseValue(raw);
  }

  while (stack.length > 0) {
    const popped = stack.pop();
    const parent = stack.length > 0 ? stack[stack.length - 1].obj : fm;
    if (Object.keys(popped.obj).length > 0) {
      parent[popped.key] = popped.obj;
    }
  }

  return { frontmatter: fm, body: match[2].trim() };
}

function parseValue(raw) {
  if (!raw) return null;

  if (raw.startsWith('[') && raw.endsWith(']')) {
    return raw.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
  }
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

module.exports = { parseFrontmatter, parseValue };
```

**Important:** the body is returned trimmed (`match[2].trim()`) when frontmatter is present, but **untrimmed** (the full `content`) when no frontmatter is found. This is the existing behavior and MUST be preserved — component-loader depends on the "full content" fallback path for configs that lack frontmatter, and some callers inspect `body` for downstream logic.

### 2. Create `open-robin-server/lib/frontmatter/serializer.js`

New file. 24b will use this; SPEC-25 creates it so 24b can drop straight in without adding to `lib/frontmatter/` again.

```js
/**
 * Frontmatter serializer — the write-side counterpart to parser.js.
 *
 * Converts a flat JS object into a YAML frontmatter block (--- delimited).
 *
 * Scope: MVP supports strings, numbers, booleans, null, and inline arrays.
 * Nested objects are NOT supported in SPEC-25 — if a caller passes one,
 * the serializer throws loudly. Add nested-object support when a real
 * caller needs it, not before.
 *
 * Round-trip guarantee: parse(serialize(x)) deep-equals x for all
 * supported value types.
 */

function serializeFrontmatter(data) {
  if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
    return '';
  }

  const lines = ['---'];
  for (const [key, value] of Object.entries(data)) {
    lines.push(`${key}: ${serializeValue(value)}`);
  }
  lines.push('---');
  return lines.join('\n') + '\n';
}

function serializeValue(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) {
    return '[' + v.map(serializeValue).join(', ') + ']';
  }
  if (typeof v === 'object') {
    throw new Error(
      'lib/frontmatter/serializer: nested objects not supported in MVP. ' +
      'Add support when a caller needs it.'
    );
  }

  // String — quote if it contains YAML-significant chars or edge whitespace.
  const s = String(v);
  if (/[:#\n"']/.test(s) || s.trim() !== s || s === 'true' || s === 'false' || s === 'null' || /^\d+$/.test(s)) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}

module.exports = { serializeFrontmatter, serializeValue };
```

The quoting rule also catches strings that would *look* like booleans/nulls/numbers on parse-back, so round-trip preserves the original type. `"true"` stays a string after round-trip, not a boolean.

### 3. Create `open-robin-server/lib/frontmatter/catalog.js`

New file. The registry — the authoritative list of file types that are allowed to participate in frontmatter-driven behavior.

```js
/**
 * Frontmatter type catalog.
 *
 * The authoritative list of file types that are allowed to participate
 * in frontmatter-driven behavior. Files NOT in this catalog cannot be
 * parsed through lib/frontmatter/index.js — the type-gate throws.
 *
 * Adding a new entry here is the ONLY way to expand the frontmatter
 * activation surface. Reviewers: scrutinize additions, especially any
 * with activatesEventBus: true.
 *
 * The `fields` array is documentation-only in SPEC-25. Runtime field
 * validation may be added later if a caller needs it — do not add it
 * preemptively.
 *
 * The `activatesEventBus` flag is also documentation-only today. It
 * exists to make the activation surface explicit and grep-friendly.
 * SPEC-30 (hot reload on settings/ changes) may consume it.
 */

module.exports = {
  trigger: {
    description: 'TRIGGERS.md files under agent/view settings/ folders. Each block registers an event bus listener or a cron job.',
    fields: [],  // accept any — triggers are free-form
    activatesEventBus: true,
  },

  ticket: {
    description: 'Ticket metadata for the issues-viewer Kanban board.',
    fields: [],  // expected: id, title, status, assignee, blocks, blocked_by (not enforced)
    activatesEventBus: false,
  },

  filter: {
    description: 'Watcher filter definitions — declarative file-change filters with match/exclude patterns, actions, and templates.',
    fields: [],
    activatesEventBus: true,
  },

  component: {
    description: 'Declarative UI component configs (modals, etc.) under ai/components/*/settings/config.md.',
    fields: [],
    activatesEventBus: false,
  },

  chat: {
    description: '(STUB — wired up in SPEC-24b.) Chat thread display metadata. Filename is the thread ID; frontmatter holds the display name only.',
    fields: ['name'],
    activatesEventBus: false,
  },
};
```

### 4. Create `open-robin-server/lib/frontmatter/index.js`

New file. The public API. Every caller imports from here.

```js
/**
 * Frontmatter — public API.
 *
 * The single import point for all frontmatter parsing and serialization
 * across the server. Every caller must pass a `type` parameter to
 * parseFrontmatter() that exists in the catalog; otherwise the call
 * throws. This is the enforcement bite that keeps the activation
 * surface explicit.
 *
 * SPEC-25 introduces this module. See SPEC-25.md for rationale.
 */

const { parseFrontmatter: parseRaw } = require('./parser');
const { serializeFrontmatter } = require('./serializer');
const catalog = require('./catalog');

/**
 * Parse YAML frontmatter from a markdown string.
 *
 * @param {string} content - Full file content.
 * @param {string} type - Catalog type (e.g. 'trigger', 'chat'). MUST be
 *   registered in lib/frontmatter/catalog.js.
 * @returns {{ frontmatter: object, body: string }}
 * @throws {Error} if `type` is not in the catalog.
 */
function parseFrontmatter(content, type) {
  if (!type || !(type in catalog)) {
    const known = Object.keys(catalog).join(', ');
    throw new Error(
      `lib/frontmatter: unknown type "${type}". ` +
      `Known types: ${known}. ` +
      `Add an entry to lib/frontmatter/catalog.js to expand the activation surface.`
    );
  }
  return parseRaw(content);
}

module.exports = {
  parseFrontmatter,
  serializeFrontmatter,
  catalog,
};
```

---

### 5. `open-robin-server/lib/watcher/filter-loader.js`

**5a. Delete `parseFrontmatter` and `parseValue` function bodies (L16-85).**

Both functions are fully replaced by `lib/frontmatter/parser.js`. Do not leave stub forwarders — clean cut, delete both entirely.

**5b. Add an import at the top (around L10).**

```js
const { parseFrontmatter } = require('../frontmatter');
```

**5c. Update the internal call site at the old L281.**

Current:
```js
        const { frontmatter } = parseFrontmatter(content);
```

New:
```js
        const { frontmatter } = parseFrontmatter(content, 'filter');
```

**5d. Remove `parseFrontmatter` from the exports (L310).**

Current:
```js
module.exports = { loadFilters, parseFrontmatter, matchesPattern, applyTemplate, buildFilter, evaluateCondition };
```

New:
```js
module.exports = { loadFilters, matchesPattern, applyTemplate, buildFilter, evaluateCondition };
```

`parseFrontmatter` is no longer re-exported from here. Any external importer still reaching into `lib/watcher/filter-loader` for the parser will now fail loudly — which is the intended behavior. Grep will catch any stragglers in step 9.

**5e. Verify the file's docblock no longer references frontmatter parsing as a responsibility.**

The file header (L1-8) says filters use YAML frontmatter and documents the helper. You don't need to strip the mention — the file still *consumes* frontmatter via the shared parser, it just doesn't *own* the parser anymore. A one-line doc update is fine:

Before:
```js
// Declarative filter loader — reads .md filter definitions from a directory
// and converts them into watcher filter objects.
```

After (add a pointer):
```js
// Declarative filter loader — reads .md filter definitions from a directory
// and converts them into watcher filter objects.
//
// Frontmatter parsing is delegated to lib/frontmatter/ (see SPEC-25).
```

---

### 6. `open-robin-server/lib/triggers/trigger-parser.js`

**6a. Update the import at L9.**

Current:
```js
const { parseFrontmatter } = require('../watcher/filter-loader');
```

New:
```js
const { parseFrontmatter } = require('../frontmatter');
```

**6b. Update the call site at L54.**

Current:
```js
        const { frontmatter } = parseFrontmatter(wrapped);
```

New:
```js
        const { frontmatter } = parseFrontmatter(wrapped, 'trigger');
```

Nothing else in this file changes.

---

### 7. `open-robin-server/lib/components/component-loader.js`

**7a. Update the import at L15.**

Current:
```js
const { parseFrontmatter } = require('../watcher/filter-loader');
```

New:
```js
const { parseFrontmatter } = require('../frontmatter');
```

**7b. Update the call site at L69.**

Current:
```js
  const { frontmatter } = parseFrontmatter(configContent);
```

New:
```js
  const { frontmatter } = parseFrontmatter(configContent, 'component');
```

Nothing else in this file changes.

---

### 8. `open-robin-server/lib/tickets/loader.js`

This file has the duplicate inline parser and needs the most rewire.

**8a. Delete the inline parser (L24-34).**

Current:
```js
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;

  const frontmatter = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    frontmatter[key] = value;
  }
```

DELETE these 11 lines entirely.

**8b. Replace with a call to the shared parser.**

Add an import at the top (around L8):
```js
const { parseFrontmatter } = require('../frontmatter');
```

Then inside `loadTicket()`, after the `raw = fs.readFileSync(...)` block, replace the deleted inline logic with:

```js
  const { frontmatter, body } = parseFrontmatter(raw, 'ticket');

  // A ticket must have at least one frontmatter field. If the file has no
  // --- block, parseFrontmatter returns { frontmatter: {}, body: raw } —
  // that's "not a ticket" in this context, so return null to match the
  // pre-SPEC-25 behavior.
  if (Object.keys(frontmatter).length === 0) return null;

  frontmatter.blocks = frontmatter.blocks || null;
  frontmatter.blocked_by = frontmatter.blocked_by || null;

  return {
    frontmatter,
    body,
    filename: path.basename(filePath),
  };
```

**8c. Remove the old `body` extraction.**

The old code had `body: match[2].trim()` in the return. The new code uses `body` from the destructured parser result, which is already trimmed. Remove the `match` variable references.

**Expected behavior change (call it out in report-back):** fields that look numeric (e.g. `priority: 3`) are now typed as numbers instead of strings. Per the behavioral-difference audit in the "Context" section above, this is a correctness improvement — any code comparing ticket fields to string literals was already buggy. Flag if you find any.

Also note: the `frontmatter.blocks = frontmatter.blocks || null` post-processing stays in place. It handles the case where the field is absent from the file, not where it's literally the string `"null"` (which neither parser handles specially).

---

### 9. Verification — stale references must all be gone

After all 8 edits above, run:

```bash
cd open-robin-server

# Old import path — should have zero hits now
grep -rn "require.*watcher/filter-loader" lib server.js
# Expected: zero hits

# Old exports list — filter-loader should no longer re-export parseFrontmatter
grep -n "parseFrontmatter" lib/watcher/filter-loader.js
# Expected: zero hits (the definition and export are gone)

# New import path — should have at least 4 hits (filter-loader, trigger-parser,
# component-loader, tickets/loader)
grep -rn "require.*\./frontmatter\|require.*\.\./frontmatter" lib
# Expected: 4 hits in the four rewired files

# Every parseFrontmatter call must now include a type argument
grep -rn "parseFrontmatter(" lib server.js | grep -v "lib/frontmatter"
# Expected output: every call site has a second argument. Specifically,
# lines matching `parseFrontmatter\(.*,\s*'(trigger|ticket|filter|component|chat)'\)`.
# If any line has only one argument, that's a bug — the type-gate will throw at runtime.

# Tickets' inline parser must be gone
grep -n "match\[1\]\.split" lib/tickets/loader.js
# Expected: zero hits
```

All five checks must be zero-hit (or the expected 4-hit count) before proceeding.

---

## Test plan

### Unit / static checks

```bash
cd open-robin-server

# Module loads cleanly
node -e "require('./lib/frontmatter')"
node -e "require('./lib/frontmatter/parser')"
node -e "require('./lib/frontmatter/serializer')"
node -e "require('./lib/frontmatter/catalog')"
node -e "require('./lib/watcher/filter-loader')"
node -e "require('./lib/triggers/trigger-parser')"
node -e "require('./lib/components/component-loader')"
node -e "require('./lib/tickets/loader')"
# All expected: no errors

# Type-gate throws on unknown type
node -e "const {parseFrontmatter} = require('./lib/frontmatter'); try { parseFrontmatter('---\nfoo: bar\n---', 'prompt'); console.log('FAIL: should have thrown'); } catch(e) { console.log('PASS:', e.message); }"
# Expected: PASS: lib/frontmatter: unknown type "prompt". ...

# Type-gate accepts catalogued types
node -e "const {parseFrontmatter} = require('./lib/frontmatter'); const r = parseFrontmatter('---\nname: hello\n---', 'chat'); console.log('name =', r.frontmatter.name);"
# Expected: name = hello

# Serializer round-trip
node -e "
const {parseFrontmatter, serializeFrontmatter} = require('./lib/frontmatter');
const original = { name: 'test thread', harness: 'kimi', count: 3, active: true };
const written = serializeFrontmatter(original);
console.log('Written:');
console.log(written);
const { frontmatter: parsed } = parseFrontmatter(written, 'chat');
console.log('Parsed:', parsed);
const match = JSON.stringify(original) === JSON.stringify(parsed);
console.log('Round-trip:', match ? 'PASS' : 'FAIL');
"
# Expected: Round-trip: PASS

# Run the existing smoke test
node test/smoke-spec03-spec15.js
# Expected: all assertions pass (nothing in that test touches frontmatter —
# it should be unaffected)
```

### Live validation (server boot)

```bash
# Kill any running server first
pkill -9 -f "node.*server.js" || true

# Start the server
node server.js 2>&1 | head -60 &
sleep 4

# Check it's up
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/
# Expected: 200

# Verify triggers, filters, and components all loaded during startup
grep -c "\[TriggerLoader\] .*parsed" server-live.log
# Expected: ≥ 1 (trigger loader still works)

grep -c "\[Watcher\] Filter registered" server-live.log
# Expected: ≥ 1 (filter loader still works)

# Verify no parseFrontmatter errors
grep -i "parseFrontmatter\|frontmatter.*error\|frontmatter.*unknown" server-live.log
# Expected: zero hits (no runtime type-gate failures)
```

### Ticket-behavior regression check

If the issues-viewer has any ticket files in `ai/views/issues-viewer/tickets/`:

```bash
# List what's there
ls ai/views/issues-viewer/tickets/*.md 2>/dev/null

# If any exist, load one through the new parser and compare output
node -e "
const { loadTicket } = require('./lib/tickets/loader');
const fs = require('fs');
const path = require('path');
const dir = 'ai/views/issues-viewer/tickets';
if (!fs.existsSync(dir)) { console.log('No tickets dir; skipping'); process.exit(0); }
const files = fs.readdirSync(dir).filter(f => f.endsWith('.md') && f.startsWith('KIMI-'));
if (files.length === 0) { console.log('No ticket files; skipping'); process.exit(0); }
const first = loadTicket(path.join(dir, files[0]));
console.log(JSON.stringify(first, null, 2));
"
# Expected: the ticket parses successfully. Numeric fields (like priority, if present)
# will now be numbers instead of strings. Flag this in the report-back.
```

### What breaks if you get it wrong

| Failure | Root cause | Fix |
|---|---|---|
| Server startup: `Cannot find module '../frontmatter'` | Forgot to create one of the four files in lib/frontmatter/ | Re-do steps 1-4 |
| Server startup: `Cannot find module '../watcher/filter-loader'` from trigger-parser | Forgot to update the import in step 6a | See 6a |
| `[TriggerLoader] ... parsed 0 triggers` (was nonzero before) | Type-gate is throwing silently, getting caught somewhere | Check `parseFrontmatter(wrapped, 'trigger')` has the type arg |
| Runtime error: `lib/frontmatter: unknown type "undefined"` | A caller is still passing one argument | grep for `parseFrontmatter(` and find the offender |
| Tickets suddenly have numeric fields where strings were expected | Expected behavior change — not a bug, but flag it | Report which comparisons need updating |
| Filter loader boot-error on parseFrontmatter | Forgot the internal rewire in step 5c | See 5c |
| `lib/watcher/filter-loader.js` module load error: `parseFrontmatter is not defined` | Deleted the function but left a stale internal call | grep `parseFrontmatter` inside filter-loader.js after edits — should only appear in the import line |

---

## Do not do

- **Do not** add field validation to `parseFrontmatter`. The `fields` array in the catalog is documentation-only in this spec. A later spec may add validation if a caller actually needs it.
- **Do not** add path-based pattern matching to the catalog. Callers pass content + type, not paths. SPEC-30 may add path matching for the hot-reload watcher, not here.
- **Do not** add `prompt`, `lesson`, `workflow`, or any agent-related entries to the catalog. Per feedback memory `feedback_dont_audit_agents_area.md`, that area is intentionally in flux. Future catalog entries are one-line additions when the subsystems crystallize.
- **Do not** touch `lib/thread/ChatFile.js`. SPEC-24b is the first real consumer of the `chat` catalog entry. This spec only declares the stub.
- **Do not** add a `gray-matter` or `js-yaml` npm dependency. The existing regex-based parser is fine — lift it, don't replace it.
- **Do not** leave a compat re-export of `parseFrontmatter` from `lib/watcher/filter-loader.js`. Clean cut. Standards doc says "delete don't deprecate".
- **Do not** rename `parseFrontmatter` or `serializeFrontmatter`. Callers already type the word; changing the name would expand the diff for no gain.
- **Do not** touch `lib/startup.js`, `lib/event-bus.js`, or anything in `lib/runner/`. Those modules don't call `parseFrontmatter` directly.
- **Do not** add hot-reload wiring. That's SPEC-30, and it will layer on top of this spec cleanly.
- **Do not** introduce an async API. Both parser and serializer are synchronous today and should stay that way — they operate on in-memory strings, not filesystem I/O.
- **Do not** split `parser.js` into smaller files. The parser + parseValue are one job; keeping them together is correct. `one file, one job` means one job per file, not one function per file.
- **Do not** merge `parser.js` and `serializer.js` into one file. They are two jobs (read vs write) and the user's standards favor separation.

---

## Commit message template

```
SPEC-25: extract frontmatter parser into lib/frontmatter/ with catalog

Creates lib/frontmatter/ as the canonical location for YAML frontmatter
parsing and serialization across the server. Four new files:

  lib/frontmatter/parser.js      (lift-and-shifted from filter-loader.js)
  lib/frontmatter/serializer.js  (new — SPEC-24b will use this)
  lib/frontmatter/catalog.js     (registry of known frontmatter types)
  lib/frontmatter/index.js       (public API with type-gate)

Every call to parseFrontmatter() now requires a `type` argument that
must exist in the catalog. Uncatalogued types throw loudly. This is
the enforcement bite: the activation surface for frontmatter-driven
behavior (triggers, filters, etc.) is now explicit, bounded, and
auditable via one file.

Catalog at creation has five entries:
  - trigger (activates event bus)
  - ticket
  - filter (activates event bus)
  - component
  - chat (stub — SPEC-24b will wire up the first real caller)

No prompt/lesson/workflow entries — that area is in flux per saved
feedback. Future catalog entries are one-line additions when the
subsystems crystallize.

Rewires four importers:
  - lib/watcher/filter-loader.js: internal rewire + removes parseFrontmatter
    from its exports (no more cross-subsystem `require('../watcher/...')`
    for parsing)
  - lib/triggers/trigger-parser.js: import path update
  - lib/components/component-loader.js: import path update
  - lib/tickets/loader.js: deletes 11-line inline duplicate parser,
    uses shared parser. Behavior change: numeric ticket fields
    (e.g. `priority: 3`) are now typed as numbers instead of strings.
    This is a correctness improvement — old behavior was silently wrong.

Does not touch: ChatFile.js (SPEC-24b), startup.js, runner/, client,
DB, wire protocol. Does not add hot-reload (SPEC-30).

Unblocks SPEC-24b (ChatFile rework) and paves the way for SPEC-30
(hot reload on settings/ changes).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

## Report back

After you finish, report these to the orchestrator:

1. **Diff stats.** `git diff --stat main` — files changed, lines added/removed. Expected: 4 new files in `lib/frontmatter/`, 4 modified importers, 1 file deletion count (the 11-line inline parser in tickets). Net should be around +150 / −90 lines (new module overhead minus duplicate cleanup).

2. **Static check output.** Paste the output of every grep check in step 9 and every `node -e` check in the unit tests section. Every line must match the expected result.

3. **Server boot output.** Paste the first 60 lines of `server-live.log` from the fresh startup. Confirm:
   - `[TriggerLoader] ... parsed N triggers` appears with N > 0
   - `[Watcher] Filter registered` appears at least once
   - No `[ComponentLoader]` errors (may say "No modals directory" — that's fine, means the config has nothing to load)
   - No runtime errors related to `parseFrontmatter` or `frontmatter`

4. **Ticket parse output (if tickets exist).** If the issues-viewer has ticket files, paste the output of the ticket parse check. Flag any fields that changed type (string → number, string → boolean, etc.) and note whether any downstream code appears to compare those fields to string literals.

5. **Behavioral-difference audit findings.** What did the grep checks for `ticket.priority`, `ticket.blocks` etc. find? Any string comparisons that need updating?

6. **Any surprises.**
   - Additional importers of `parseFrontmatter` that grep found that weren't in the change list.
   - Files that broke compile/load that weren't expected to.
   - Any behavior change that went beyond "numeric fields are numbers now".

7. **Any files touched outside the change list.** There should be zero. If there are, explain.

8. **Confirmation of the stub.** The `chat` entry in `lib/frontmatter/catalog.js` is present but has no callers yet. Confirm SPEC-24b can consume it without further catalog edits.

Hand the report back to the orchestrator before anyone starts SPEC-24b.
