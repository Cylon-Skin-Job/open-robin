---
title: Chat Launcher — CLI, Provider & Prompt Selection at Thread Start
created: 2026-03-29
status: draft
---

# Chat Launcher

Replace the one-click "New Thread" button with a launcher UI that lets users choose their CLI, optionally override with an API provider, and select a system prompt — all before the chat session begins. Choices are locked for the session and recorded in SESSION.md for auditing.

## Design Principles

- **Locked at start** — CLI + provider + prompt are set at thread creation. No hot-swapping mid-chat. The CLI is already running; we're choosing which one routes this thread.
- **Cascading settings** — `profiles.json` in `ai/views/chat/settings/` is the global default. Drop the same file in `ai/views/{viewer}/chat/settings/` to override per-view. Build viewer only shows heavies. Wiki viewer only shows readers.
- **CLIs are universal** — `clis.json` lives at `ai/views/chat/settings/clis.json`. Never overridden. Only signed-in CLIs appear.
- **Reuse existing components** — Prompt tiles reuse `DocumentTile` and `TileRow` from `components/tile-row/`. Same thumbnail renderer, different data source.
- **SESSION.md is the config source** — Written at thread creation, read on every session connect (new or resume). The backend reads SESSION.md to resolve the CLI, pull the secret from Secrets Manager, and load the prompt. Also serves as an audit trail.

## File Structure

```
ai/views/chat/settings/
├── clis.json              ← universal, never overridden
└── profiles.json          ← global default custom profiles

ai/views/wiki-viewer/chat/settings/
└── profiles.json          ← override: only wiki-relevant profiles

ai/views/build-viewer/chat/settings/
└── profiles.json          ← override: only heavies
```

### clis.json Schema

System-level. One copy. Not cascadable. Only signed-in CLIs appear in the launcher.

```json
{
  "signed_in": [
    {
      "id": "claude-code",
      "name": "Claude Code",
      "model": "claude-opus-4-6",
      "plan": "max-200"
    },
    {
      "id": "gemini-cli",
      "name": "Gemini CLI",
      "model": "gemini-2.5-pro",
      "plan": "free"
    },
    {
      "id": "kimi-cli",
      "name": "Kimi CLI",
      "model": "kimi-k2.5",
      "plan": null
    }
  ]
}
```

### profiles.json Schema

Cascadable. View-specific `profiles.json` overrides global. API keys referenced by name from Secrets Manager — never inline.

```json
{
  "profiles": [
    {
      "id": "glm5-builder",
      "name": "GLM5 Builder",
      "provider": "zhipu",
      "endpoint": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      "model": "glm-5",
      "secret_ref": "zhipu_api_key"
    },
    {
      "id": "qwen-specs",
      "name": "Qwen Spec Writer",
      "provider": "deepinfra",
      "endpoint": "https://api.deepinfra.com/v1/openai/chat/completions",
      "model": "qwen3-coder-plus",
      "secret_ref": "deepinfra_key"
    },
    {
      "id": "free-reader",
      "name": "Free Reader",
      "provider": "openrouter",
      "endpoint": "https://openrouter.ai/api/v1/chat/completions",
      "model": "qwen3-coder:free",
      "secret_ref": "openrouter_key"
    }
  ]
}
```

---

## Launcher UI

The launcher replaces the empty "New Thread" space. It appears when the user clicks "New Chat" (or when no thread is active).

### Layout

