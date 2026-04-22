# Harness Install-Status Cache — Spec

**Status:** Draft — ready for implementation.
**Owner:** Open Robin core.
**Code standards:** `ai/views/wiki-viewer/content/enforcement/code-standards/PAGE.md`.
**Scope:** Server-side SQLite cache of `/api/harnesses` results + client-side reactive update via WebSocket. Replaces the current blocking `which + --version` probe on every dropdown open.

---

## 1. Purpose

Three concrete issues with today's `/api/harnesses` flow:

1. **Kimi always shows "Not installed."** `KimiHarness` has no `isInstalled()` method, so `registry.getAvailableHarnesses()` drops it into the `else` branch (`info.installed = false`).
2. **External CLIs (claude-code, gemini, codex, qwen) flake.** The probe is `which <cliName>` then `<cliName> --version` with a 2s timeout. Depends on the server process's `PATH` and on each CLI running cleanly in < 2s — two failure modes that are real in daemon/launchd contexts.
3. **Modal delay.** The picker waits on a synchronous fetch of `/api/harnesses` that spawns N subprocesses before first paint.

This spec:

- Caches harness install status in SQLite so the picker renders from cache immediately (sub-ms).
- Revalidates asynchronously using a filesystem-catalog locator instead of PATH-dependent `which`.
- Broadcasts changes over the existing WebSocket so open clients reactively grey out options that have disappeared or enable options that appeared.

---

## 2. Current state

- `open-robin-server/server.js:150` — `GET /api/harnesses` → `registry.getAvailableHarnesses()`.
- `open-robin-server/lib/harness/registry.js:163-218` — blocking loop; for each harness calls `isInstalled()` → `which` → `--version`.
- `open-robin-server/lib/harness/clis/base-cli-harness.js:81-109` — the `which + --version` probe.
- `open-robin-server/lib/harness/kimi/index.js` — no `isInstalled()`; falls through to `installed: false`.
- Client:
  - `open-robin-client/src/hooks/useHarnessStatuses.ts` — fetches `/api/harnesses` once on mount; components pass the map to `CliPickerDropdown`.
  - `open-robin-client/src/components/CliPickerDropdown.tsx:11-14` — `isSelectable` gates on `installed || builtIn`.

---

## 3. Target behavior

### 3a. Picker first-paint
Zero subprocess work on the request path. The GET returns a snapshot read from SQLite in a single query.

