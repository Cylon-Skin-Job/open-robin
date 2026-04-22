# Per-CLI Color Override — Spec

**Status:** Draft — ready for review.
**Owner:** Open Robin core.
**Code standards:** `ai/views/wiki-viewer/content/enforcement/code-standards/PAGE.md`.
**Precursor:** `docs/CLI_IDENTITY_SPEC.md` (landed) — this spec makes the `accentColor` baked into `config/harness.ts` user-editable and persistent.

---

## 1. Purpose

Let the user change the accent color bound to each CLI. The catalog in `config/harness.ts` ships sensible defaults (Kimi cyan, Claude orange, Gemini soft starlight, Qwen lavender, Codex royal blue). This spec moves the resolved color into SQLite so the user can override it from the settings UI, with per-CLI overrides surviving across sessions and broadcasting live to every open client.

**Where the color is rendered** (already wired from CLI_IDENTITY_SPEC):
- `.chat-item.active` background tint (sidebar + thread-jump rows)
- `.rv-chat-header-identity` icon + name (primary chat header)
- `.rv-secondary-header-identity` icon + name (secondary popup)
- `.rv-cli-picker-dropdown .rv-dropdown-item` icon + hover tint

All five surfaces read `var(--cli-accent, #00d4ff)`. This spec changes **where `--cli-accent` comes from** — not how it's consumed.

---

## 2. Non-goals

- No workspace-scoped or view-scoped CLI color (catalog default → user global override is enough for v1).
- No light/dark variants per CLI (the same hex is used; if contrast is a problem later, derive with `color-mix`).
- No bulk editor or theme preset export.
- No separate RGB/tint precomputation on the server — CSS `color-mix(in srgb, var(--cli-accent) 14%, transparent)` already handles it client-side.

---

## 3. Data model

New SQLite table. Mirrors the shape of `harness_status` so the migration pattern is familiar.

```js
// open-robin-server/lib/db/migrations/011_harness_theme.js
exports.up = function (knex) {
  return knex.schema.createTable('harness_theme', (t) => {
    t.text('id').primary();              // harness_id: 'kimi' | 'claude-code' | ...
    t.text('accent_color').notNullable(); // hex: '#00d4ff'
    t.integer('updated_at');
  });
};
exports.down = (knex) => knex.schema.dropTableIfExists('harness_theme');
```

**Seeding.** The migration seeds one row per catalog entry that declares `accentColor` so the settings UI can render a full list without a fallback path. Catalog defaults as of drafting:

| id            | accent_color |
|---------------|--------------|
| `kimi`        | `#00d4ff`    |
| `claude-code` | `#D97757`    |
| `gemini`      | `#F5DE9B`    |
| `qwen`        | `#B19CD9`    |
| `codex`       | `#4169E1`    |
| `robin`       | *(no default in catalog — omit from seed)* |

Robin stays unseeded; its identity block falls back to `--text-primary` until the user explicitly picks a color. If Robin ever gets a catalog default, a follow-up migration can insert it.

---

## 4. Server

### 4a. Service — `open-robin-server/lib/harness/harness-theme-service.js`

One job: read/write per-CLI accent colors and notify the bus. Mirrors `harness-status-service.js`.

```js
// Public API (keep under 100 lines)
async function getAll(knex)                         // Record<id, { accent_color }>
async function getOne(knex, id)                     // { accent_color } | null
async function setColor(knex, id, hex)              // validates hex, writes row, emits 'harness:theme_changed'
async function resetColor(knex, id)                 // removes row so catalog default wins, emits 'harness:theme_changed' with accent_color: null
```

- Validation: `hex` must match `/^#[0-9a-fA-F]{6}$/`. Reject otherwise with a typed error — the broadcaster does not fan it to clients.
- Event payload: `{ id, accent_color: string | null }`. `null` means "reverted to catalog default; client should resolve from `config/harness.ts`".

### 4b. Broadcaster — `open-robin-server/lib/ws/harness-theme-broadcaster.js`

Subscribes to the `harness:theme_changed` bus event and fans it out over WebSocket. One-page file, mirrors `harness-broadcaster.js`:

