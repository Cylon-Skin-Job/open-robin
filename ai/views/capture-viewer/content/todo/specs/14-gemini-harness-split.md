# SPEC-14: Gemini Harness — Shared Extraction with Qwen

## Issue
`gemini/index.js` is 405 lines with significant duplication against `qwen/index.js` (433 lines). Both implement ACP protocol with nearly identical `initializeAcpSession()`, `bridgeToEventBus()`, and `startThread()` patterns.

## File
`open-robin-server/lib/harness/clis/gemini/index.js` — 405 lines

## Current Responsibilities
(Nearly identical to Qwen — see SPEC-10)
1. ACP protocol initialization
2. Process spawning with ACP setup
3. Event translation via AcpEventTranslator
4. Session state tracking via GeminiSessionState
5. Event bus bridging on turn_end
6. Kimi-compatible stdout stream
7. Token usage normalization

## Key Differences from Qwen
| Aspect | Qwen | Gemini |
|--------|------|--------|
| Wire parser | QwenAcpWireParser | AcpWireParser |
| Event translator | QwenAcpEventTranslator | AcpEventTranslator |
| Session state | QwenAcpSessionState | GeminiSessionState |
| Default model | qwen3-coder-plus | auto-gemini-3 |
| turnUserInputs map | Yes | No |
| processes map | Yes (extra) | No |
| Stderr filtering | No | Yes (removes YOLO/Ignore/Hook msgs) |

## Dependencies
- BaseCLIHarness (parent)
- AcpWireParser, AcpEventTranslator, GeminiSessionState (local)
- event-bus, model-catalog

## Consumer
- `registry.js` — instantiates and registers

## Proposed Shared Extraction

### Extract: ACP Harness Mixin or Base
**`lib/harness/clis/acp-harness-base.js`**
- Shared `initializeAcpSession()` — generic ACP handshake
- Shared `bridgeToEventBus()` — turn_end emission
- Shared `startThread()` template — spawn + ACP init + stdout passthrough
- Shared `cleanupSession()` — map cleanup
- Shared `dispose()` — kill all + clear

### Result: Qwen and Gemini become thin overrides
- Each ~100-150 lines: constructor config + model defaults + any protocol-specific behavior
- Gemini keeps stderr filtering
- Qwen keeps turnUserInputs/processes maps

## Recommendation
**Extract shared ACP base before splitting either file individually.** The duplication is the primary issue. Both files pass the one-job test individually.

## Dependencies
- Paired with SPEC-10 (Qwen) for shared extraction
- Both depend on SPEC-09 (base-cli-harness interface)

## Gotchas

### Line-by-line comparison results:
| Method | Identical? | Differences |
|--------|-----------|-------------|
| initializeAcpSession() | YES | Byte-for-byte identical |
| bridgeToEventBus() | 99% | Only provider ID string differs ('qwen' vs 'gemini') |
| startThread() | 95% | 4 differences: process tracking, PassThrough import location, stderr filtering, stop() cleanup |
| cleanupSession() | 95% | Qwen cleans processes Map, Gemini doesn't |

### Recommended approach: extract shared template, NOT shared base class
The 5% differences are subtle and will silently break if not handled. Safer to keep them separate and periodically diff, OR create a shared base with explicit override hooks for the differing parts.

### If shared base is created:
- Provider ID MUST be parameterized (`this.provider` or `this.id`)
- stderr filter MUST be overridable (Gemini filters, Qwen doesn't)
- process tracking MUST be optional (Qwen uses it, Gemini doesn't)
- stop() cleanup behavior MUST be overridable

## Silent Fail Risks
Same as SPEC-10 — see that spec for detailed risk table.