### 3b. Optimistic-open policy
For any harness that has no row yet in `harness_status` (e.g. fresh install, migration hasn't run a first check), `getAll` returns `installed: true` (optimistic). The user sees the option enabled; the background revalidation either confirms or flips it within ~1s and broadcasts the update.

Rationale: a cold first-run where the picker shows every option as "Not installed" is worse UX than showing all options and later greying one out.

### 3c. Revalidation trigger points
- **Server boot** — one fan-out pass; populates the table.
- **`/api/harnesses` GET** — fire-and-forget `revalidateAll()` (debounced: at most one in-flight + one queued).
- **No periodic polling.** If a user installs/uninstalls a CLI mid-session, the next picker open triggers the refresh.

### 3d. Change propagation
When `revalidate(id)` writes a row whose `installed` *differs* from the previous row (or inserts a new one), the service emits `harness:status_changed` over the WebSocket fan-out. All connected clients update their local state immediately.

### 3e. UI reactive behavior
`CliPickerDropdown` consumes the store slot. If a user has the dropdown open and a revalidation flips a row to `installed: false`, the option greys out mid-view (matches the existing disabled styling). If a row flips to `true`, the option enables.

---

## 4. Data model

### 4a. New migration
File: `open-robin-server/lib/db/migrations/0NN_harness_status.js` (NN = next number).

```sql
CREATE TABLE harness_status (
  id          TEXT PRIMARY KEY,
  installed   INTEGER NOT NULL DEFAULT 0,    -- 0/1 boolean
  binary_path TEXT,                           -- absolute path if found, else null
  version     TEXT,                           -- string from --version, or null
  checked_at  INTEGER,                        -- epoch ms of last check
  error       TEXT                            -- probe error message, else null
);
```

No foreign keys. `id` is the harness registry id (`kimi`, `codex`, etc.).

### 4b. In-memory types
```ts
interface HarnessStatusRow {
  id: string;
  installed: boolean;
  binary_path: string | null;
  version: string | null;
  checked_at: number | null;
  error: string | null;
}
```

---

## 5. Server components

Four new files + two small edits. Each file's single job in one sentence:

### 5a. `lib/harness/bin-locator.js` — new
**Job:** Given a binary name, return the absolute path if it exists on disk in any of a catalog of known install directories; otherwise null.

Checks in order:
- `$HOME/.nvm/versions/node/*/bin/` (glob over installed node versions)
- `$HOME/.volta/bin/`
- `$HOME/.npm-global/bin/`
- `$HOME/.yarn/bin/`
- `$HOME/.bun/bin/`
- `$HOME/.local/bin/`
- `$HOME/.cargo/bin/`
- `/opt/homebrew/bin/` (Apple Silicon)
- `/usr/local/bin/`
- `/usr/bin/`
- `npm prefix -g` + `/bin/` (one cached subprocess)
- `brew --prefix` + `/bin/` (one cached subprocess)

Returns the first match where the file exists and is executable. Result cached in-module per binary name (harness install state doesn't change mid-session).

### 5b. `lib/harness/harness-status-service.js` — new
**Job:** Read, write, and revalidate cached harness status rows; emit a `harness:status_changed` event on changes.

Public API:
```js
harnessStatusService.getAll()           // → HarnessStatusRow[] (optimistic defaults for missing ids)
harnessStatusService.revalidate(id)     // → Promise<HarnessStatusRow>; updates DB, emits event on diff
harnessStatusService.revalidateAll()    // → Promise<void>; fans out, debounced (max 1 in-flight + 1 queued)
```

Revalidation per harness:
1. Resolve the harness's `cliName` (or for Kimi, the module it ships with).
2. Call `bin-locator.findBinary(cliName)` → absolute path or null.
3. If found, optionally call `harness.getVersion()` with a short budget (150ms); on timeout or failure, store `version: null` but leave `installed: true`.
4. Upsert into `harness_status`.
5. If the `installed` column changed (or the row is new), emit `harness:status_changed` on the event bus.

Built-in harnesses (`robin`) short-circuit: `installed: true`, no probe.

### 5c. `lib/ws/harness-broadcaster.js` — new
**Job:** Subscribe to `harness:status_changed` on the event bus and fan out to every open client WebSocket as a `harness:status_changed` wire message.

Architectural template: `lib/ws/workspace-broadcaster.js`. Same shape: subscribe on startup, stateless, no logic beyond forwarding.

Wire payload:
```json
{
  "type": "harness:status_changed",
  "id": "kimi",
  "installed": true,
  "version": "1.30.0",
  "binary_path": "/opt/homebrew/bin/kimi"
}
```

### 5d. `server.js` — edit (one route)
`GET /api/harnesses` now returns `harnessStatusService.getAll()` and fires `harnessStatusService.revalidateAll()` as a non-awaited side effect. Drops the direct `registry.getAvailableHarnesses()` call from the request path.

### 5e. `lib/harness/registry.js` — edit
`getAvailableHarnesses()` becomes a thin adapter over `harnessStatusService.getAll()`, shaped the same as today's response (so the HTTP contract is unchanged). No more inline `isInstalled` loop. Kimi's absence of `isInstalled()` stops mattering.

### 5f. `lib/startup.js` — edit (one hook)
Kick off `harnessStatusService.revalidateAll()` once after DB is ready, before `server.listen()`. Fire-and-forget; we don't block startup on it.

---

## 6. Client components

### 6a. `panelStore.ts` — edit
Add slot:
```ts
harnessStatuses: Record<string, HarnessStatus>;
setHarnessStatus: (id: string, status: HarnessStatus) => void;
setHarnessStatuses: (map: Record<string, HarnessStatus>) => void;
```

Initial value: `{}`. Populated by the initial `/api/harnesses` fetch and then patched per WS event.

### 6b. `useHarnessStatuses.ts` — edit
Now:
1. Reads from `panelStore.harnessStatuses`.
2. On first mount (per session), fetches `/api/harnesses` once and calls `setHarnessStatuses` with the response.

Components (`CliPickerDropdown`, `ChatArea`, `Sidebar`) continue to consume via this hook — its *return shape* stays the same, but its *source* is now the reactive store.

### 6c. `lib/ws/harness-handlers.ts` — new
**Job:** Handle the single `harness:status_changed` wire message by calling `panelStore.setHarnessStatus(id, row)`.

Hooked into the existing router in `lib/ws/ws-client.ts` alongside `stream-handlers.ts`, `thread-handlers.ts`, `workspace-handlers.ts`.

### 6d. `types/index.ts` — edit
Add `'harness:status_changed'` to `WebSocketMessageType`. Extend `WebSocketMessage` with the fields in §5c's wire payload.

---

## 7. Message protocol

One new bidirectional-style message:

### 7a. `harness:status_changed` (server → client)
Fields: `id`, `installed`, `version?`, `binary_path?`, `error?`.

No client → server message needed; revalidation is triggered by `/api/harnesses` hits or the startup pass.

---

## 8. Behavioral guarantees & edge cases

- **Unknown harness id from client**: if a client somehow requests status for an id not in the registry, the service returns `null`; the route 404s.
- **Concurrent revalidation**: `revalidateAll()` is serialized with a single in-flight lock + single queued slot. Repeated `/api/harnesses` hits during a revalidation cause at most one re-fire after the current one finishes.
- **DB write errors**: logged but don't block the response. Next revalidation retries.
- **Clock skew / `checked_at`**: informational only; no expiry logic reads it.
- **Built-in `robin`**: always reported `installed: true, binary_path: null, version: null`. Never probed.

---

## 9. Out of scope

- Periodic refresh / TTL on cached rows — on-demand only.
- UI for "install" actions. Current picker only gates selection; installation flow is a future concern.
- Cross-machine sync of harness status — SQLite is per-install, which is correct.
- Probing outside the known catalog of bin dirs (no `$PATH` parsing, no scanning all files in homebrew, no user-configurable extra dirs in this iteration).

---

## 10. Implementation order

1. `bin-locator.js` standalone + unit test against a known binary (`ls`).
2. Migration + `harness_status` table.
3. `harness-status-service.js` with `getAll`, `revalidate(id)`; verify in-memory events fire.
4. `revalidateAll` + debouncing.
5. `harness-broadcaster.js` + wire type registration.
6. Rewire `registry.getAvailableHarnesses` → `service.getAll`.
7. `server.js` route edit + `startup.js` boot hook.
8. Client store slot + WS handler + `useHarnessStatuses` refactor.
9. `types/index.ts` augmentation (keeps typecheck green at each step).
10. Remove the now-unused `isInstalled + _checkVersion` path from `BaseCLIHarness` only if nothing else calls it (grep first).

Each step is independently mergeable; the client stays compatible with the old API shape throughout because `registry.getAvailableHarnesses` keeps its contract.

---

## 11. File-size sanity check

Projected line counts:

| File | Projected |
|------|-----------|
| `bin-locator.js` | ~80 |
| `harness-status-service.js` | ~140 |
| `harness-broadcaster.js` | ~40 |
| Migration | ~30 |
| `harness-handlers.ts` | ~30 |
| Edits | < 20 lines each |

All well under the 400-line threshold. Each file has one describable job.

---

## 12. Code-standards checklist

- [x] Each new file has one job describable in a single sentence without "and".
- [x] No file projected > 400 lines.
- [x] Imports respect layer boundaries (`service` does not touch views or routes; `broadcaster` is pure fan-out).
- [x] No premature abstraction — `bin-locator` is extracted because it has two consumers (`harness-status-service` for the cache, and potentially `BaseCLIHarness` if we decide to swap in step 10).
- [x] Scope creep check: nothing outside the three stated issues in §1. No UI for install actions, no periodic polling, no cross-machine sync.
- [x] Delete dead code (§10 step 10): remove old `isInstalled + _checkVersion` path after cutover if unused.