```js
function start(bus, wss) {
  bus.on('harness:theme_changed', ({ id, accent_color }) => {
    broadcast(wss, { type: 'harness:theme_changed', id, accent_color });
  });
}
```

### 4c. Router — `open-robin-server/lib/ws/client-message-router.js`

Register three new inbound message types. Each is a thin wrapper that calls the service and returns the updated state.

| Inbound type              | Action                                                | Response                                         |
|---------------------------|-------------------------------------------------------|--------------------------------------------------|
| `harness:theme:get`       | `getAll` → send full map                              | `harness:theme_state` with `{ themes: { id → hex } }` |
| `harness:theme:set`       | `setColor(id, hex)`                                   | Broadcast `harness:theme_changed` to all clients |
| `harness:theme:reset`     | `resetColor(id)`                                      | Broadcast `harness:theme_changed` with `accent_color: null` |

---

## 5. Client

### 5a. Types — `open-robin-client/src/types/index.ts`

Extend `WebSocketMessageType`:

```ts
| 'harness:theme_state'     // initial hydration after connect
| 'harness:theme_changed'   // delta broadcast
```

### 5b. Store — `open-robin-client/src/state/panelStore.ts`

New slot mirroring `harnessStatuses`:

```ts
harnessThemes: Record<string, string>;          // id → hex (only user overrides)
setHarnessTheme: (id: string, color: string | null) => void;
hydrateHarnessThemes: (themes: Record<string, string>) => void;
```

On WS `harness:theme_state`, call `hydrateHarnessThemes`. On `harness:theme_changed`, call `setHarnessTheme` (null removes the key).

Hydration request: send `{ type: 'harness:theme:get' }` once after `wire_ready`, same place `/api/harnesses` is seeded (see `useHarnessStatuses.ts` for the pattern).

### 5c. Resolution — `open-robin-client/src/config/harness.ts`

Refactor `cliAccentStyle` so the override wins. The function gains an overrides argument so it stays pure (not coupled to `panelStore`). A hook wraps it for components:

```ts
// config/harness.ts — stays pure
export function resolveCliAccent(
  harnessId: string | null | undefined,
  overrides: Record<string, string>,
): string | undefined {
  if (!harnessId) return undefined;
  return overrides[harnessId] ?? getHarnessOption(harnessId)?.accentColor;
}

export function cliAccentStyle(
  harnessId: string | null | undefined,
  overrides: Record<string, string> = {},
): CSSProperties | undefined {
  const color = resolveCliAccent(harnessId, overrides);
  if (!color) return undefined;
  return { ['--cli-accent' as string]: color } as CSSProperties;
}
```

```ts
// hooks/useCliAccentStyle.ts — new, one job
export function useCliAccentStyle(harnessId: string | null | undefined) {
  const overrides = usePanelStore((s) => s.harnessThemes);
  return cliAccentStyle(harnessId, overrides);
}
```

All four consumers (`ChatArea`, `Sidebar`, `ThreadJumpDropdown`, `SecondaryHeader`, `CliPickerDropdown`) swap `cliAccentStyle(id)` → `useCliAccentStyle(id)`. Zero CSS changes; the custom property is the stable contract.

---

## 6. Settings UI

Add a new section to **`open-robin-client/src/components/Robin/CLIDetail.tsx`** (the existing CLI-details pane inside the Robin overlay). One row per enabled harness:

```
┌──────────────────────────────────────────────────────┐
│ [bedtime] KIMI        [colorchip]  Reset  ▸          │
│ [smart_toy] Claude    [colorchip]  Reset  ▸          │
│ [stars_2] Gemini      [colorchip]  Reset  ▸          │
│ [diamond_shine] Qwen  [colorchip]  Reset  ▸          │
│ [terminal_2] Codex    [colorchip]  Reset  ▸          │
│ [auto_awesome] Robin  [+ Pick color]                  │
└──────────────────────────────────────────────────────┘
```

