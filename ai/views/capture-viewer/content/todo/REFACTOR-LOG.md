# SPEC-01 Refactor Log

Durable notes from the server.js decomposition work. Not a task list. Not a bug tracker. Just the little observations, judgment calls, and intentional-but-subtle shifts from extraction work that would otherwise evaporate from chat and get forgotten in two days.

**Rule:** If it's worth flagging in chat, it's worth appending here. Chat is real-time awareness; this file is the durable store.

**Format:** Entries are dated (`YYYY-MM-DD`) and grouped by the spec they came from. Tags: **Observation / Judgment call / Behavior shift / Surprise / Follow-up**.

**Not in scope:** architectural decisions (those belong in wiki), task tracking (that's TaskCreate), active bugs (those get debug specs), commit messages (git log tells the story).

---

## 2026-04-08

### Debug fixes (pre-SPEC-01 cleanup)

- **Surprise:** `git config user.name` was set to `Cylon-Skin-Job` (BSG joke). `ChatFile.getUsername()` was reading that and using it as the per-user chat directory name. Fixed by stubbing `getUsername()` to `os.userInfo().username`. Commit `6325a78`.
- **Observation:** `os.userInfo().username` returns `rccurtrightjr.` with a trailing period on this machine (it's the actual macOS login, same as `/Users/rccurtrightjr./`). Valid on Darwin/Linux, potential issue on Windows. Not stripping the period — the folder on disk needs to match the OS value the code reads.
- **Surprise:** Leaked `ai/views/Users/rccurtrightjr./projects/kimi-claude/ai/views/code-viewer/chat/chat/threads/` with 7 files (44K). Path shape proves an older version of the code used an absolute source path as a relative destination subpath AND had a doubled `chat/chat` concat. Current `ThreadManager` path construction cannot reproduce either. Files removed in commit `6813c1e`. **Could not find the original bug in current code** — already superseded by the thread refactor.
- **Follow-up:** "Thread markdown saving stopped working" concern from session start turned out to be the **sqlite3 readfile() BLOB bug** (already in memory as `feedback_sqlite_readfile_blob.md`), fixed in a prior session. Resolved, filed.
- **Follow-up:** `DEBUG-robin-overlay-blank.md` is stale — server log shows the Robin panel actively loading `robin:tab-items` / `robin:wiki-page` / `robin:theme-load`. Fixed at some point (probably SPEC-02 RobinOverlay split), doc never updated. Eligible for deletion or move to a `resolved/` archive. Not blocking.

### SPEC-01a — File Explorer

- **Observation:** `isPathAllowed()` has a permissive fallback — after the Pass-1 logical check at line 290, the symlink branch has three sequential `return true` statements and a final unconditional `return true` at line 316. Non-symlinks that pass Pass-1 also fall through to the final return. **This is intentional per SPEC-01a Gotcha #1** but it's worth a separate look later.
- **Follow-up:** Eventually audit whether `isPathAllowed`'s permissive behavior is right. If it's not, file a debug spec — do NOT fix it inside an extraction spec. Preserving behavior is the rule during SPEC-01.
- **Judgment call (executing session):** Added a `// File explorer handlers` comment above the new `require('./lib/file-explorer')` in server.js to match neighboring comment style. Not in the spec but aligned with surrounding code. Accepted.
- **Judgment call (executing session):** 4-line factory construction vs. my spec's 1-line estimate — the other session expanded to multiple lines for readability. Cosmetic, accepted.
- **Observation:** Line counts — spec estimated ~1387 and ~380; actual was 1394 and 399. Both within tolerance. For future specs: add ~5–10 line buffer to estimates for comment symmetry and factory expansion.
- **Bonus validation:** `ai/views/code-viewer/chat/threads/rccurtrightjr./2026-04-08.md` appeared in the working tree after server restart — the daily-thread auto-creation path writing to the **new** username directory, proving the debug-fix stub works in production.

### SPEC-01b — Startup Orchestrator

- **Observation:** Line estimate was significantly low (~150 estimated, 197 actual). The three broadcast callbacks (`sendChatMessage`, `broadcastModal`, `broadcastFileChange`) are preserved verbatim per Gotcha #7 and add ~47 lines by themselves. **Lesson for future specs:** when a region has verbatim-preserved callback trios or similar structural expansions, estimate at +50% over raw line count.
- **Behavior shift:** Signal handlers (SIGTERM / SIGINT) used to register at module load time in server.js. In `lib/startup.js`, they now register *inside* `start()` after `server.listen()` resolves. There is a sub-millisecond window between module require and listen completion where a signal would fall through to default termination instead of running `closeDb()`. **Harmless in practice** — during that window `initDb` hasn't finished, so there's nothing to clean up — but it IS a timing shift worth knowing about if someone later sees a rare "db not flushed on fast SIGTERM" log.
- **Judgment call (executing session):** `xargs kill -TERM` instead of `kill -TERM $(lsof -ti:3001)`. zsh was embedding literal `\n` into the argument and kill rejected it. Mechanically equivalent, cleaner for multi-PID. Accepted.
- **Bonus validation:** The other session got indirect proof that `robinHandlers` and `clipboardHandlers` were assigned correctly — a live WebSocket client connected during the verification window and exercised `thread:list`, `set_panel`, `file_content_request`, `file_tree_request`. `thread:list` goes through the mutable ref, so its success proves the `.then()` assignment worked. **Lesson:** When possible, use live WS traffic as a free-of-charge proof for handler-assignment correctness.
- **Observation:** The mutable-reference pattern (`let robinHandlers = {}` populated by `.then()`) is surprisingly robust because handler assignment runs BEFORE `server.listen()` opens the port. No client can connect until after the assignment, so the brief `{}` window is unreachable. Worth preserving this property when we get to SPEC-01f (client message router). **Don't "fix" the mutable pattern until we have a concrete reason.**

---

## Meta

- **Rule of thumb discovered:** Both 01a and 01b landed cleanly on the first attempt with the spec-handoff-and-verify workflow. The key is specs that include: (1) explicit "what not to do" lists, (2) grep commands for verification, (3) exact gotchas with failure modes. The executing session never had to improvise.
- **Estimation bias:** My line count estimates are consistently ~5–10% low. Add buffer for comment symmetry, readability expansion, and verbatim-preserved regions.
- **Factory pattern variance:** 01a uses a factory that returns a set of handlers. 01b uses an `async start()` that returns a resolved config object. 01c introduces a *third* variant: a per-connection factory (`createWireLifecycle({ session, ws, connectionId, onWireMessage })`) called once per WS connection, closing over per-connection refs. Three kinds of factory are now in the codebase. Pick whichever fits the extraction's lifecycle: handlers-callable-statelessly = factory-of-handlers (01a); server-wide-lifecycle = async-start-returning-state (01b); per-connection-state = per-connection-factory (01c).

### SPEC-01c — Wire Process Manager

- **Observation:** First extraction to rely on **JavaScript function-declaration hoisting**. The factory call at `server.js:304` references `onWireMessage: handleWireMessage` but `handleWireMessage` is declared at `server.js:311` — seven lines below. Works because `function handleWireMessage(msg) {}` is a hoisted function declaration; the identifier is bound at the top of the enclosing scope (`wss.on('connection', (ws) => { ... })`). **The spec called this gotcha out explicitly, forbidding conversion to a `const handleWireMessage = ...` expression.** The executing session preserved the declaration form and the round-trip worked first try.
- **Surprise:** `agentWireSessions` is not just *declared* at lines 174–175, it's also *read and mutated* at lines 796–797 inside the `thread:open-agent` handler (`agentWireSessions.set(botName, session.wire)` and `session.wire.on('exit', () => agentWireSessions.delete(botName))`). I had assumed the Map was only accessed via `global.__agentWireSessions` from the runner. **Implication for SPEC-01e (Agent Session Handler extraction):** when we eventually move the Map, we either (a) move the agent session handler alongside it, (b) keep the Map in server.js until the handler is extracted, or (c) re-import it from wherever it lands. Flag for SPEC-01e planning.
- **Follow-up:** `agentWireSessions` deserves its own one-file-one-concern home eventually — possibly `lib/wire/agent-sessions.js`, paired with a documented global re-assignment. Not this spec, not SPEC-01d. Candidate for SPEC-01e or a post-SPEC-01 cleanup.
- **Observation:** Asymmetric logging in `sendToWire`: outbound traffic uses `console.log('[→ Wire]')` (lands in `server-live.log`), inbound traffic in `setupWireHandlers` uses `logWire('WIRE_IN')` (lands in `wire-debug.log`). Intentional per the spec; preserved without modification. **Worth revisiting post-SPEC-01** whether the asymmetry is load-bearing (e.g., wire-debug.log is meant to be noise-free around outbound which is chatty) or an accident.
- **Observation:** Line-count estimates still low. wire-log.js estimated ~25, actual 34 (section header comments + full JSDoc block). process-manager.js estimated ~150, actual 158. server.js estimated ~1175, actual 1178. All within the +5–10% bias noted in the meta section. **Estimation bias is now a confirmed pattern**, not a one-off.
- **Observation:** `wireRegistry` Map is now module-private in `lib/wire/process-manager.js` — not exported. Grep confirms `\bwireRegistry\b` appears in exactly one file (the module), with 4 references: declaration + 3 helpers. Zero direct access from anywhere in the codebase. First time we've fully encapsulated a state container; confirms the "access only through exported helpers" approach works cleanly for Maps.
- **Meta:** Third extraction in a row with zero substantive deviations from spec. The spec-handoff-and-verify workflow has stabilized. The key elements: (1) explicit gotchas with failure modes, (2) exact line numbers for landmarks with drift-check instructions, (3) grep commands for verification, (4) a functional round-trip test as the canary, (5) a "what not to do" list. Both the executing session and the reviewing session know exactly what good looks like.
