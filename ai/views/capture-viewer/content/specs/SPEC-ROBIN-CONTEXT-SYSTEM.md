# Robin Context System Specification

## Overview

Robin's context awareness is tool-based, not injection-based. She has a lightweight system prompt that describes the spatial layout the user sees, an index of knowledge areas, and tools to query on demand. No wiki content is pre-loaded into her wire. She decides when to look things up based on conversational cues.

---

## Core Principle

**Tools replace injection.** Robin doesn't carry page content in every message. She carries spatial awareness (where am I, what does the user see) and an index (what knowledge areas exist). When she needs specifics, she calls a tool.

---

## Two Deployment Contexts

Robin's system prompt changes based on where she's running. The prompt describes the physical layout the user is looking at — what's on screen, what's clickable, what the spatial relationship is between chat and content.

### Context 1: System Panel

Robin is inside the full-screen system panel overlay.

```
You are Robin, the system supervisor for Open Robin.

You are currently inside the system panel — a full-screen overlay
the user opened by clicking the raven icon. The layout is:

- LEFT: This chat. You and the user are talking here.
- RIGHT: Tabbed settings panel with a list/detail split.
  - Tab bar across the top (pill buttons)
  - Left column: list of items for the active tab
  - Right column: detail view or guide for the selected item

The available tabs and what they cover:
- CLIs: Installed AI assistants. Configuration, switching, adding new ones.
- Connectors: External service integrations (GitLab, GitHub, etc.)
- Secrets: Encrypted credentials stored in the system keychain.
- LLM Providers: Optional API key management for AI providers.
- Enforcement: Safety rules that constrain what AI agents can do.
- Customization: Theme colors, workspace appearance, CSS overrides.

Use getCurrentPage() when the user says "this", "these", "it", "here",
or asks a question that could refer to what they're looking at.

Use your knowledge tools to look up specifics. Don't guess or recite
from memory — the data may have changed.
```

### Context 2: Workspace Chat

Robin is in the main workspace, embedded in the chat panel.

```
You are Robin, assisting in the {workspace_label} workspace.

The user sees:
- LEFT: Tools panel (icon strip for switching views)
- NEXT: Sidebar (thread list for the current view)
- CENTER: This chat. You and the user are talking here.
- RIGHT: Content area (the active view's content panel)

The active view is: {current_panel_label} ({current_panel_id})

You can help with project-level tasks: code, wiki, tickets, agents,
captures, and files. Use your workspace tools to look things up.
The user may be asking about what's visible in the content panel,
or about something else entirely — use context clues before assuming.
```

### Context 3: Future Contexts

As Robin appears in more places (floating widget, notification panel, onboarding wizard), each gets its own spatial prompt. The pattern is always the same: describe the layout, list what's available, provide tools.

---

## Tool Set

### System Panel Tools

These are available when Robin is inside the system panel.

| Tool | Signature | Returns | When to use |
|------|-----------|---------|-------------|
| `getCurrentPage` | `()` | `{ tab, item, breadcrumb }` | User says "this", "these", "here", "it", or asks an ambiguous question |
| `getWikiPage` | `(slug: string)` | `{ title, content, context, tab }` | Need to answer a specific question about a knowledge area |
| `getTabItems` | `(tabId: string)` | `Array<{ key, value, icon, description, ... }>` | Need to list what's in a tab or find a specific setting |
| `getCliDetails` | `(cliId: string)` | `{ name, author, description, version, docs_url, pricing_url, ... }` | User asks about a specific CLI's capabilities or pricing |
| `getCliRegistry` | `()` | `Array<CliItem>` | User asks what CLIs are available |
| `searchWiki` | `(query: string)` | `Array<{ slug, title, description, tab }>` | User asks a broad question — find the right page first |

### Workspace Tools

These are available when Robin is in the workspace chat. (To be defined per workspace type — code, wiki, tickets, etc.)

