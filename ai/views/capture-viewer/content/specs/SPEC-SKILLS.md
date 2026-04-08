---
title: Skills Spec — Node Scripts as Universal Tools
created: 2026-03-28
status: active
parent: MASTER_SYSTEM_SPEC.md
---

# Skills — Node Scripts as Universal Tools

Skills are node scripts that any agent can call as tool_calls. They live in the system folder, are available to all agents equally, and don't consume context until invoked. The harness injects runtime context. The skill does one job.

---

## Core Principle

**Skills are not floating context. They're callable capabilities.**

An agent doesn't load skill instructions into its prompt. It sees a tool name and description in its tool list. When it calls the tool, the server executes the script. The skill's code never enters the agent's context window.

This means:
- 50 skills registered = zero context cost until one is called
- Background agents and foreground agents share the same skill set
- An agent building another agent can say "use the lookup-events skill" and the other agent already has it
- No confusion between agents about what's available — everyone sees the same tools

---

## Architecture

```
Agent sends tool_call: "lookup-events" { range: "...", domain: "ticket" }
    ↓
Server: is "lookup-events" a registered skill?
    ↓ yes
Server: read skill manifest → get script path + inject requirements
    ↓
Server: build ctx object (dbPath, projectRoot, agentId, chainId, etc.)
    ↓
Server: require(script)(ctx, args) → result
    ↓
Server: send tool_result back to wire with result as output
    ↓
Agent sees: { count: 5, events: [...] }
```

The agent doesn't know it's calling a node script. It doesn't know about SQLite or file paths. It asked for events and got them.

---

## The Split: Harness vs Skill

| | Harness (server) | Skill (node script) |
|---|---|---|
| **Knows** | DB path, project root, current agent, workspace, thread, chain_id | How to query, parse, format results |
| **Doesn't know** | What the skill does internally | Where the DB is, what project, who called it |
| **Provides** | Runtime context via `ctx` object | Return value (JSON-serializable) |

The skill never hard-codes paths, DB locations, or agent names. The harness injects everything the skill needs. Skills are portable across projects.

---

## Skill Location

```
ai/system/skills/
  manifest.json              ← registry of all available skills
  lookup-events.js
  lookup-ids.js
  search-history.js
  trace-chain.js
  read-history.js
  trace-change.js
  return-message.js
```

Skills live in `ai/system/skills/`. They ship with the app. Users can add their own scripts here. Per-workspace skills (in `tools.json`) supplement the system skills for domain-specific operations.

### Two Skill Sources

| Source | Location | Scope | Purpose |
|--------|----------|-------|---------|
| **System skills** | `ai/system/skills/manifest.json` | All agents, all projects | Universal capabilities (search, lookup, trace) |
| **Workspace skills** | `ai/views/{workspace}/tools.json` | Agents in that workspace | Domain-specific (create-invoice, import-contacts) |

Both are registered in the same skill registry. If names collide, workspace skills override system skills (local > global).

---

## Manifest Format

### System Manifest (`ai/system/skills/manifest.json`)

```json
{
  "version": "1.0",
  "skills": [
    {
      "name": "lookup-events",
      "description": "Query system event log by date range and domain",
      "script": "lookup-events.js",
      "args": {
        "range": "Date range in YYYY-MM-DD/YYYY-MM-DD format",
        "domain": "Event domain filter (chat, ticket, agent, trigger, file)"
      },
      "inject": ["dbPath", "projectRoot", "chainId"],
      "access": "read"
    },
    {
      "name": "lookup-ids",
      "description": "Resolve event IDs to full event records",
      "script": "lookup-ids.js",
      "args": {
        "ids": "Array of event IDs (evt-YYYYMMDD-NNNN)"
      },
      "inject": ["dbPath"],
      "access": "read"
    },
    {
      "name": "search-history",
      "description": "Search thread markdown files by keyword with optional date range",
      "script": "search-history.js",
      "args": {
        "query": "Search keyword or phrase",
        "range": "Optional date range (YYYY-MM-DD/YYYY-MM-DD)",
        "workspace": "Optional workspace filter"
      },
      "inject": ["projectRoot", "agentId"],
      "access": "read"
    },
    {
      "name": "trace-chain",
      "description": "Get all events linked by a chain_id — trace cause to effect",
      "script": "trace-chain.js",
      "args": {
        "chain_id": "Chain ID (chain-XXXXXXXX)"
      },
      "inject": ["dbPath"],
      "access": "read"
    },
    {
      "name": "read-history",
      "description": "Read thread conversation markdown for a workspace",
      "script": "read-history.js",
      "args": {
        "workspace": "Workspace name",
        "thread": "Optional thread name filter",
        "username": "Optional username filter"
      },
      "inject": ["projectRoot"],
      "access": "read"
    },
    {
      "name": "trace-change",
      "description": "Find which conversation message caused a file change",
      "script": "trace-change.js",
      "args": {
        "file_path": "Path to the changed file"
      },
      "inject": ["projectRoot"],
      "access": "read"
    },
    {
      "name": "return-message",
      "description": "Get a specific message by ID from thread markdown",
      "script": "return-message.js",
      "args": {
        "message_id": "Message ID (ex-N-role format)"
      },
      "inject": ["projectRoot"],
      "access": "read"
    }
  ]
}
```