```
┌─────────────────────────────────────┐
│  New Chat                           │
│                                     │
│  CLI                                │
│  ○ Claude Code        opus-4-6      │
│  ● Gemini CLI         2.5-pro       │
│  ○ Kimi CLI           k2.5          │
│                                     │
│  ┌──────────────────────────────┐   │
│  │ Override with API Key   [⬤]  │   │
│  └──────────────────────────────┘   │
│                                     │
│  (if override toggled on:)          │
│  ┌──────────────────────────────┐   │
│  │ Choose API Provider      ▾   │   │
│  └──────────────────────────────┘   │
│  Dropdown shows profiles from       │
│  cascaded profiles.json             │
│                                     │
│  Prompt                             │
│  ┌──────────────────────────────┐   │
│  │ Default Prompt            ▾   │  │
│  └──────────────────────────────┘   │
│                                     │
│  (if prompt selector opened:)       │
│  ┌──────┐ ┌──────┐ ┌──────┐       │
│  │ spec │ │ build│ │review│       │
│  │writer│ │ mode │ │ mode │       │
│  └──────┘ └──────┘ └──────┘       │
│  ┌──────┐ ┌──────┐                 │
│  │ free │ │ vibe │                 │
│  │ form │ │ code │                 │
│  └──────┘ └──────┘                 │
│  (reuses DocumentTile + TileRow)    │
│                                     │
│         [ Start Chat ]              │
└─────────────────────────────────────┘
```

### Behavior

1. **CLI Section** — Vertical radio buttons. Only signed-in CLIs from `clis.json` appear. Shows model name beside each. First signed-in CLI is pre-selected.

2. **Override Toggle** — Switch/toggle. Default off. When flipped on, reveals the API provider dropdown. When on, the selected profile's endpoint/model replaces the CLI's defaults for this thread.

3. **API Provider Dropdown** — Scrollable list of profiles from the cascaded `profiles.json`. Shows profile name + model. Click selects, dropdown closes.

4. **Prompt Selector** — Button that says "Default Prompt". Click opens a tile grid (NOT a dropdown — a panel of `DocumentTile` components). Tiles show `.md` files from the view's prompts folder. Each tile is a scaled-down preview of the prompt content (same as capture thumbnails). Click a tile to select it, grid closes, button shows selected prompt name.

5. **Start Chat** — Creates the thread with the selected configuration. Sends to server via WebSocket.

### Prompt Tiles Data Source

Prompts are `.md` files stored in a prompts folder per view:

```
ai/views/chat/prompts/              ← global prompts
├── default.md
├── spec-writer.md
├── build-mode.md
├── review-mode.md
└── free-form.md

ai/views/build-viewer/chat/prompts/  ← view-specific prompts (additive)
├── strict-builder.md
└── rapid-prototype.md
```

Unlike profiles.json (which overrides), prompts are **additive** — view-specific prompts are shown alongside global prompts.

---

## WebSocket Protocol

### Thread Creation (Updated)

Currently, `Sidebar.tsx` sends a bare `{ type: 'thread:create' }` message (line 93). The launcher replaces this with a config-carrying message:

```
Client → Server:
{
  "type": "thread:create",
  "config": {
    "cli": "gemini-cli",
    "override": true,
    "profile": "qwen-specs",
    "provider": "deepinfra",
    "endpoint": "https://api.deepinfra.com/v1/openai/chat/completions",
    "model": "qwen3-coder-plus",
    "secret_ref": "deepinfra_key",
    "prompt": "specs/review-mode.md",
    "prompt_content": "..."
  }
}
```

If `override` is false, `profile`/`provider`/`endpoint`/`model`/`secret_ref` are omitted — the CLI's defaults are used.

### Settings Loading

```
Client → Server:
{ "type": "file_content_request", "panel": "chat-settings", "path": "clis.json" }
{ "type": "file_content_request", "panel": "chat-settings", "path": "profiles.json" }

Server → Client:
{ "type": "file_content_response", "panel": "chat-settings", "path": "clis.json", "content": "..." }
{ "type": "file_content_response", "panel": "chat-settings", "path": "profiles.json", "content": "..." }
```

Server resolves `chat-settings` panel path using the cascade: check view-specific path first, fall back to global.

---

## SESSION.md — Config Source & Audit Trail

SESSION.md is **load-bearing**. The backend reads it on every session connect — new or resume — to resolve the CLI, pull secrets, and configure the session.

### Written at Thread Creation

When the user clicks "Start Chat", the server writes SESSION.md before starting the session:

