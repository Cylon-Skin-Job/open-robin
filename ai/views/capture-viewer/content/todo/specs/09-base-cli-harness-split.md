# SPEC-09: base-cli-harness.js Review

## Issue
`base-cli-harness.js` is 477 lines providing the abstract base class for all external CLI harnesses.

## File
`open-robin-server/lib/harness/clis/base-cli-harness.js` — 477 lines

## Current Responsibilities
1. **CLI detection** — isInstalled(), findCLI(), getVersion() via which/where + --version
2. **Process spawning** — startThread() spawns CLI with proper stdio/env
3. **Wire protocol translation** — translateMessage() + serializeToKimiWire() bridge
4. **Session management** — per-thread session Map, getSession(), sendToThread()
5. **EventEmitter interface** — emits parsed wire messages
6. **Lifecycle management** — initialize(), dispose()

## Subclass Contract
Must implement:
- `getSpawnArgs(threadId, projectRoot)` -> string[]
- `createWireParser()` -> EventEmitter

Should override:
- `translateMessage(msg)` for protocol-specific translation
- `getInstallCommand()` for non-npm CLIs

## Subclasses
- QwenHarness (qwen/index.js)
- GeminiHarness (gemini/index.js)
- CodexHarness (codex/index.js)
- ClaudeCodeHarness (claude-code/index.js)

## Consumers
- All 4 subclasses extend it
- `registry.js` — uses for subclass detection
- `lib/harness/index.js` — re-exports

## One-Job Test
"This file defines the base class interface for external CLI harnesses." — Passes.

## Assessment
**Borderline but acceptable.** The file is a well-defined abstract base class. All methods serve the single purpose of providing the CLI harness contract. Splitting would create artificial separation between related interface methods.

## Recommendation
**Do not split** unless the base class grows beyond 600 lines. The current size is justified by the contract surface area (CLI detection, spawning, translation, sessions are all part of "being a CLI harness").

If splitting becomes necessary:
- Extract CLI detection (isInstalled, findCLI, getVersion) to a mixin or utility
- Keep spawning + translation + sessions as core base class

## Dependencies
- Can be done alongside SPEC-10/14 (Qwen+Gemini shared extraction)
- 4 subclasses extend this — any interface change must update all 4

## Gotchas
- CLI detection logic (`isInstalled`, `findCLI`, `getVersion`) uses `which`/`where` with timeouts. If extraction changes the timeout behavior, CLI detection can hang on slow systems.
- `serializeToKimiWire()` is the backward compatibility bridge. If modified, all harness stdout streams break silently — server.js expects Kimi-format JSON on compatibleStdout.
- `sessions` Map on the base class is shared with subclass-specific Maps (Qwen has `processes`, Gemini doesn't). Any base class cleanup must not assume uniform Map names.

## Silent Fail Risks
- Low risk if kept as-is. If CLI detection is extracted to a utility, the `_checkVersion()` timeout (default 5s) must be preserved — without it, `spawn('qwen', ['--version'])` can hang indefinitely on broken installations.