| Tool | Signature | Returns | When to use |
|------|-----------|---------|-------------|
| `getCurrentView` | `()` | `{ panel, label, activeResource }` | User references what they're looking at |
| `getWikiTopic` | `(topicId: string)` | `{ slug, content, edges }` | User asks about a wiki topic |
| `getTicket` | `(ticketId: string)` | `{ title, status, body }` | User asks about a ticket |
| `searchProject` | `(query: string)` | `Array<{ type, path, snippet }>` | User asks a broad project question |

---

## getCurrentPage() Behavior

This is the key tool that replaces context injection.

### What it returns

```json
{
  "tab": "enforcement",
  "item": "settings-write-lock",
  "breadcrumb": "Enforcement > Rules > Settings Write Lock",
  "itemDescription": "AI agents cannot modify any configuration files."
}
```

- `tab` — The active tab ID (clis, connectors, secrets, llm-providers, enforcement, customization)
- `item` — The selected item ID, or `null` if viewing the guide
- `breadcrumb` — Human-readable path showing where the user is
- `itemDescription` — One-line description of the selected item (from the database)

If no item is selected (user is on the guide), `item` is null and breadcrumb is just the tab name.

### When Robin should call it

**Call getCurrentPage():**
- "Which of these can I use?"
- "How do I turn this off?"
- "What does this setting do?"
- "Can you explain what I'm looking at?"
- Any deictic reference (this, that, these, here, it) without prior context

**Don't call getCurrentPage():**
- "What's the deal with the write lock?" — topic is named, just look it up
- "Can I switch between CLIs?" — general question, no page reference
- "How do secrets work?" — topic is named, query the wiki
- Follow-up questions where the topic was already established

### When getCurrentPage() reveals a mismatch

```
User is on: Enforcement tab
User asks: "Can I add another one of these?"

Robin calls getCurrentPage() → { tab: "enforcement", item: null }
Robin thinks: "add another" doesn't make sense for enforcement rules
Robin responds: "It looks like you're on the Enforcement tab — 
  are you asking about adding a safety rule, or were you 
  thinking of something else? If you mean CLIs or providers, 
  I can help with that too."
```

This is the correct behavior. Robin uses the page context to disambiguate, and when it doesn't match, she says so rather than guessing.

---

## Knowledge Architecture

### What goes in the system prompt (the index)

A lightweight list of knowledge areas and what they cover. No content, no details — just enough for Robin to know where to look.

```
Knowledge areas:
- CLIs: what they are, how to install/switch/configure, wire protocol, pricing
- Connectors: GitLab, GitHub, Jira integration, data privacy
- Secrets: storage, encryption, AI access rules, keychain
- LLM Providers: API keys, model selection, provider endpoints
- Enforcement: write locks, deploy modals, session limits, logging
- Customization: themes, presets, workspace colors, CSS cascade
```

### What goes in the wiki page `context` field (retrieval target)

The AI-readable summary that Robin gets when she calls `getWikiPage()`. This is the material she uses to answer questions — concise, keyword-rich, constraint-aware.

```
Example (CLIs context field):
"CLI = command-line AI assistant binary installed locally. 
Open Robin reads the wire protocol (RPC) and renders output.
The CLI handles all AI inference. Examples: kimi, claude, qwen, 
codex, gemini, opencode. User must have at least one installed.
Open Robin is free, charges nothing. Token costs go to the CLI 
provider. Switching CLIs does not affect project state."
```

This is NOT injected into every message. Robin reads it on demand when she needs to answer a CLI question.

### What goes in the wiki page `content` field (user-facing)

The markdown that the user reads in the guide panel. Robin can also read this if the `context` field doesn't cover something, but it's primarily for human consumption.

---

## Data Flow

### System Panel Session

```
1. User opens system panel
   → Server sets Robin's system prompt to "Context 1: System Panel"
   → Robin gets: spatial layout + knowledge index + tool definitions
   → No wiki content, no page context

2. User navigates to Enforcement > Settings Write Lock
   → Server updates session: robinContext = { tab: 'enforcement', item: 'settings-write-lock' }
   → Nothing injected into Robin's wire — just stored server-side

3. User asks: "Can I turn this off?"
   → Robin decides: "this" is ambiguous → call getCurrentPage()
   → Server reads robinContext → returns { tab, item, breadcrumb, description }
   → Robin now knows what "this" refers to
   → Robin calls getWikiPage('enforcement') for details
   → Robin answers with specifics about the write lock

4. User asks: "What about secrets, are those safe?"
   → Robin decides: topic is named ("secrets") → no need for getCurrentPage()
   → Robin calls getWikiPage('secrets')
   → Robin answers about secret storage security
```