```yaml
---
thread-model: daily-rolling
session-invalidation: memory-mtime
idle-timeout: 9m
system-context: ["PROMPT.md", "MEMORY.md"]

# Session config (written at creation, read on every connect)
cli: gemini-cli
override: true
provider: deepinfra
model: qwen3-coder-plus
endpoint: https://api.deepinfra.com/v1/openai/chat/completions
secret_ref: deepinfra_key
prompt: specs/review-mode.md
started: 2026-03-29T01:15:00Z
---
```

### Session Startup Flow

```
startSession(sessionMdPath, { resume: false })
  1. Write SESSION.md with launcher config
  2. Read SESSION.md back
  3. Pull secret from Secrets Manager via secret_ref
  4. Load prompt .md file if specified
  5. Init new CLI session with endpoint + secret + prompt
  6. Return thread UUID

startSession(sessionMdPath, { resume: true })
  1. Read SESSION.md (already exists from original creation)
  2. Pull secret from Secrets Manager via secret_ref
  3. Reconnect to existing thread UUID
  4. Skip prompt injection (already in context)
  5. Resume conversation
```

The secret pull happens on **every** connect — new or resume — because the backend process doesn't hold secrets between disconnects.

### New vs Resume

The `resume` flag determines the path:

| | New | Resume |
|---|---|---|
| **Write SESSION.md** | Yes (from launcher config) | No (already exists) |
| **Read SESSION.md** | Yes | Yes |
| **Pull secret** | Yes | Yes |
| **Load prompt** | Yes | No (already in context) |
| **Create thread UUID** | Yes | No (use existing) |
| **Client sends** | Full config from launcher | Just the thread UUID |

The client never re-sends config on resume. It just sends `{ type: 'thread:resume', threadId: '...' }` and the backend reads SESSION.md to get everything it needs.

---

## Cascading Settings Pattern

This is the universal pattern for all view settings:

1. **Global default** lives at `ai/views/chat/settings/{file}`
2. **View override** lives at `ai/views/{viewer}/chat/settings/{file}`
3. Server checks view-specific path first. If file exists, use it. Otherwise fall back to global.
4. For `profiles.json` — view-specific **replaces** global (you only see your heavies in build view)
5. For `prompts/` — view-specific is **additive** (view prompts appear alongside global prompts)
6. For `clis.json` — **never overridden**, always global

---

## Components

### New Components

| Component | Location | Purpose |
|-----------|----------|---------|
| ChatLauncher | `components/chat/ChatLauncher.tsx` | Main launcher layout |
| CliSelector | `components/chat/CliSelector.tsx` | Radio button group for CLIs |
| OverrideToggle | `components/chat/OverrideToggle.tsx` | Toggle switch + API dropdown |
| PromptSelector | `components/chat/PromptSelector.tsx` | Button + tile grid for prompts |

### Reused Components

| Component | From | Reused For |
|-----------|------|------------|
| DocumentTile | `components/tile-row/DocumentTile.tsx` | Prompt file thumbnails |
| TileRow | `components/tile-row/TileRow.tsx` | Prompt tile grid (or use grid variant) |

`DocumentTile` already accepts `name`, `content`, `extension`, and `onClick` props — everything the prompt selector needs. `TileRow` handles the WebSocket file-tree fetch + content loading cycle. The prompt selector can use `TileRow` directly by pointing it at the prompts folder, or wrap `DocumentTile` in a custom grid if the horizontal scroll layout doesn't fit.

### Store

Add to chat/thread store (or new `launcherStore.ts`):

```typescript
interface LauncherState {
  clis: CliEntry[];
  profiles: ProfileEntry[];
  selectedCli: string | null;
  overrideEnabled: boolean;
  selectedProfile: string | null;
  selectedPrompt: string | null;
  promptSelectorOpen: boolean;
}

interface CliEntry {
  id: string;
  name: string;
  model: string;
  plan: string | null;
}

interface ProfileEntry {
  id: string;
  name: string;
  provider: string;
  endpoint: string;
  model: string;
  secret_ref: string;
}
```

---

## Implementation Order

