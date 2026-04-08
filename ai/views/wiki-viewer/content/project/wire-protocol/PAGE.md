# Wire Protocol & CLI Interpreter Architecture

How external CLI tools (Kimi, future Gemini, Codex, etc.) connect to Robin's internal bus. The bus defines the canonical format. Each CLI gets an interpreter that translates its wire protocol into that format.

## The Problem This Solves

Every CLI has its own wire protocol. Kimi uses JSON-RPC with `ToolCall`, `ToolCallPart`, `ToolResult`. Gemini will use something else. Codex something else. The internal rendering pipeline, event bus, and storage layer cannot care about these differences.

Without interpreters, every component that consumes tool data needs to know every CLI's format. One field name mismatch (`path` vs `file_path`) breaks rendering. Multiply that by 5 CLIs and 12 tool types and it's unmaintainable.

## Architecture

```
External CLIs                Robin Internal Bus              Consumers
─────────────               ──────────────────              ──────────
Kimi CLI ──→ Kimi Interpreter ──┐
Gemini CLI ──→ Gemini Interpreter ──┤──→ Canonical Format ──→ Event Bus
Codex CLI ──→ Codex Interpreter ──┤                         ──→ Store
Custom CLI ──→ Custom Interpreter ──┘                       ──→ Renderers
                                                            ──→ Ledger (future)
```

## Canonical Event Format

This is what the internal bus accepts. Every interpreter must translate its CLI's wire protocol into this format. Consumers only read this format.

### tool_call

Emitted when a tool invocation begins. Arguments may not be available yet (streaming).

```json
{
  "type": "tool_call",
  "toolCallId": "string — unique ID for correlation",
  "toolName": "string — canonical tool name (see Tool Name Registry below)",
  "args": {},
  "turnId": "string"
}
```

### tool_call_args

Emitted when the full arguments for a tool call are available (after streaming completes). This is the interpreter's job — accumulate streamed argument parts and emit this event with the complete parsed object.

```json
{
  "type": "tool_call_args",
  "toolCallId": "string — matches tool_call.toolCallId",
  "args": {
    "file_path": "string — for Read, Write, Edit, Glob",
    "command": "string — for Shell",
    "pattern": "string — for Grep, Glob",
    "query": "string — for WebSearch",
    "url": "string — for Fetch"
  }
}
```

### tool_result

Emitted when a tool completes. MUST include the correlated args from the original tool_call.

```json
{
  "type": "tool_result",
  "toolCallId": "string",
  "toolName": "string — canonical name",
  "args": {
    "file_path": "..."
  },
  "output": "string — tool output content",
  "display": [],
  "isError": false,
  "turnId": "string"
}
```

### content

Streamed text content from the assistant.

```json
{
  "type": "content",
  "text": "string — token or chunk"
}
```

### thinking

Streamed thinking/reasoning content.

```json
{
  "type": "thinking",
  "text": "string — token or chunk"
}
```

### turn_begin / turn_end

```json
{ "type": "turn_begin", "turnId": "string" }
{ "type": "turn_end", "turnId": "string" }
```

## Canonical Tool Names

Each CLI uses different tool names. The interpreter maps them to canonical names. The rest of the system only uses canonical names.

| Canonical | Kimi CLI Wire | Description |
|-----------|--------------|-------------|
| `read` | `ReadFile` | Read a file |
| `write` | `WriteFile` | Write/create a file |
| `edit` | `EditFile` | Edit a file (find/replace) |
| `shell` | `Bash` | Execute a shell command |
| `glob` | `Glob` | File pattern search |
| `grep` | `Grep` | Content search |
| `web_search` | `WebSearch` | Web search |
| `fetch` | `WebFetch` | Fetch a URL |
| `think` | (ContentPart type=think) | Internal reasoning |
| `subagent` | `Agent` | Spawn a sub-agent |
| `todo` | `TodoWrite` | Task management |

## Canonical Argument Names

**This is critical.** Each CLI may use different argument names for the same concept. The interpreter normalizes them to canonical names. The rendering pipeline, summary fields, and tool renderers all use canonical names.

