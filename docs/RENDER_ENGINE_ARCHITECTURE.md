# Render Engine Architecture

**The pulse-driven job queue for streaming UI orchestration.**

---

## Why This Exists

AI streaming responses arrive as a fire hose of tokens — thinking, text, tool calls, file reads — all interleaved, at unpredictable speeds. Rendering them directly creates jank: partial markdown flashing, empty containers appearing, content jumping. The user sees the machinery, not the result.

The render engine exists to **decouple data arrival from visual presentation**. Wire tokens stream into a buffer. The engine consumes that buffer on its own clock — a 500ms heartbeat — producing a smooth, rhythmic, predictable visual output. Every visual transition is deliberate. Nothing flashes. Nothing races.

The entire system is designed around one principle: **buffering buys time, and time buys beauty.**

---

## Core Concepts

### The Pulse

A 500ms `setInterval` that drives the entire render pipeline. Every 500ms, one state transition occurs. Nothing renders faster than this. Nothing fires between pulses except the typing animation (which is just drawing characters that were already buffered).

The pulse is the minimum unit of visual change. If something finishes mid-cycle, it waits for the next tick. This eliminates race conditions by design.

### The Job Queue

An ordered list of render instructions. The wire parser pushes jobs onto the back. The pulse consumes from the front. The queue is the buffer — its length is how far ahead the data is from the display.

```
[shimmer_start] [shimmer_hold] [shimmer_done] [content_typing] [collapse] [orb_hold] [orb_expand] [orb_shrink] [release_block] ...
```

### The Instruction Model

On each tick, the pulse reads `currentInstruction`, executes it, and sets `nextInstruction`. The behavior change only happens when the pulse fires. Between pulses, the instruction sits in state, inert. Nothing reacts to it until the next tick.

```
Beat N:   Read instruction -> Execute -> Set next instruction
          ──────── 500ms silence ────────
Beat N+1: Read instruction -> Execute -> Set next instruction
```

### The Orb

**Singular purpose:** appears only before `##` header blocks. 4 beats: 300ms hold, 350ms expand, 350ms shrink, then overwrite with header HTML. Orb and header share one container; the orb is replaced by the header in a single DOM write (no React unmount).

---

## System Architecture

```
Wire Process (kimi --wire --yolo)
        |
        | stdout (JSON-RPC)
        v
Server (server.js)
        |
        | WebSocket
        v
Wire Parser (useWebSocket.ts)
        |
        | enqueue() - pushes render jobs
        v
┌─────────────────────────────────────────────┐
│  RenderEngine (standalone module)           │
│                                             │
│  - queue: Instruction[]                     │
│  - currentInstruction: Instruction | null   │
│  - tick(): read -> execute -> set next      │
│  - enqueue(instruction): add to queue       │
│  - subscribe(callback): notify on change    │
│  - start() / stop(): 500ms interval         │
│                                             │
│  Framework-agnostic. No React dependency.   │
│  Portable to Raven OS, Launchpad, CLI.      │
└──────────────────┬──────────────────────────┘
                   │
                   │ subscribe(callback)
                   │ ONE bridge, ONE entry point
                   v
┌─────────────────────────────────────────────┐
│  Bridge (useEngineBridge hook)              │
│                                             │
│  - Subscribes to engine                     │
│  - Writes into Zustand store                │
│  - ONLY place React state gets updated      │
│  - All engine -> React flows through here   │
└──────────────────┬──────────────────────────┘
                   │
                   │ store.setState()
                   v
┌─────────────────────────────────────────────┐
│  Zustand Store                              │
│                                             │
│  - Holds what React needs to render         │
│  - Read-only from React's perspective       │
│  - Components subscribe and render          │
└──────────────────┬──────────────────────────┘
                   │
                   │ useStore()
                   v
┌─────────────────────────────────────────────┐
│  React Components                           │
│                                             │
│  - Pure renderers of store state            │
│  - No timers, no orchestration              │
│  - User actions -> engine.enqueue()         │
└─────────────────────────────────────────────┘
```

### Why This Separation

- **Engine is testable standalone.** Run it in Node, in a test harness, in Raven OS. No React.
- **React is dumb.** Components are pure functions of store state. No scattered `useEffect` timers.
- **One path in.** If React is doing something unexpected, look at the bridge. That is the only place state enters React.
- **Future bridges.** A debug panel, a CLI renderer, a Raven adapter — each gets its own bridge to the same engine.
- **The controller is never bypassed.** Everything flows through the engine. Nothing injects into React from the side.

---

## Segment Types

Every wire event maps to a segment type. Each segment type has a display mode, icon, and label.

### Display Modes

| Mode | Behavior |
|------|----------|
| `expanding` | Shimmer header, open drawer, type content, close drawer |
| `inline` | Shimmer label on one line, no content body |
| `flow` | No shimmer, just types content inline |

### Segment Registry