### Workspace Skills (`ai/views/{workspace}/tools.json`)

```json
{
  "skills": [
    {
      "name": "create-invoice",
      "description": "Create a new invoice for a customer",
      "script": "scripts/create-invoice.js",
      "args": {
        "customer_id": "Customer ID",
        "amount": "Invoice amount",
        "description": "Line item description"
      },
      "inject": ["dbPath", "projectRoot"],
      "access": "write",
      "locked_in_production": true
    }
  ]
}
```

---

## Script Interface

Every skill exports a single async function:

```javascript
// ai/system/skills/lookup-events.js
module.exports = async function({ ctx, args }) {
  // ctx: injected by harness (dbPath, projectRoot, agentId, etc.)
  // args: from the agent's tool_call arguments

  const db = require('better-sqlite3')(ctx.dbPath, { readonly: true });

  try {
    const events = db.prepare(`
      SELECT * FROM event_log
      WHERE timestamp BETWEEN ? AND ?
      AND type LIKE ?
      ORDER BY timestamp
    `).all(args.range.split('/')[0], args.range.split('/')[1], `${args.domain}:%`);

    return { count: events.length, events };
  } finally {
    db.close();
  }
};
```

### Contract

- **Input:** `{ ctx, args }` — ctx is harness-injected, args is agent-provided
- **Output:** JSON-serializable object (becomes `tool_result.output`)
- **Errors:** throw → caught by skill runner → returned as `tool_result` with `isError: true`
- **Side effects:** read skills should have none. Write skills modify DB/files.
- **Timeout:** 5 seconds default (configurable in manifest)

---

## Injectable Context (`ctx`)

The harness builds `ctx` from server state. Skills declare what they need via `inject` array in the manifest.

| Key | Value | Available when |
|-----|-------|---------------|
| `dbPath` | Absolute path to project.db | Always |
| `systemDbPath` | Absolute path to robin.db | System skills only |
| `projectRoot` | Absolute path to project root | Always |
| `agentId` | Current agent name | Agent session active |
| `workspace` | Current workspace name | Workspace context active |
| `threadId` | Current thread ID | Thread open |
| `chainId` | Current event chain ID | Called from a trigger chain |
| `username` | Current user name | Always (from git config / Robin profile) |
| `panelId` | Current panel ID | Panel context active |

Skills only receive the keys they declare in `inject`. A skill that only needs `projectRoot` never sees `dbPath`.

---

## Skill Registration

### On Server Startup

```javascript
const skillRegistry = new Map();

// 1. Load system skills
const systemManifest = loadManifest('ai/system/skills/manifest.json');
for (const skill of systemManifest.skills) {
  skillRegistry.set(skill.name, {
    ...skill,
    scriptPath: path.join(systemSkillsDir, skill.script),
    source: 'system',
  });
}

// 2. Load per-workspace skills (override system if name collides)
for (const workspace of discoverWorkspaces()) {
  const toolsPath = path.join(workspace.path, 'tools.json');
  if (!fs.existsSync(toolsPath)) continue;
  const tools = loadManifest(toolsPath);
  for (const skill of tools.skills) {
    skillRegistry.set(skill.name, {
      ...skill,
      scriptPath: path.join(workspace.path, skill.script),
      source: `workspace:${workspace.name}`,
    });
  }
}
```

