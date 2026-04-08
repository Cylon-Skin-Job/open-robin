# SPEC-11: compat.js Split

## Issue
`compat.js` is 426 lines providing a compatibility shim with three execution modes (legacy, new, parallel), deferred process creation, and emergency rollback.

## File
`open-robin-server/lib/harness/compat.js` — 426 lines

## Current Responsibilities
1. **Feature flag routing** — dispatch to legacy/new/parallel based on flags
2. **Legacy mode** — direct Kimi CLI spawning (copied from server.js)
3. **New mode** — harness-based spawning with deferred initialization
4. **Parallel mode** — run both, compare outputs for validation
5. **Singleton harness management** — lazy-init default KimiHarness
6. **Deferred process creation** — returns dummy process with _harnessPromise
7. **Emergency rollback** — force reset to legacy mode
8. **Debug inspection** — getModeStatus, getParallelResults

## Global State
- `defaultHarness` — singleton KimiHarness instance
- `harnessInitPromise` — initialization promise
- `parallelResults` Map — comparison results per thread

## Exports (11 functions)
spawnThreadWire, sendToThread, getModeStatus, emergencyRollback, isNewHarnessEnabled, getParallelResults, clearParallelResults, spawnThreadWireLegacy, spawnThreadWireNew, spawnThreadWireParallel

## Dependencies
- feature-flags — mode determination
- KimiHarness — default harness
- registry — harness lookup by ID
- getDb — database for thread harness ID

## Consumers
- `server.js` — spawnThreadWire, getModeStatus
- `lib/harness/index.js` — re-exports all

## Assessment
This is a **transitional migration file**. Its complexity comes from supporting three modes simultaneously during the harness migration. Once the migration completes, it should collapse to just the "new" path.

## Proposed Split

### Extract 1: Legacy Spawner
**spawnThreadWireLegacy -> `lib/harness/legacy-spawn.js`**
- Direct Kimi CLI spawning
- Can be deleted when migration completes

### Extract 2: Parallel Comparator
**spawnThreadWireParallel, eventsEqual, getParallelResults, clearParallelResults -> `lib/harness/parallel-compare.js`**
- Validation tool for migration
- Can be deleted when migration completes

### Result: compat.js becomes thin router
- Feature flag dispatch + new mode spawning + emergency rollback
- ~150 lines

## Recommendation
**Consider whether migration is complete enough to delete legacy/parallel paths entirely.** That would be the best "fix" — removing transitional code rather than reorganizing it.

## Dependencies
- Depends on SPEC-03 (ThreadWebSocketHandler — setupWireHandlers calls)
- SPEC-01 depends on this (server.js imports spawnThreadWire)
- SPEC-10/14 depend on this (harness routing)

## Gotchas

### Parallel mode is NOT actively used in production
compat.js line 312-314: parallel mode falls through to legacy with comment "needs more setup". Tests exist but no production code uses it. It's a migration validation tool, not a production feature.

### Legacy mode IS still needed — it's the default fallback
Feature flags default to 'legacy'. Kimi CLI is the legacy harness and still the default for all threads. Removing legacy support removes the safety net — if new harness breaks, everything fails.

### emergencyRollback() mid-stream kills active conversations — NO GRACEFUL FALLBACK
When called: sets `HARNESS_MODE='legacy'` and disposes harness. But current threads still reference dead harness sessions. User tries to send another message — operation hangs or errors. No notification to client, no automatic reconnect to legacy wire.

**Mitigation**: rollback should (1) notify all connected clients via WS, (2) kill active harness sessions, (3) let clients reconnect as legacy threads.

### Deferred process creation pattern is fragile
When mode='new', returns dummy process with `_harnessPromise`. Properties are dynamically replaced after initialization. If any code accesses process properties before the promise resolves, it gets dummy values — no error, just wrong behavior.

## Silent Fail Risks

| Risk | What Breaks | Symptom |
|------|-------------|---------|
| Legacy removed, new harness breaks | No fallback, all threads fail | App completely non-functional |
| emergencyRollback mid-stream | Active threads hang | User's chat stops responding, must reload |
| Parallel comparison logic broken | Migration validation tool useless | Tests pass but harness mismatch undetected |
| Deferred process accessed before ready | Dummy process properties used | Wire initialization fails silently |
