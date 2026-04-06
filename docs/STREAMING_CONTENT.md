# Kimi Wire: Streaming Content Structure

**Canonical reference for how thinking and content stream. Do not guess—use this.**

---

## Captured Sample

**Source:** `docs/wire-output-sample.jsonl`  
**Captured:** `node scripts/capture-wire-output.js`  
**Prompt used:** "What is 2 + 2? Think step by step."

---

## ContentPart Types

| `payload.type` | Field   | Description                    |
|----------------|---------|--------------------------------|
| `text`         | `text`  | User-visible response content  |
| `think`        | `think` | Chain-of-thought (reasoning)     |

**There are no embedded tags.** The wire sends separate `ContentPart` events. There is no `<thought>` or `</thought>` in the stream—the protocol uses message type.

---

## Chunk Granularity

Both `think` and `text` arrive **token-level** (small chunks):

```json
{"type":"ContentPart","payload":{"type":"think","think":"The","encrypted":null}}
{"type":"ContentPart","payload":{"type":"think","think":" user","encrypted":null}}
{"type":"ContentPart","payload":{"type":"think","think":" is","encrypted":null}}
{"type":"ContentPart","payload":{"type":"text","text":"**"}}
{"type":"ContentPart","payload":{"type":"text","text":"Step"}}
```

Typical chunk size: 1–5 characters. Do not assume batching.

---

## Event Order

Events arrive in sequence. For a simple turn:

1. `TurnBegin`
2. `StepBegin`
3. `ContentPart` (type `think`) — many chunks
4. `ContentPart` (type `text`) — many chunks
5. `StatusUpdate`
6. `TurnEnd`

For more complex turns, `think` and `text` can **interleave**:
- `think` → `think` → `text` → `think` → `text` → …

---

## Thought Block Boundaries

**There are no explicit markers.** Boundaries are inferred from type transitions:

| Transition | Meaning |
|------------|---------|
| `think` → `text` | End of current thought block |
| `text` → `think` | Start of new thought block |
| First `think` | Start of first thought block |

**Each thought block** = consecutive `think` chunks until a `text` chunk (or TurnEnd).

---

## Implementation Rules

1. **Tokens are tokens** — `think` and `text` are first-class. They go into ONE ordered stream, not separate buffers.

2. **Inline, not separate** — Think blocks are inline elements, just like code blocks. They get different styling (light bulb, shimmer, collapsible), but they live in the stream in the order they arrived. Do NOT render thinking as a separate section above content.

3. **One buffer, in order** — Do NOT fork into `thinkingBuffer` and `contentBuffer`. One ordered list of segments, each tagged with its type.

4. **Block boundaries from type transitions** — `think`→`text` ends a thought block. `text`→`think` starts a new one. Each block is its own UI element.

5. **600ms pause artifact** — When a new thought block starts, draw the container (light bulb + "Thinking" + shimmer), pause 600ms, then start revealing content. This same pattern applies to other segment types: code blocks, tool calls, reads. Each gets its own icon and 600ms pause. These pauses are functional — they buy buffer time.

6. **Buffering is the goal** — The ribbon, the 600ms pauses, the typing effect — these stall the UI so content is always buffered ahead of display. They are not decorative.

---

## Sample: First 20 ContentPart Events

```
think: "The"
think: " user"
think: " is"
think: " asking"
think: " a"
think: " simple"
think: " math"
think: " question"
think: ":"
think: " \""
think: "What"
think: " is"
think: " "
think: "2"
think: " +"
think: " "
think: "2"
think: "?"
think: " Think"
think: " step"
...
text: "**"
text: "Step"
text: " "
...
```

---

## Regenerating the Sample

```bash
node scripts/capture-wire-output.js
```

Output: `docs/wire-output-sample.jsonl`

---

## Related Docs

- **[RENDER_ENGINE_ARCHITECTURE.md](./RENDER_ENGINE_ARCHITECTURE.md)** — Pulse-driven job queue, state machine, separation of concerns
- **[TYPESCRIPT_REACT_SPEC.md](./TYPESCRIPT_REACT_SPEC.md)** — Code spec, validation rules, forbidden patterns
- **[WIRE_PROTOCOL.md](./WIRE_PROTOCOL.md)** — Full wire protocol reference

*Last Updated: 2026-03-01*
