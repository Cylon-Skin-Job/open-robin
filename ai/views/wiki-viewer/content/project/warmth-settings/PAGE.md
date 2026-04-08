# Warmth & Session Management

How Robin manages resource usage by controlling which sessions, workspaces, and renders stay "warm" (loaded and ready) versus "cold" (flushed from memory, reconstructed on demand).

## Concept

"Warm" means loaded in memory — instant access, no reconstruction delay. "Cold" means flushed — data is on disk (SQLite), but the runtime state (DOM, component trees, agent connections) has been torn down.

Sessions are cheap to keep warm (a few hundred KB of message data). The expensive parts are agent processes, WebSocket subscriptions, and plugin runtimes. The warmth system manages all of these through a single FIFO model with TTL expiration.

## FIFO Rotation

### Sessions Per Workspace

Each workspace maintains a FIFO queue of its most recent sessions.

| Setting | Default | Range | Description |
|---------|---------|-------|-------------|
| `sessions.maxPerWorkspace` | 10 | 1–25 | How many chat sessions stay warm per workspace |
| `sessions.ttl` | 30 min | 5–120 min | Flush after this long without access |
| `sessions.exemptCount` | 3 | 1–10 | Current session + N most recent are exempt from TTL |

When a session is flushed:
- Message data is already persisted in SQLite (exchanges table). Nothing is lost.
- The panel's Zustand state is cleared (`clearPanel`).
- Any mounted components reset to initial state.
- Re-opening the session loads history from disk.

### Workspaces

Workspaces themselves rotate on a separate FIFO.

| Setting | Default | Range | Description |
|---------|---------|-------|-------------|
| `workspaces.maxLoaded` | 7 | 1–15 | How many workspaces stay warm |
| `workspaces.ttl` | 30 min | 5–120 min | Flush after this long without access |
| `workspaces.exemptCount` | 2 | 1–5 | Current workspace + N most recent are exempt |

When a workspace is flushed:
- All its sessions are flushed.
- Any background agents in that workspace are stopped (or paused, depending on agent settings).
- Workspace-level state (panel configs, sidebar state) is cleared.
- Re-entering the workspace triggers discovery and session reload.

### Theoretical Maximum

With defaults: 10 sessions × 7 workspaces = **70 warm sessions**.

In practice, TTL keeps this much lower. A typical user has 1-2 active workspaces with 2-3 active sessions each. The FIFO and TTL exist for the edge cases.

## What "Warm" Costs

| Component | Per Session | Notes |
|-----------|-------------|-------|
| Message data (Zustand) | ~200KB typical, ~5MB heavy | Strings in JS heap |
| DOM nodes (hidden panels) | ~700-1000 | `visibility: hidden` — zero paint cost |
| React component tree | ~50-100KB | Mounted but not rendering |
| Agent process (if running) | ~20-50MB | CLI subprocess — the expensive part |

Message data is the cheapest thing in the system. 70 sessions at 200KB each = 14MB. Even at worst case (all heavy): 350MB. Modern browsers allocate 4GB+ per tab.

The real cost is agent processes. A background bot running a CLI session holds a Node.js subprocess with model context. This is what the FIFO is actually managing.

## What "Flushed" Preserves

Flushing a session does NOT lose data. Everything is persisted:

| Data | Storage | Survives Flush |
|------|---------|---------------|
| Thread history (messages, exchanges) | SQLite `exchanges` table | Yes |
| Thread metadata (name, strategy) | SQLite `threads` table | Yes |
| Agent memory, decisions, lessons | Markdown files in workspace | Yes |
| Scroll position | Not persisted | No — resets to bottom |
| Mid-animation state | Not persisted | No — replays as instant |
| Unsent draft text | Not persisted | No — lost |

## Renders vs. Sessions

Sessions and renders are different concerns:

- **Session** = conversation state. Thread ID, exchange history, agent context. Persisted in SQLite. Survives flush.
- **Render** = visual state. DOM tree, animation progress, scroll position. Ephemeral. Rebuilt from session data every time you open something.

Sending a chat message resumes the session (reconnects to the agent, loads context). Opening a panel to look at it only triggers a render (loads history from SQLite, renders with InstantSegmentRenderer). The render is always fresh — no stale DOM to worry about.

## Settings Storage

Warmth settings are stored in Robin's internal database (`robin.db`, `system_config` table). They are:

- **Above project level** — scoped per-user, not per-project
- **Adjustable per-project** — a project can override defaults (e.g., a heavy project might want more warm sessions)
- **Exposed in the Settings panel** — users adjust via UI, stored as JSON, read by the session manager

The cascade: user defaults → project overrides → workspace overrides (if any).

```json
{
  "warmth": {
    "sessions": {
      "maxPerWorkspace": 10,
      "ttlMinutes": 30,
      "exemptCount": 3
    },
    "workspaces": {
      "maxLoaded": 7,
      "ttlMinutes": 30,
      "exemptCount": 2
    }
  }
}
```

## Planned: Settings Panel Integration

The Settings panel will read this JSON from `system_config` and render it as adjustable controls. Changes write back to the database. The session manager reads from the database on each rotation check.

No restart required — changes take effect on the next FIFO evaluation cycle.

## Planned: Background Agents

Background agents (bots running in CLI) are a special case:

- They consume real resources (subprocess, model context)
- They don't render anything unless you open their panel
- Opening a bot's panel shows its live output (attaches to the process stdout)
- Closing the panel detaches the viewer but does NOT stop the bot
- The bot continues running until its task completes, or the workspace FIFO flushes it
- Exempt bots (actively working on a ticket) are not flushed by TTL