1. **Create settings folder structure** — `ai/views/chat/settings/` with `clis.json` and `profiles.json`
2. **Add server-side cascade resolution** — resolve `chat-settings` panel path, check view-specific first, fall back to global
3. **Build `ChatLauncher` component** — layout container + CLI radio buttons (`CliSelector`)
4. **Add `OverrideToggle`** — toggle switch + API provider dropdown populated from `profiles.json`
5. **Add `PromptSelector`** — button + tile grid reusing `DocumentTile` from `components/tile-row/`
6. **Update `thread:create` WebSocket message** — include config object from launcher state
7. **Update SESSION.md writer** — record thread creation config as YAML frontmatter fields
8. **Wire into `Sidebar.tsx`** — replace the `new-chat-btn` button (currently line 154-160) with `ChatLauncher`; keep the existing `handleCreateThread` flow but feed it config from launcher state

---

## Issues / Discussion Points

### Backward Compatibility of thread:create
The server currently receives `{ type: 'thread:create' }` with no config. The updated handler must treat a missing `config` field as "use defaults" so existing thread creation still works during migration.

### TileRow Horizontal vs Grid
`TileRow` renders tiles in a horizontal scrollable row. The prompt selector mockup shows a wrapping grid. Two options:
- Add a `layout="grid"` prop to `TileRow`
- Use `DocumentTile` directly inside a CSS grid wrapper in `PromptSelector`

Either works. The grid wrapper is simpler if we don't want to modify `TileRow`.

### Prompt File Discovery
`TileRow` already handles file discovery via `file_tree_request` → `file_content_request` cycle. The prompt selector can reuse this by pointing `TileRow` at the prompts folder. For the additive merge (global + view-specific), the selector would render two `TileRow` instances or do a manual merge of two folder listings.

### Override vs Direct API
The override toggle implies the CLI is still the transport layer but with a swapped endpoint/model. This means the CLI must support endpoint override flags (e.g., `--model`, `--endpoint`). If a CLI doesn't support overrides, the toggle should be disabled for that CLI selection.

---

## Auth Error Handling & Inline Login

CLIs can fail auth at two points: at session start (token expired, never logged in) and mid-session (token revoked, network issues). The launcher should catch these and help the user fix them in-place.

### Known CLI Auth Error Patterns

Each CLI throws recognizable errors. The server should pattern-match stderr/stdout for these:

| CLI | Error Pattern | Fix Command |
|-----|--------------|-------------|
| Claude Code | `Not authenticated` / `Please run: claude login` | `claude /login` |
| Gemini CLI | `Could not authenticate` / `gcloud auth` | `gemini login` or `gcloud auth login` |
| Kimi CLI | `Authentication required` / `kimi login` | `kimi /login` |
| Codex CLI | `Invalid API key` / `OPENAI_API_KEY` | `codex login` or set env var |

These patterns should live in `clis.json` so they're maintainable:

```json
{
  "signed_in": [
    {
      "id": "claude-code",
      "name": "Claude Code",
      "model": "claude-opus-4-6",
      "plan": "max-200",
      "spawn_command": "claude",
      "spawn_args": ["--project-dir", "{{projectRoot}}"],
      "auth_error_patterns": ["Not authenticated", "Please run: claude", "login required"],
      "login_command": "claude /login"
    },
    {
      "id": "gemini-cli",
      "name": "Gemini CLI",
      "model": "gemini-2.5-pro",
      "plan": "free",
      "spawn_command": "gemini",
      "spawn_args": [],
      "auth_error_patterns": ["Could not authenticate", "gcloud auth"],
      "login_command": "gemini login"
    },
    {
      "id": "kimi-cli",
      "name": "Kimi CLI",
      "model": "kimi-k2.5",
      "plan": null,
      "spawn_command": "kimi",
      "spawn_args": ["--cwd", "{{projectRoot}}"],
      "auth_error_patterns": ["Authentication required", "kimi login"],
      "login_command": "kimi /login"
    }
  ]
}
```

### Launcher Auth Check

On launcher load, the server can do a lightweight auth probe per CLI (e.g., `claude --version` or a no-op API call). CLIs that fail auth get a warning state in the radio list:

