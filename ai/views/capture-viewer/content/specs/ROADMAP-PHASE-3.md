---
title: Phase 3 — Server-Side Enforcement + Skills + Change Ledger
created: 2026-03-28
status: active
parent: ROADMAP.md
---

# Phase 3: Server-Side Enforcement, Skills as Node Scripts, Change Ledger

Enforce SESSION.md permissions server-side. Build the skills-as-scripts model. Create the change ledger for audit trails. Add message IDs to thread markdown.

**Prerequisites:** Phase 0 (SESSION.md expansion), Phase 1 (SQLite + per-user thread folders)

---

## Context for This Session

### What Exists

- SESSION.md parsed by `session-loader.js` with fields: thread-model, session-invalidation, idle-timeout, system-context
- Phase 0 adds: tools (allowed/restricted/denied), db (read/write/denied), cli profile fields
- Wire protocol handler in server.js processes tool_call events (lines 672-732)
- Tool arguments accumulate in `session.toolArgs`, parsed on ToolResult
- ChatFile.js writes thread markdown to per-user folders (Phase 1)
- HistoryFile.js writes exchanges to SQLite (Phase 1)
- Existing watcher/trigger infrastructure with action handlers

### Key Decisions Already Made

- **Prompt-based trust:** SESSION.md tells the agent its boundaries in the system context. The agent knows its scope before it starts.
- **Bounce restricted calls:** Server intercepts denied/restricted tool_calls, returns a `tool_result` with `isError: true` and a restriction message. Agent sees it as a failed tool call and adjusts.
- **DB invisible to agents:** robin.db and project.db are never exposed. Agents interact with data through purpose-built node scripts listed as skills.
- **Skills = NPM scripts:** Any node script can become a "tool" the agent can call. Listed in a JSON manifest. Read-only by default.
- **Change ledger:** Every file change an agent makes gets logged with a pointer back to the thread + message ID that caused it.
- **Message IDs in markdown:** HTML comments in thread .md files for parseable references.
- **User app databases** live in `{project}/apps/`, separate from system DBs, with develop/production mode toggle.

### Database Model

```
ai/system/robin.db                     ← INVISIBLE to agents. System config, Robin's chat.
ai/system/project.db                   ← INVISIBLE to agents. Threads, exchanges, tickets.
ai/views/{workspace}/*.db              ← Per-view app databases. Accessible via scripts.
                                         Develop/production mode in index.json.
```

---

## 3.1 Tool Call Enforcement

### Hook Point

In server.js, after a ToolCall event arrives from the wire (line 672-694), **before** forwarding to the client:

```javascript
// Existing: parse the tool call
const toolName = payload?.function?.name || 'unknown';
const toolCallId = session.activeToolId;

// NEW: check permissions
const permission = checkToolPermission(session.toolConfig, toolName);

if (permission === 'denied') {
  // Bounce: send fake tool_result back to the wire
  bounceToolCall(session, toolCallId, toolName, 'denied');
  return;  // Don't forward to client
}

if (permission === 'restricted') {
  // Need to check arguments — but arguments accumulate via ToolCallPart
  // Mark this tool call as "pending restriction check"
  session.pendingRestrictionCheck = { toolCallId, toolName };
}

// If allowed: forward to client as normal
```

### Restriction Check on Arguments

Tool arguments arrive in chunks via ToolCallPart events. The full arguments are only available when ToolResult arrives (line 702-732). So the restriction check happens at ToolResult time:

```javascript
// In the ToolResult handler, after parsing arguments:
if (session.pendingRestrictionCheck?.toolCallId === toolCallId) {
  const { toolName } = session.pendingRestrictionCheck;
  const pathArg = extractPathArgument(toolName, parsedArgs);

  if (pathArg && !matchesRestrictedPaths(session.toolConfig, toolName, pathArg)) {
    bounceToolCall(session, toolCallId, toolName, 'restricted', pathArg);
    session.pendingRestrictionCheck = null;
    return;
  }
  session.pendingRestrictionCheck = null;
}
```

### Permission Checker

```javascript
function checkToolPermission(toolConfig, toolName) {
  if (!toolConfig) return 'allowed';  // No config = allow all (backward compatible)

  if (toolConfig.denied?.includes(toolName)) return 'denied';
  if (toolConfig.restricted?.[toolName]) return 'restricted';
  if (toolConfig.allowed?.includes(toolName)) return 'allowed';

  // Not listed anywhere — default to allowed (permissive by default)
  return 'allowed';
}
```

### Path Argument Extraction

Different tools put the path in different argument names:

```javascript
const PATH_ARG_MAP = {
  write_file: 'file_path',
  edit_file: 'file_path',
  read_file: 'file_path',
  glob: 'path',
  grep: 'path',
};

function extractPathArgument(toolName, args) {
  const argName = PATH_ARG_MAP[toolName];
  return argName ? args[argName] : null;
}
```

### Bounce Response

Send a fake tool_result back to the wire process so the agent sees the restriction:

```javascript
function bounceToolCall(session, toolCallId, toolName, reason, path) {
  const message = reason === 'denied'
    ? `[RESTRICTED] ${toolName} is denied. Check SESSION.md for your allowed tools.`
    : `[RESTRICTED] ${toolName} denied for path "${path}". Your write scope is defined in SESSION.md.`;

  // Send tool_result back to the wire (as if the tool executed and failed)
  sendToWire(session.wire, 'tool_result', {
    tool_call_id: toolCallId,
    return_value: {
      output: message,
      is_error: true,
    },
  });

  // Also notify client
  session.ws?.send(JSON.stringify({
    type: 'tool_result',
    toolCallId,
    toolArgs: {},
    toolOutput: message,
    toolDisplay: [],
    isError: true,
    turnId: session.currentTurn?.id,
  }));

  console.log(`[Enforcement] Bounced ${toolName} (${reason}): ${message}`);
}
```

### Load Tool Config at Session Start

In server.js where SESSION.md is parsed (line ~940):

```javascript
const config = parseSessionConfig(agentFolderPath);
session.toolConfig = config?.tools || null;  // Store for enforcement checks
```

### Steps
- [ ] Add `checkToolPermission()` to server.js (or new `lib/enforcement.js`)
- [ ] Add `extractPathArgument()` with PATH_ARG_MAP
- [ ] Add `bounceToolCall()` that sends fake tool_result to wire
- [ ] Hook into ToolCall handler (line 672): check denied tools immediately
- [ ] Hook into ToolResult handler (line 702): check restricted tool paths
- [ ] Store `session.toolConfig` from parsed SESSION.md
- [ ] Test: denied tool → agent sees error, adjusts
- [ ] Test: restricted tool with wrong path → agent sees restriction message
- [ ] Test: allowed tool → passes through unchanged

---

## 3.2 Skills as Node Scripts

### Concept

Any node script in the project can become a "tool" the agent calls. Skills are listed in a JSON manifest. The server maps tool_call names to script execution.

### Skill Manifest

Per-agent or per-workspace: `skills.json`

```json
{
  "skills": [
    {
      "name": "read-history",
      "description": "Read thread conversation history from markdown files",
      "script": "ai/system/skills/read-history.js",
      "access": "read"
    },
    {
      "name": "trace-change",
      "description": "Find which conversation message caused a file change",
      "script": "ai/system/skills/trace-change.js",
      "args": ["file_path"],
      "access": "read"
    },
    {
      "name": "search-threads",
      "description": "Search across all thread markdown files",
      "script": "ai/system/skills/search-threads.js",
      "args": ["query"],
      "access": "read"
    }
  ]
}
```

### Built-In Skills (ship with app)

| Skill | Script | What it does |
|-------|--------|-------------|
| `read-history` | `ai/system/skills/read-history.js` | Reads thread .md files from threads/{username}/, returns conversation text |
| `trace-change` | `ai/system/skills/trace-change.js` | Reads change ledger → finds message ID → resolves thread → returns the message |
| `search-threads` | `ai/system/skills/search-threads.js` | Grep/search across thread markdown files, returns matching thread + message ID + snippet |
| `return-message` | `ai/system/skills/return-message.js` | Given a message ID, returns that specific message from the thread markdown |

### Script Interface

Every skill script exports a single async function:

```javascript
// ai/system/skills/read-history.js
module.exports = async function({ workspace, username, thread, projectRoot }) {
  const threadsDir = path.join(projectRoot, 'ai/views', workspace, 'chat/threads', username);
  // Read and return markdown content
  return { content: '...', threadCount: 5 };
};
```

The server calls it, captures the return value, sends it back as `tool_result.output` (JSON stringified).

### Skill Registration

On server startup (or when skills.json changes):
1. Read skills.json from agent folder / workspace / system
2. Register each skill name as a recognized tool
3. When a tool_call arrives with a skill name, execute the script instead of forwarding to wire

```javascript
// In the ToolCall handler:
const skill = skillRegistry.get(toolName);
if (skill) {
  const result = await executeSkill(skill, parsedArgs, session);
  // Send tool_result with script output
  return;
}
```