| Canonical Arg | Concept | Used By |
|---------------|---------|---------|
| `file_path` | Path to a file | read, write, edit |
| `command` | Shell command | shell |
| `pattern` | Search/glob pattern | glob, grep |
| `query` | Search query | web_search |
| `url` | URL to fetch | fetch |
| `old_string` | Text to find (edit) | edit |
| `new_string` | Replacement text (edit) | edit |

### Kimi CLI Arg Mapping

The Kimi CLI uses different argument names than our canonical format:

| Canonical | Kimi CLI Wire | Notes |
|-----------|--------------|-------|
| `file_path` | `path` | ReadFile, WriteFile, EditFile all use `path` |
| `command` | `command` | Bash — matches canonical |
| `pattern` | `pattern` | Glob, Grep — matches canonical |
| `query` | `query` | WebSearch — matches canonical |
| `url` | `url` | WebFetch — matches canonical |
| `old_string` | `old_string` | EditFile — matches canonical |
| `new_string` | `new_string` | EditFile — matches canonical |

**The interpreter is responsible for mapping `path` → `file_path`.** Downstream code never sees `path`.

## Interpreter Responsibilities

Each CLI interpreter MUST:

1. **Parse the wire protocol** — handle streaming, chunked arguments, JSON-RPC framing
2. **Accumulate streamed arguments** — ToolCallPart chunks → complete args object
3. **Map tool names** — CLI-specific names → canonical names
4. **Map argument names** — CLI-specific arg keys → canonical arg keys
5. **Correlate tool_call and tool_result** — stash args by toolCallId, merge on result
6. **Emit canonical events** — all output conforms to the formats above
7. **Handle errors** — malformed wire data, missing fields, timeouts → graceful fallbacks

Each CLI interpreter MUST NOT:

1. Know about rendering, segments, or UI
2. Know about other CLIs
3. Emit non-canonical event formats
4. Hold state beyond the current turn (clear on turn_end)

## Current State (Kimi Only)

The Kimi interpreter is currently **inline in server.js** (the `handleMessage` switch statement, lines ~630-810). It handles:

- `TurnBegin` / `TurnEnd` → turn lifecycle events
- `ContentPart` → content + thinking tokens
- `ToolCall` → tool invocation (name + id)
- `ToolCallPart` → streamed argument accumulation (`session.toolArgs[id]`)
- `ToolResult` → correlates with stashed args, sends to client
- `StatusUpdate` → context usage metrics

**Known issues:**
- Arg name mapping not implemented — `path` goes through as-is instead of being mapped to `file_path`. The catalog has a workaround (`summaryField: 'path'`), but this is fragile.
- The interpreter is not a separate module — it's mixed into the WebSocket handler.

**Future:** Extract into `lib/interpreters/kimi.js`. Add arg name mapping. Then add `lib/interpreters/gemini.js`, etc.

## Where Things Live

| Component | Location | Purpose |
|-----------|----------|---------|
| Kimi interpreter (current) | `server.js` lines 630-810 | Wire → canonical events (inline, needs extraction) |
| Interpreters (future) | `lib/interpreters/` | Per-CLI translation modules |
| Event bus | `lib/event-bus.js` | Internal pub/sub |
| Tool name mapping | `client: lib/instructions.ts` | `toolNameToSegmentType()` — should move server-side |
| Summary field mapping | `client: lib/segmentCatalog.ts` | `summaryField` per tool type |
| Tool renderers | `client: lib/tool-renderers/` | Per-tool content presentation |
| Chunk strategies | `client: lib/chunk-strategies/` | Per-tool speed decomposition |

## Adding a New CLI

1. Create `lib/interpreters/{cli-name}.js`
2. Implement the wire protocol parser
3. Map tool names → canonical names
4. Map argument names → canonical names
5. Emit canonical events on the bus
6. Register in the session manager (replaces the current inline Kimi handler)

The rendering pipeline, tool renderers, chunk strategies, segment catalog — none of them change. They only see canonical events.