### Hot Reload

When `manifest.json` or `tools.json` changes (detected by file watcher), re-register. Emit `trigger:registered` / `trigger:unregistered` events.

### Tool List for Agents

When a wire session starts, the agent's tool list includes all registered skills alongside built-in tools. The skill's `name` and `description` from the manifest appear as tool definitions.

```javascript
// Build tool list for agent
const tools = [
  ...builtInTools,  // read_file, write_file, glob, grep, etc.
  ...Array.from(skillRegistry.values()).map(skill => ({
    name: skill.name,
    description: skill.description,
    parameters: skill.args,  // arg names → descriptions
  })),
];
```

---

## Skill Runner

Reuses the existing `lib/triggers/script-runner.js` pattern but extended for skills:

```javascript
async function runSkill(skillName, args, sessionContext) {
  const skill = skillRegistry.get(skillName);
  if (!skill) return { error: `Unknown skill: ${skillName}` };

  // Build ctx from inject requirements
  const ctx = {};
  for (const key of skill.inject || []) {
    ctx[key] = sessionContext[key];
  }

  // Check access mode
  if (skill.access === 'write' && skill.locked_in_production) {
    const mode = getWorkspaceMode(skill.source);
    if (mode === 'production') {
      return { error: `[RESTRICTED] ${skillName} is locked in production mode.` };
    }
  }

  // Execute
  const scriptPath = skill.scriptPath;
  delete require.cache[require.resolve(scriptPath)];  // hot reload
  const fn = require(scriptPath);

  try {
    const result = await fn({ ctx, args });
    return result;
  } catch (err) {
    return { error: err.message };
  }
}
```

---

## CLI / Model Portability

Skills are available to ALL agents regardless of which CLI or model they run on. Because skills are server-side — the wire protocol just sees tool_call/tool_result — any CLI that supports tool use can call skills.

This means:
- Kimi CLI agent → calls `lookup-events` → works
- Qwen3 via Kimi CLI → calls `lookup-events` → works
- Future CLI X → calls `lookup-events` → works

The skill set is attached to the server, not the model. Swap the CLI, swap the model — skills stay the same.

### Symlink / Hot Inject into CLIs

For CLIs that support their own skill/tool systems (like MCP servers), Robin can symlink or generate tool definitions that point back to the same node scripts:

```
~/.kimi/tools/lookup-events.json → generated from manifest.json
~/.qwen/skills/lookup-events → symlink to ai/system/skills/lookup-events.js
```

This is future work. For now, skills go through the server's wire handler.

---

## Agent Building Agents

When one agent builds another agent, it can reference skills by name:

```markdown
# In the new agent's PROMPT.md

## Available Skills

You have access to these skills (call them as tool_calls):
- `lookup-events` — Query event log by date range and domain
- `search-history` — Search thread markdown by keyword
- `trace-chain` — Trace all events in a causal chain
- `read-history` — Read conversation markdown for a workspace
```

The building agent doesn't need to explain HOW these work. The skill names are universal. The new agent calls them the same way every other agent does. No confusion, no duplication.

---

## Built-In Skills (ship with app)

| Skill | Purpose | Access |
|-------|---------|--------|
| `lookup-events` | Query event log by date range and domain | read |
| `lookup-ids` | Resolve event IDs to full records | read |
| `search-history` | Search thread markdown by keyword | read |
| `trace-chain` | Trace all events by chain_id | read |
| `read-history` | Read thread conversation markdown | read |
| `trace-change` | Find which message caused a file change | read |
| `return-message` | Get a specific message by ID | read |

All read-only. All system-level. Available to every agent in every project.

---

## TODO

- [ ] Create `ai/system/skills/` directory with manifest.json
- [ ] Implement skill runner (extend script-runner.js pattern)
- [ ] Build ctx injection from session context
- [ ] Register skills alongside built-in tools at session start
- [ ] Hot reload on manifest.json / tools.json changes
- [ ] Implement 7 built-in skills (lookup-events, lookup-ids, search-history, trace-chain, read-history, trace-change, return-message)
- [ ] Workspace tools.json scanning (per-workspace skills)
- [ ] Production mode enforcement for write skills
- [ ] CLI portability: generate tool definitions for external CLIs (future)