Mechanics:
- **Colorchip** is the existing `ColorPicker` swatch grid + hex input already used by `ThemeDetail.tsx`. Reuse it — do not build a second picker.
- **Reset** is visible only when a row has a user override (i.e., `harnessThemes[id]` is set). Clicking sends `harness:theme:reset`.
- **Pick color** (for Robin) sends `harness:theme:set` on first selection.
- Row order matches `HARNESS_OPTIONS` so the settings view mirrors the CLI picker.

No new entry point — this is a section inside `CLIDetail.tsx`, not a new page.

---

## 7. Rollout

1. Migration 011 — creates + seeds table.
2. Service + broadcaster + router — server handles GET/SET/RESET.
3. Client types + store slot + hydration on `wire_ready`.
4. Refactor `cliAccentStyle` to accept overrides; add `useCliAccentStyle` hook.
5. Swap the five consumers to the hook.
6. Settings UI — add the CLI color section to `CLIDetail.tsx`.

Each step compiles and runs independently. After step 3 the store has data but nothing reads it (still uses catalog). After step 4–5 catalog and overrides both work. After step 6 the user can edit.

---

## 8. Open questions

1. **Robin's color** — leave undefined forever, or pick a default (e.g., `#A78BFA` — a cooler violet to distinguish from Qwen's lavender)? Proposal: ship undefined; add default in a follow-up once the feature is validated.
2. **Hex validation surface** — reject on the server only, or also on the client before sending? Proposal: client is thin (only uses the `ColorPicker` which already enforces `#RRGGBB`); server stays the truth.
3. **Reset semantics** — delete the row, or write the catalog default back? Proposal: delete the row. Row presence = "user has chosen"; absence = "use catalog". Keeps the distinction between "user picked this color which happens to match the default" and "user hasn't customized this CLI."
4. **Migration of existing users** — no prior state exists, so seeding on `up()` is sufficient; no data to migrate.
5. **Scope for future** — the memory note says "system→workspace→view cascade." Do we want this table scoped by workspace later? Proposal: defer. Add a `scope` column (`'system' | workspace_id`) in a follow-up migration when we have a concrete use case. For now, single global override per CLI.

---

## 9. Files changed

| File | Action |
|------|--------|
| `open-robin-server/lib/db/migrations/011_harness_theme.js` | new |
| `open-robin-server/lib/harness/harness-theme-service.js` | new |
| `open-robin-server/lib/ws/harness-theme-broadcaster.js` | new |
| `open-robin-server/lib/ws/client-message-router.js` | add 3 handlers |
| `open-robin-server/server.js` (or wire-up entry) | start the broadcaster |
| `open-robin-client/src/types/index.ts` | add 2 message types |
| `open-robin-client/src/state/panelStore.ts` | add slot + actions + WS listener |
| `open-robin-client/src/config/harness.ts` | refactor `cliAccentStyle` to accept overrides + add `resolveCliAccent` |
| `open-robin-client/src/hooks/useCliAccentStyle.ts` | new (3-line hook) |
| `open-robin-client/src/components/ChatArea.tsx` | swap to hook |
| `open-robin-client/src/components/Sidebar.tsx` | swap to hook |
| `open-robin-client/src/components/ThreadJumpDropdown.tsx` | swap to hook |
| `open-robin-client/src/components/SecondaryHeader.tsx` | swap to hook |
| `open-robin-client/src/components/CliPickerDropdown.tsx` | swap to hook |
| `open-robin-client/src/components/Robin/CLIDetail.tsx` | add color section |

No CSS changes. The `--cli-accent` CSS variable contract landed with CLI_IDENTITY_SPEC and doesn't move.

---

## 10. Acceptance

- User opens Robin → CLI section, clicks Qwen's colorchip, picks a new hex. Every open client sees Qwen-badged chat headers, secondary headers, and active thread rows switch within the WS round-trip.
- User clicks Reset on Qwen. The row disappears from the override map; the UI reverts to catalog lavender.
- User reloads. Hydration on `wire_ready` repopulates the store; the custom color is back.
- Picking an invalid hex (if it ever bypasses the picker) is rejected by the server and no broadcast fires.
- TypeScript compiles, `npm run build` succeeds, `tsc --noEmit` passes.

/Users/rccurtrightjr./projects/open-robin/docs/CLI_COLOR_OVERRIDE_SPEC.md