| Segment Type | Wire Event | Mode | Icon | Label |
|-------------|------------|------|------|-------|
| `think` | `ContentPart` type `think` | expanding | `lightbulb` | Thinking |
| `text` | `ContentPart` type `text` | flow | — | — |
| `shell` | `ToolCall` name `Shell` | expanding | `terminal` | Running `cmd` |
| `read` | `ToolCall` name `ReadFile` | inline | `description` | Read `path` |
| `write` | `ToolCall` name `WriteFile` | inline | `edit_note` | Write `path` |
| `edit` | `ToolCall` name `StrReplaceFile` | inline | `find_replace` | Edit `path` |
| `glob` | `ToolCall` name `Glob` | inline | `folder_search` | Find `pattern` |
| `grep` | `ToolCall` name `Grep` | inline | `search` | Search `pattern` |
| `web_search` | `ToolCall` name `SearchWeb` | inline | `travel_explore` | Search `query` |
| `fetch` | `ToolCall` name `FetchURL` | inline | `link` | Fetch `url` |
| `subagent` | `ToolCall` name `Task` | inline | `smart_toy` | Subagent |
| `todo` | `ToolCall` name `SetTodoList` | inline | `checklist` | Planning |

---

## Timing Spec

### Universal Transition Sequence

Every segment follows this sequence, governed by the pulse:

1. **300ms CSS fade-in** for the shimmer label to appear
2. **Shimmer holds** on pulse ticks until next segment is ready in RAM
3. **Shimmer stops** (label goes gray) — one tick
4. **500ms pause** (one tick) before content draws or next item
5. **Content types out** (runs between ticks via RAF, pulse polls completion)
6. **500ms pause** (one tick) after content finishes
7. **Collapsible blocks** (think, shell): 500ms animated CSS collapse

### Typing Speeds

| Content type | Speed | Rationale |
|-------------|-------|-----------|
| Thinking content | 5ms/char | Lots of text, buy time |
| Normal text | 5ms/char | Standard response rendering |
| Shell output | 5ms/char | Unpredictable length |
| Code writes (future) | 2ms/char | Already fully buffered, look snappy |

### Segment-Specific Timing

| Category | Shimmer floor | Post-pause |
|----------|--------------|------------|
| `think` | Until next segment ready | 500ms (1 tick) |
| Local tools (read, write, edit, grep, glob) | Until next segment ready | 500ms (1 tick) |
| `shell` | Until next segment ready | 500ms (1 tick) |
| Network tools (fetch, web_search) | Until next segment ready | 500ms (1 tick) |
| `text` | No shimmer | 0 (just types) |

### The Orb Transition (before ## headers only)

- **Tick 0**: `blur_sphere_hold` — 300ms nothing.
- **Tick 1**: `blur_sphere_expand` — 350ms expand.
- **Tick 2**: `blur_sphere_shrink` — 350ms shrink.
- **Tick 3**: `release_block` — overwrite orb container with header HTML.

Total: 4 ticks. Orb and header share one container; overwrite replaces orb in a single DOM write.

---

## State Machine

The pulse drives a flat state machine. Each state is one tick.

```
ribbon_active         -- hold until first token in queue
ribbon_fade           -- fade ribbon out (200ms CSS)
segment_shimmer_start -- draw header, begin 300ms fade-in
segment_shimmer_hold  -- check: next segment ready? if no, stay
segment_shimmer_done  -- kill shimmer, label goes gray
segment_pre_content   -- 500ms pause before content
segment_content_start -- kick off typing (RAF loop)
segment_content_hold  -- polling: typing done? if no, stay
segment_content_done  -- typing caught up to buffer
segment_post_content  -- 500ms pause after content
segment_collapse      -- trigger 500ms CSS collapse (expanding blocks only)
segment_complete      -- check next in queue
blur_sphere_hold      -- 300ms nothing
blur_sphere_expand    -- 350ms lens_blur expand
blur_sphere_shrink    -- 350ms lens_blur shrink
release_block         -- overwrite orb with header
```

States that "stay" (shimmer_hold, content_hold) re-set themselves as the next instruction. The pulse just reads and executes. No nesting. No sub-state machines.

---

## Queue Empty Behavior

When the queue runs out of jobs and the current segment is done, the engine idles. The orb appears only before `##` header blocks, not as a general "waiting" indicator.

---

## Design Decisions

1. **Fixed 500ms tick, not variable.** Simplicity over optimization. Every state change is one tick. No juggling different intervals.

2. **Flat queue, not nested blocks.** Each instruction is one line. No "sub-steps within a block." The queue IS the checklist.

3. **Engine owns the clock. React does not.** Components never set timers. They read store state and render. Period.

4. **Shimmer is a gate, not a timer.** It does not shimmer for a fixed duration. It holds until the next segment is buffered. The shimmer is the system saying "I'm loading the next thing."

5. **Typing runs between ticks.** The only thing that operates outside the 500ms pulse is the character-by-character typing animation. The pulse just polls it.

6. **One bridge, one entry point.** All engine state enters React through a single bridge hook. Nothing bypasses it.

---

*Last Updated: 2026-03-01*
*Status: Architectural spec — not yet implemented*