### Steps
- [ ] Define skill script interface (async function, args, return value)
- [ ] Create `lib/skills/skill-registry.js` — loads skills.json, maps names to scripts
- [ ] Create `lib/skills/skill-runner.js` — executes script, captures return, handles errors
- [ ] Hook into ToolCall handler: check skill registry before normal tool processing
- [ ] Create `ai/system/skills/` directory
- [ ] Implement `read-history.js` skill
- [ ] Implement `trace-change.js` skill (depends on 3.4 change ledger)
- [ ] Implement `search-threads.js` skill
- [ ] Implement `return-message.js` skill
- [ ] Test: agent calls `read-history` → gets conversation markdown back

---

## 3.3 Message IDs in Thread Markdown

Add parseable message IDs to ChatFile.js output so skills can reference specific messages.

### Format

HTML comments — invisible when reading, parseable by scripts:

```markdown
---
thread: abc-123
workspace: code
title: Refactor auth middleware
---

<!-- msg:ex-1-user -->
User
Can you check the auth middleware?

<!-- msg:ex-1-assistant -->
Assistant
I'll look at it now.

**TOOL CALL(S)**

<!-- msg:ex-2-user -->
User
Looks good, ship it.

<!-- msg:ex-2-assistant -->
Assistant
Done. Committed as a1b2c3d.
```

### ID Format

`ex-{seq}-{role}` where:
- `seq` = exchange sequence number (matches history.json/SQLite seq)
- `role` = `user` or `assistant`

### Implementation

Modify `ChatFile.serialize()` to inject comment before each message:

```javascript
function serialize(title, messages) {
  let md = `# ${title}\n\n`;
  let seq = 0;

  for (const msg of messages) {
    if (msg.role === 'user') seq++;
    md += `<!-- msg:ex-${seq}-${msg.role} -->\n`;
    md += `${msg.role === 'user' ? 'User' : 'Assistant'}\n${msg.content}\n\n`;
  }

  return md;
}
```

### Steps
- [ ] Update `ChatFile.serialize()` to inject `<!-- msg:ex-N-role -->` comments
- [ ] Add `parseMessageId(line)` utility for skill scripts to extract IDs
- [ ] Backfill: when writing existing threads, IDs get added naturally on next append
- [ ] Test: serialize → parse → IDs round-trip correctly

---

## 3.4 Change Ledger

Every file change an agent makes gets logged with a pointer back to the thread + message ID.

### Ledger File

Per-project: `ai/system/change-ledger.json`

```json
{
  "version": "1.0",
  "changes": [
    {
      "file": "kimi-ide-server/lib/secrets.js",
      "action": "modified",
      "tool": "edit_file",
      "timestamp": "2026-03-28T14:32:00Z",
      "thread": "ai/views/code/chat/threads/rcc/refactor-auth.md",
      "message_id": "ex-14-assistant",
      "agent": "kimi-code",
      "commit": null
    }
  ]
}
```

### When to Write

On every `tool_result` for write/edit tools (write_file, edit_file) that succeeds:

```javascript
// After successful tool_result for write/edit tools:
if (['write_file', 'edit_file'].includes(toolName) && !isError) {
  appendToLedger({
    file: extractPathArgument(toolName, parsedArgs),
    action: toolName === 'write_file' ? 'created' : 'modified',
    tool: toolName,
    timestamp: new Date().toISOString(),
    thread: resolveThreadPath(session),
    message_id: `ex-${session.currentExchangeSeq}-assistant`,
    agent: session.agentName || null,
    commit: null,  // Filled later by git hook if desired
  });
}
```

### Commit Linking (optional, via git hook)

A post-commit hook can scan the ledger for entries with `commit: null` and fill in the commit hash:

```javascript
// ai/system/skills/link-commits.js (run as post-commit hook)
const ledger = JSON.parse(fs.readFileSync(LEDGER_PATH));
const commitHash = execSync('git rev-parse HEAD').toString().trim();
const changedFiles = execSync('git diff-tree --no-commit-id --name-only -r HEAD').toString().split('\n');

for (const entry of ledger.changes) {
  if (entry.commit === null && changedFiles.includes(entry.file)) {
    entry.commit = commitHash;
  }
}
fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2));
```

### Steps
- [ ] Create `lib/ledger.js` with `appendToLedger(entry)` and `queryLedger(file)` functions
- [ ] Hook into successful write/edit tool_results in server.js
- [ ] Track `session.currentExchangeSeq` for message ID generation
- [ ] Track `session.agentName` and thread path in session state
- [ ] Create `ai/system/change-ledger.json` on first write
- [ ] Create `trace-change.js` skill that reads the ledger
- [ ] Optional: post-commit hook for commit linking
- [ ] Test: agent edits a file → ledger entry created with thread + message ID

---

## 3.5 Per-View App Databases (Table Panels)

Each table panel workspace has its own .db file right in the folder. No separate `apps/` directory.

### Structure

```
ai/views/invoices/
  index.json          ← { type: "table", db: "invoices.db", mode: "develop" }
  invoices.db         ← SQLite database (Knex managed)
  tools.json          ← scripts → callable agent tools
  scripts/
    create-invoice.js
    query-invoices.js
    send-invoice.js
  migrations/
    001_initial.js    ← Knex migration (Robin generates)
  chat/
    PROMPT.md
    SESSION.md
    threads/...