### Workspace Chat Session

```
1. User is in workspace chat, code-viewer is active
   → Server sets Robin's system prompt to "Context 2: Workspace Chat"
   → Robin gets: spatial layout + workspace tools

2. User asks: "What's in this file?"
   → Robin calls getCurrentView() → { panel: 'code-viewer', activeResource: 'src/lib/auth.ts' }
   → Robin reads the file and answers

3. User asks: "Any open tickets about auth?"
   → Robin calls searchProject('auth tickets')
   → No need for getCurrentView() — question is self-contained
```

---

## Server-Side Implementation

### Session State

The server already tracks `sess.robinContext` via the `robin:context` message handler. This becomes the data source for `getCurrentPage()`.

```javascript
// Already exists in ws-handlers.js:
'robin:context': async (ws, msg) => {
  const sess = sessions.get(ws);
  if (sess) {
    sess.robinContext = { tab: msg.tab, item: msg.item };
  }
}
```

### Tool Handler Registration

Tools are registered as functions Robin can call through the wire protocol. When Robin's CLI receives a tool call, it routes to the server, which executes the function and returns the result.

```javascript
// New tool handlers:
'robin:tool:getCurrentPage': async (ws) => {
  const sess = sessions.get(ws);
  const ctx = sess?.robinContext || { tab: null, item: null };
  
  let breadcrumb = '';
  let itemDescription = '';
  
  if (ctx.tab) {
    const tab = await robinQueries.getTab(db, ctx.tab);
    breadcrumb = tab?.label || ctx.tab;
    
    if (ctx.item) {
      const item = await robinQueries.getTabItem(db, ctx.tab, ctx.item);
      breadcrumb += ` > ${item?.section || ''} > ${item?.key || ctx.item}`;
      itemDescription = item?.description || '';
    }
  }
  
  return { tab: ctx.tab, item: ctx.item, breadcrumb, itemDescription };
}
```

### System Prompt Injection

When a Robin wire session starts, the server injects the appropriate system prompt based on deployment context:

```javascript
function getRobinSystemPrompt(context) {
  if (context === 'system-panel') {
    return SYSTEM_PANEL_PROMPT; // The "Context 1" text above
  }
  if (context === 'workspace') {
    return WORKSPACE_PROMPT; // The "Context 2" text, with workspace name filled in
  }
}
```

---

## Migration Path

### What changes

1. **Robin's wire prompt** — Replace current context injection with spatial prompt + tool definitions
2. **`robin:context` handler** — Already exists, no change needed (stores breadcrumb data for tools)
3. **Tool handlers** — Add `getCurrentPage`, wire `getWikiPage`/`getTabItems`/`searchWiki` as callable tools
4. **Wiki `context` field** — Stays as-is, becomes retrieval target instead of injection payload

### What stays

- Wiki `context` field content — still valuable, now used by `getWikiPage()` tool
- Wiki `surface_when` field — can inform Robin's system prompt about when each topic is relevant
- `robin:context` message flow — client still sends navigation events, server still stores them

### What gets removed

- Per-page context injection into Robin's wire
- The idea that Robin "knows" what page the user is on without asking

---

## Design Principles

1. **Robin asks, not assumes.** She calls `getCurrentPage()` when uncertain rather than acting on stale injected context.
2. **Spatial, not informational.** The system prompt describes the layout, not the content.
3. **Index, not encyclopedia.** Robin knows what exists and where to find it, not the details of everything.
4. **Same Robin, different tools.** Her personality and judgment are constant. Her spatial awareness and available tools change by deployment context.
5. **Lightweight wire.** Minimal tokens in every message. Content loaded on demand, not carried around.
6. **Graceful mismatch.** When getCurrentPage() reveals the user's question doesn't match their location, Robin says so instead of forcing an answer.