```
┌─────────────────────────────────────┐
│  CLI                                │
│  ● Claude Code        opus-4-6      │
│  ○ Gemini CLI         2.5-pro       │
│  ⚠ Kimi CLI           session expired│
│    [ Open Terminal to Login ]        │
└─────────────────────────────────────┘
```

The CLI still appears (not hidden) but shows a warning and a "Open Terminal to Login" button.

### Slide-Up Terminal Panel

A terminal toggle button is always available in the chat area — not scoped to auth errors. It's a general-purpose terminal that slides up from the bottom of the chat area.

**Layout:** Same width as the chat area. Slides up from the bottom, covering the chat content (chat is still there underneath). No modals, no overlays, no z-index fights.

```
┌─ Chat Area ─────────────────────────┐
│  (chat messages, partially covered) │
│                                     │
├─ Terminal ──────────── [↑] [↓] ─────┤  ← drag handle (top edge)
│ $ kimi /login                       │
│ Opening browser for auth...         │
│ ✓ Authenticated as user@...         │
│ $ _                                 │
└─────────────────────────────────────┘
```

**Three states with position memory:**

| State | Description |
|-------|-------------|
| **Collapsed** | Terminal hidden. Only the toggle button visible (bottom of chat) |
| **Midpoint** | Wherever you last dragged it. Remembered across collapses |
| **Full** | All the way up, covers entire chat area |

**Controls:**

| Control | Action |
|---------|--------|
| **Toggle button** (when collapsed) | Opens to last remembered position (midpoint or full — whichever was last) |
| **↑ button** | Expand to full height |
| **↓ button** | Collapse completely |
| **Drag handle** (top edge) | Drag to set midpoint. Position is remembered |

**Position memory behavior:**
- Drag to 40% → collapse → toggle open → returns to 40%
- Hit ↑ to go full → collapse → toggle open → returns to full
- Always remembers the last non-collapsed position
- Stored in component state (or localStorage for persistence across page loads)

**Implementation:** Reuse existing terminal panel's PTY spawn logic. The slide-up terminal is an xterm.js instance in a resizable container with CSS `transition` on height for the slide animation.

### Auth Error → Terminal Hint

When auth fails (at start or mid-session), the terminal is the fix path:

**At launch:**
1. CLI shows ⚠ warning in radio list
2. Warning text includes the login command: "Session expired — run `kimi /login` in terminal"
3. User hits the terminal toggle, types the command, re-auths
4. Server re-probes CLI auth status, warning clears

**Mid-session:**
1. Server catches auth error pattern from CLI stderr
2. Sends: `{ type: 'session:auth-error', cli: 'kimi-cli', error: '...', loginCommand: 'kimi /login' }`
3. Client shows toast in chat: "Kimi CLI session expired. Open terminal and run `kimi /login`"
4. User opens terminal, re-auths, server reconnects

**API key errors (override mode):**
1. Server catches HTTP 401/403 from provider endpoint
2. Client shows toast: "DeepInfra API key invalid. Update in Secrets Manager."
3. No terminal needed — user updates the key in Secrets Manager and retries

---

## Verification

- [ ] Launcher appears when "New Chat" is clicked
- [ ] Only signed-in CLIs shown (from clis.json)
- [ ] Override toggle reveals/hides API dropdown
- [ ] API dropdown shows profiles from cascaded profiles.json
- [ ] Prompt selector opens tile grid with DocumentTile thumbnails
- [ ] Start Chat creates thread with full config
- [ ] SESSION.md records the creation config as frontmatter
- [ ] View-specific profiles.json overrides global
- [ ] View-specific prompts are additive with global prompts
- [ ] Bare `thread:create` (no config) still works (backward compat)
- [ ] Terminal toggle button always visible at bottom of chat area
- [ ] Terminal slides up from bottom, same width as chat
- [ ] Drag handle sets midpoint position
- [ ] ↑ expands to full, ↓ collapses completely
- [ ] Toggle from collapsed restores last remembered position (midpoint or full)
- [ ] CLIs with expired auth show ⚠ warning with login command hint
- [ ] Mid-session auth failure shows toast pointing user to terminal
- [ ] API key errors (override mode) show message pointing to Secrets Manager