```

### Mode Toggle (in index.json)

| Mode | Read tools | Write tools (locked) | Write tools (unlocked) |
|------|-----------|---------------------|----------------------|
| `develop` | Allowed | Allowed | Allowed |
| `production` | Allowed | Bounced with restriction | Allowed |

### Steps
- [ ] Skill registry scans `ai/views/*/tools.json` for per-workspace skills
- [ ] Mode check from index.json: if `production` and tool is `locked_in_production`, bounce
- [ ] Robin can scaffold table panel from template (db + tools.json + scripts/ + migrations/)
- [ ] Robin can toggle mode ("lock it down" / "unlock for development")
- [ ] Knex migration runner for per-workspace .db files
- [ ] Test: develop mode → write tools work. Production mode → locked writes bounce.

See **VIEW-TABLE.md** for full table panel spec.

---

## 3.6 CLI Profile Resolution

When SESSION.md says `profile: qwen3-coder`, resolve to spawn args.

### Profile Storage

Profiles live in robin.db `system_config` table:

```javascript
// key: 'profile:qwen3-coder'
// value: JSON
{
  "name": "Qwen3 Coder",
  "cli": "/usr/local/bin/kimi",
  "flags": ["--wire", "--yolo"],
  "model": "qwen3-coder-32b",
  "endpoint": "http://localhost:11434/v1",
  "system_prompt_prefix": "You are Qwen3 Coder..."
}
```

### Resolution

```javascript
function resolveProfile(profileName) {
  if (!profileName || profileName === 'default') {
    return { cli: 'kimi', flags: ['--wire', '--yolo'] };
  }
  const db = getDb();
  const row = db('system_config').where('key', `profile:${profileName}`).first();
  return row ? JSON.parse(row.value) : null;
}
```

### Steps
- [ ] Add `resolveProfile()` to session-loader.js or new lib/profiles.js
- [ ] Wire spawn in server.js uses resolved profile for CLI path and flags
- [ ] Robin's Profiles tab reads/writes profile entries in system_config
- [ ] Test: SESSION.md with `profile: default` → spawns kimi normally
- [ ] Test: SESSION.md with `profile: qwen3-coder` → spawns with custom args

---

## Issues / Discussion Points

### Enforcement Timing for Restricted Tools

Tool arguments arrive in chunks. We can't check paths until the full arguments are parsed (ToolResult time). This means for restricted tools, the tool actually executes in the CLI before we can check. The "bounce" happens after execution.

**Options:**
1. Accept this — the CLI sandbox is the real enforcement, SESSION.md is advisory
2. Buffer tool calls — don't forward to wire until we can check arguments (complex, breaks streaming)
3. Only enforce `denied` immediately, treat `restricted` as post-hoc audit

Recommend Option 1 for now. The CLI (kimi) already has its own permission model. SESSION.md is a second layer, not the only layer.

### Agent Can't Access DB Directly

An agent only has tool_call access. It can't `require('better-sqlite3')` because it's not running Node — it's a language model sending tool calls through the wire protocol. The server decides what tools exist. If `query-db` isn't a registered tool, the agent simply can't do it.

### Skill Scripts and the Existing Script Runner

The trigger system already has `lib/triggers/script-runner.js` that executes scripts. Skills can reuse this infrastructure. The skill runner is essentially the same pattern — require a module, call its export, return the result.

---

## Completion Criteria

- [ ] Tool calls checked against SESSION.md permissions (denied = instant bounce, restricted = path check)
- [ ] Bounce sends `tool_result` with `isError: true` back to wire and client
- [ ] Skills registry loads from skills.json manifests
- [ ] Built-in skills: read-history, trace-change, search-threads, return-message
- [ ] Message IDs (`<!-- msg:ex-N-role -->`) injected into thread markdown
- [ ] Change ledger records file changes with thread + message ID pointers
- [ ] User app databases in `apps/` with develop/production mode toggle
- [ ] CLI profile resolution from robin.db
- [ ] End-to-end: agent tries denied tool → bounced → tries skill → gets data → makes change → ledger records it
