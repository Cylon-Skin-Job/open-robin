# SPEC-10: Qwen Harness Split

## Issue
`qwen/index.js` is 433 lines managing ACP protocol, event translation, session state, and event bus bridging.

## File
`open-robin-server/lib/harness/clis/qwen/index.js` — 433 lines

## Current Responsibilities
1. **ACP protocol initialization** — initialize + session/new JSON-RPC handshake
2. **Process spawning** — override startThread() with ACP-specific setup
3. **Event translation** — delegates to QwenAcpEventTranslator per thread
4. **Session state tracking** — QwenAcpSessionState per thread for turn/model context
5. **Event bus bridging** — emit canonical events on turn_end for audit
6. **Kimi-compatible stdout stream** — PassThrough stream for backward compat
7. **Token usage normalization** — normalizeTokenUsage for audit

## Per-Thread Maps (5)
- sessionStates Map
- translators Map
- processes Map
- turnUserInputs Map
- sessions Map (inherited from base)

## Dependencies
- BaseCLIHarness (parent)
- QwenAcpWireParser (local)
- QwenAcpEventTranslator (local)
- QwenAcpSessionState (local)
- event-bus emit
- model-catalog normalizeTokenUsage

## Consumer
- `registry.js` — instantiates and registers

## One-Job Test
"This file implements the Qwen CLI harness." — Passes.

## Assessment
**Borderline.** Like the base class, the 433 lines serve a single purpose: being the Qwen harness. The ACP handshake, translation, and bridging are all part of that job. However, the `initializeAcpSession()` method and `bridgeToEventBus()` method are generic ACP concerns shared with Gemini.

## Proposed Extraction (if pursued)

### Extract 1: ACP Session Initializer (shared)
**initializeAcpSession() -> `lib/harness/clis/acp-session-init.js`**
- Generic ACP initialize + session/new handshake
- Used by both Qwen and Gemini
- Would eliminate duplication

### Extract 2: Event Bus Bridge (shared)
**bridgeToEventBus() -> `lib/harness/clis/event-bus-bridge.js`**
- Generic turn_end -> event bus emission
- Used by both Qwen and Gemini

## Recommendation
**Prioritize shared extraction over splitting.** The duplication between Qwen and Gemini is the real issue, not the file size.

## Dependencies
- Depends on SPEC-11 (compat.js routes to harnesses via registry)
- Paired with SPEC-14 (Gemini) for shared extraction

## Gotchas

### initializeAcpSession() is IDENTICAL to Gemini — safe to extract
Line-by-line comparison confirms byte-for-byte identical code. Safe to extract to shared base.

### bridgeToEventBus() differs by ONE parameter — provider ID
Qwen: `normalizeTokenUsage('qwen', ...)`. Gemini: `normalizeTokenUsage('gemini', ...)`. If shared base class hardcodes `'qwen'`, Gemini token counts are normalized as Qwen tokens — incorrect billing/metrics. Must parameterize via `this.id` or `this.provider`.

### startThread() has 4 subtle differences from Gemini
1. Qwen tracks `this.processes.set(threadId, proc)` — Gemini doesn't
2. Qwen imports PassThrough inside startThread — Gemini at top level
3. Gemini filters stderr (removes YOLO/Ignore/Hook messages) — Qwen logs all
4. Gemini's `stop()` calls `cleanupSession(threadId)` — Qwen's doesn't

If shared base uses Gemini's stderr filter, real Qwen errors get suppressed silently.

### cleanupSession() differs — Qwen cleans `this.processes`, Gemini doesn't
If base class cleanup omits `this.processes.delete()`, Qwen accumulates stale process objects. Memory grows with each thread.

### Qwen-specific `turnUserInputs` Map not in Gemini
Qwen tracks per-turn user inputs separately. Any shared extraction must not assume both harnesses use the same Maps.

## Silent Fail Risks

| Risk | What Breaks | Symptom |
|------|-------------|---------|
| Provider ID hardcoded in shared base | Token normalization wrong for one harness | Billing/metrics show wrong token counts |
| processes Map not cleaned | Qwen memory leak after many threads | Server OOM after 100+ thread opens |
| Gemini stderr filter applied to Qwen | Real Qwen errors suppressed | Qwen crashes with no log trace |
| stop() doesn't call cleanupSession (Qwen) | Sessions remain in Maps after stopping | Stale sessions accumulate |
