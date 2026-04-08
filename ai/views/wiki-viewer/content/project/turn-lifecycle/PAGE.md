# Turn Lifecycle & Finalization

How an assistant turn flows from first token to history. Where it breaks if you're not careful.

## The Happy Path

```
User sends message
    ↓
turn_begin WS → setCurrentTurn(status: 'streaming')
    ↓
content/thinking/tool_call/tool_result WS → segments[] grows
    ↓
LiveSegmentRenderer reveals segments ONE AT A TIME
    ↓
turn_end WS → setPendingTurnEnd(true)
    ↓
MessageList: onRevealComplete = () => finalizeTurn(panel)
    ↓
LiveSegmentRenderer completion effect:
    revealedCount >= segments.length AND onRevealComplete defined
    ↓
finalizeTurn(): currentTurn.status = 'complete', pendingTurnEnd = false
    ↓
Next turn_begin: snapshot into history, swap to InstantSegmentRenderer
```

## The Two Orderings

turn_end and "all segments revealed" can arrive in **either order**. Both must be safe.

### Order A: Stream finishes first (common with fast API, many tool calls)

```
T=0s:    Segments arrive rapidly: think, read, read, read, edit, text...
T=3s:    turn_end arrives. pendingTurnEnd = true.
         Renderer has only revealed 2 of 15 segments.
T=3-20s: Renderer continues revealing segments sequentially.
T=20s:   Last segment done. revealedCount = 15 = segments.length.
         Completion effect fires: onRevealComplete defined AND all revealed.
         finalizeTurn() runs. Turn complete.
```

### Order B: Renderer catches up first (uncommon — very few segments)

```
T=0s:    One think segment arrives.
T=1.5s:  Think segment finishes revealing. revealedCount = 1 = segments.length.
         Completion effect: onRevealComplete is undefined. Does nothing.
T=2s:    turn_end arrives. pendingTurnEnd = true. onRevealComplete defined.
         Completion effect re-evaluates: revealedCount >= segments.length AND defined.
         finalizeTurn() runs. Turn complete.
```

## Critical Invariants

These are non-negotiable. Breaking any of them WILL cause a hang or corruption.

### 1. Sequential Reveal

**Segments render one at a time.** Segment N+1 does not mount until segment N calls onDone.

Enforced by: `segments.slice(0, revealedCount + 1)` in LiveSegmentRenderer.

If you render all segments simultaneously (e.g., `segments.map(...)`), they all fire their animations in parallel. Text and tools race. The UI becomes a mess.

### 2. Completion Detection is an Effect, Not a Callback

**Never check completion inside onSegmentDone.** Use a reactive `useEffect` watching `[revealedCount, segments.length, onRevealComplete]`.

Why: segment components capture `onDone` at mount time via `useEffect([], ...)`. The callback is a stale closure — it sees `segments.length` and `onRevealComplete` as they were when the segment mounted, not their current values. If turn_end arrives after a segment mounts, that segment's `onDone` has `onRevealComplete = undefined` forever.

An effect re-evaluates with current values on every change. No stale closures.

### 3. onSegmentDone is Stable

`onSegmentDone` has **no dependencies** (`useCallback(fn, [])`). It's the same function reference for the entire turn. It only bumps `revealedCount`. No completion logic.

This means every segment — regardless of when it mounts — gets the same callback. No stale closure risk.

### 4. turn_begin Clears pendingTurnEnd

When a new turn begins, `pendingTurnEnd` MUST be cleared from the previous turn.

Without this, the new turn inherits the stale flag. The completion effect sees `onRevealComplete` defined from the start. As soon as the first segment finishes (`revealedCount = 1 >= segments.length = 1`), `finalizeTurn` fires on the new turn �� killing it immediately.

### 5. finalizeTurn is Atomic

`finalizeTurn` updates `currentTurn.status`, `pendingTurnEnd`, `pendingMessage`, and `lastReleasedSegmentCount` in a single `set()` call. No intermediate states are visible to React.

### 6. finalizedRef Prevents Double-Fire

The completion effect can re-run multiple times (React re-renders). `finalizedRef` ensures `finalizeTurn` is called exactly once per turn.

Reset when segments shrink (turn change or thread switch).

## Files

| File | Role |
|------|------|
| `ws-client.ts` → `turn_end` | Sets `pendingTurnEnd = true`, marks last segment complete |
| `ws-client.ts` → `turn_begin` | Snapshots prev turn, clears `pendingTurnEnd`, resets segments |
| `panelStore.ts` → `finalizeTurn` | Atomic: `status = 'complete'`, `pendingTurnEnd = false` |
| `MessageList.tsx` | Bridges store (`pendingTurnEnd`) to renderer (`onRevealComplete`) |
| `LiveSegmentRenderer.tsx` | Sequential reveal, completion effect, `finalizedRef` guard |

## Bugs That Keep Coming Back

### The Hang: "Turn data is all there but renderer is frozen"

**Symptom:** Refreshing shows all content. Live view is stuck mid-animation.

**Cause:** Completion check was inside `onSegmentDone` callback (stale closure). Turn ended, `pendingTurnEnd` set to true, but the callback didn't know because it captured `onRevealComplete = undefined` at mount time.

**Fix:** Effect-based completion detection. Always sees current values.

### The Premature Kill: "New turn dies immediately"

**Symptom:** Turn starts, first segment appears, then nothing.

**Cause:** `turn_begin` didn't clear `pendingTurnEnd`. New turn inherited it. Completion effect fired after first segment.

**Fix:** `turn_begin` clears `pendingTurnEnd` before setting new turn.

### The Parallel Animation: "All segments animate at once"

**Symptom:** Multiple tool blocks shimmer simultaneously. Text and tools overlap.

**Cause:** `segments.map(...)` renders all segments at once. Each mounts independently and starts its own animation.

**Fix:** `segments.slice(0, revealedCount + 1)`. Only the active segment and completed ones are in the DOM.

### The Text Stall: "Typing freezes halfway through the last text block"

**Symptom:** Tool calls render fine, then the final text response starts typing, freezes mid-sentence. Refresh shows all content. The turn hangs forever.

**Cause:** `parseTextChunks` holds back trailing content that doesn't end with a paragraph boundary (`\n\n`). The typing buffer is empty but `cursorRef < contentRef.length`. The exit condition (`cursorRef >= contentRef.length`) is never true. The loop polls forever. This was masked before sequential gating because other segments finishing would progress the turn.

**Fix:** Track `segment.complete` (set by `turn_end`). When complete AND buffer empty AND untyped content remains, force-break and display all content. Same pattern as the orchestrator's `FLUSH_TIMEOUT` but for text segments.

## Pressure Gauge (Built)

The renderer tracks `segments.length - revealedCount` as backlog pressure. Five tiers compress timing as the renderer falls behind the stream:

- **normal** (0-2): Full ceremony
- **hurry** (3-5): Half pauses, faster typing
- **rush** (6-10): No shimmer, minimal pauses
- **aggressive** (11-15): Instant reveal, no pauses
- **snap** (16+): Jump to frontier minus 2, resume live

See `lib/pressure.ts` for tier definitions. Segments call `getTimingProfile()` at each animation pause point, adapting mid-animation as pressure changes.
