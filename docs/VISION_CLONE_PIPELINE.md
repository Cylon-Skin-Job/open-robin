# Vision: Clone Pipeline

**Multi-agent orchestration via spawned wire clones, managed by the pulse engine.**

Status: Concept. Not yet implemented. Captured from design session 2026-03-01.

---

## Core Idea

Spawn multiple `kimi --wire --yolo` processes as "clones." Each clone gets full conversation context plus a focused assignment. A parent agent manages the clones, collects their output, synthesizes results. The same 500ms pulse engine that drives the UI render queue also coordinates clone lifecycle.

---

## Architecture

```
User prompt
    |
Parent Agent (wire process)
    |
    ├── Clone 1 (wire process, own API key)
    │       └── Sub-agents (Kimi built-in)
    ├── Clone 2 (wire process, own API key)
    │       └── Sub-agents
    ├── Clone 3 ...
    └── Clone N (max 6 concurrent)
    
Each clone: spawned, assigned, runs, returns output, disposed.
Parent rotates: when a clone finishes, spawn next with new assignment.
```

### Key Components

**"Spawn Clone" tool** — Registered as an external tool via `initialize`. Parent calls it, server intercepts, spawns a new wire process with a crafted prompt.

**API key pool** — Server maintains N API keys (separate accounts at lower tiers). Each clone gets assigned a key from the pool. Key returns to pool when clone dies. Round-robin or least-recently-used.

**Clone queue** — Parent has a list of assignments. Max 6 clones active. When one finishes, next assignment spawns. Managed by the pulse — every 500ms, check: any clone finished? Any slot open? Spawn next.

**Output routing** — Clone output feeds back to parent as a `ToolResult`. Parent processes it, decides to keep/discard, and continues synthesis.

---

## UI: War Room Panel

When clones are active, a panel slides out from the right side of the chat, covering the workspace area.

Each clone gets a compact HUD window:
- `smart_toy` icon + clone label
- Translucent view screen showing the clone's streaming output
- Same render engine (shimmer, segments, typing) but in compact mode
- No collapse animations — just streaming text in a fixed-height window with scroll

The panel shows a stack of these HUD windows. The user watches all clones work simultaneously.

When a clone finishes:
- Its output summary appears
- User can expand to see full response
- User can dispose ("this one's done") or follow up ("ask it a clarifying question")

When all clones finish:
- Panel can collapse
- Parent synthesizes across all clone outputs
- Final response renders in the main chat

---

## Use Case: Research Pipeline (Karen's Medical Studies)

**Problem:** 900 RAG-surfaced documents need systematic analysis.

**Configuration:**
- 6 clones running in parallel
- Each clone uses Kimi's built-in sub-agents to process 6 documents
- Clone processes its batch, synthesizes, returns summary
- Clone is disposed, new clone spawns with next 6 documents
- Parent manages rotation and final synthesis

**Hierarchy:**

```
Parent Agent
    ├── Clone 1: Docs 1-6 (via 6 sub-agents, one per doc)
    ├── Clone 2: Docs 7-12
    ├── Clone 3: Docs 13-18
    ├── Clone 4: Docs 19-24
    ├── Clone 5: Docs 25-30
    └── Clone 6: Docs 31-36
    
Clone 1 finishes → disposed → Clone 7: Docs 37-42 spawns
...continues until all 900 processed
```

**Throughput estimate:**
- 36 documents per cycle (6 clones x 6 docs each)
- 2-3 minutes per cycle
- 25 cycles for 900 documents
- Total: ~30-60 minutes depending on document complexity

**Output:** Three-level synthesis tree:
1. Sub-agent findings per document (raw extraction)
2. Clone synthesis per batch of 6 (pattern identification)
3. Parent synthesis across all batches (final analysis)

Karen can drill into any branch to see the raw findings.

---

## Prerequisites Before Building

1. **Pulse engine** — The coordination clock. Must exist first.
2. **Tool event forwarding** — Server must handle `ToolCall`, `ToolCallPart`, `ToolResult`.
3. **Multi-session server** — Server must manage multiple wire processes per client.
4. **External tool registration** — Register "SpawnClone" via `initialize`.
5. **API key pool** — Server-side key management.
6. **Compact render mode** — `SegmentBlock` with a `compact` prop for HUD windows.

---

## PDF Processing Pipeline (Prerequisite)

For document-heavy use cases, PDFs need conversion to structured JSON before entering the pipeline:

```json
{
  "title": "Study Title",
  "authors": ["..."],
  "sections": [
    { "heading": "Abstract", "content": "..." },
    { "heading": "Methods", "content": "...", "subsections": [...] },
    { "heading": "Results", "content": "...", "figures": [...] }
  ],
  "metadata": { "year": 2024, "journal": "...", "doi": "..." }
}
```

This enables:
- RAG indexing at the section/paragraph level
- Vector embedding per chunk with before/after summaries
- Targeted retrieval (only send relevant sections to sub-agents)
- Smaller context windows per clone (chunks, not full PDFs)

---

## Rate Limit Strategy

**Problem:** 6+ parallel LLM requests from one account hits rate limits.

**Solution:** Multiple accounts at lower-cost tiers.
- 6 accounts = 6 independent rate limit pools
- Lower tier per account, same or less total cost
- Server assigns keys from pool, round-robin
- Pulse monitors for rate limit errors, throttles clone spawning

---

## Relationship to Launchpad

The Launchpad project already has a 1-minute pulse for orchestration. The clone pipeline could eventually run there:

- Launchpad manages the key pool and clone lifecycle
- Server-side pulse (not browser-dependent)
- Persistent across sessions
- Webhook notifications when pipeline completes

The local 500ms pulse handles real-time UI. The Launchpad pulse handles long-running pipelines. Same pattern, different timescales.

---

*Captured: 2026-03-01*
*Status: Vision — not yet implemented*
*Prerequisites: Pulse engine, tool event forwarding, multi-session server*
