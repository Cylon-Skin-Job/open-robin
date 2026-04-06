# Vision: Semi-Autonomous Research Assistant

**Overnight research pipeline for systematic literature analysis.**

Status: Concept. Not yet implemented. Captured from design session 2026-03-01.

---

## The Problem

A medical researcher (Karen) manually pastes study excerpts into chat windows, reads responses, identifies patterns, and repeats. Hundreds of studies. One at a time. She's brilliant at pattern recognition but bottlenecked by the manual process. She doesn't know agentic AI exists. She needs superpowers, not a tutorial.

---

## The Vision

Karen describes what she's looking for. A preflight system validates her research brief. She hits "launch." She goes to sleep. Overnight, a clone pipeline processes hundreds of documents in parallel. She wakes up to a structured treasure trove of findings, connections, and leads to follow up on.

---

## System Components

### 1. Research Brief Preflight

A guided check that validates Karen's query before launching the pipeline. Same concept as the code launch/preflight/build pipeline, but for research.

**Preflight Checklist:**

| Marker | Fail Example | Pass Example |
|--------|-------------|--------------|
| **Intention Clarity** | "Find stuff about gut health" | "Identify studies linking heavy metal exposure to measurable gut microbiome diversity changes" |
| **Scope Definition** | "Everything" | "Human studies, 2015-2025, excluding animal models, English language" |
| **Variable Specification** | (none) | "Primary: mercury, lead exposure. Secondary: zinc. Ignore: supplement dosage" |
| **Output Format** | "Tell me what you find" | "Per study: sample size, exposure type, duration, measurement method, key finding, confidence" |
| **Validation Criteria** | (none) | "Relevant = study directly measured both exposure and microbiome outcome" |
| **Contradiction Handling** | (none) | "Flag disagreements, prefer larger sample sizes, note methodology differences" |
| **Connection Detection** | (none) | "Flag any two studies referencing the same biomarker in different disease contexts" |
| **Weighting/Preference** | (none) | "Prioritize RCTs over observational. Weight sample size > 100 higher." |

The preflight AI reviews her brief, asks clarifying questions, and only greenlights launch when all markers pass. This front-loads the thinking so the overnight run produces useful output, not noise.

### 2. Document Processing Pipeline

**PDF to Structured JSON:**

```json
{
  "id": "study-047",
  "title": "Mercury exposure and intestinal...",
  "authors": ["Smith et al."],
  "year": 2023,
  "journal": "Environmental Health Perspectives",
  "doi": "10.xxxx/xxxxx",
  "sections": [
    { "heading": "Abstract", "content": "..." },
    { "heading": "Methods", "content": "...", "subsections": [...] },
    { "heading": "Results", "content": "...", "figures": ["Fig 1: ..."] },
    { "heading": "Discussion", "content": "..." }
  ],
  "metadata": { "study_type": "RCT", "sample_size": 240, "population": "adults" }
}
```

**RAG Indexing:**
- Vector embed at section/paragraph level
- Before/after summaries per chunk
- Metadata filtering (date, study type, population)
- Retrieval returns relevant chunks, not full documents

### 3. Clone Pipeline (see VISION_CLONE_PIPELINE.md)

**Configuration for research:**
- 6 clones in parallel
- Each clone uses 6 sub-agents (one per document)
- 36 documents processed per cycle
- Clone rotates when batch complete
- Parent manages synthesis across batches

**Per-document sub-agent prompt:**

```
You are analyzing a medical research document for the following research question:
[Karen's validated brief]

Document: [structured JSON of this study]

Extract:
- [output format fields from brief]
- Any mentions of [specified variables]
- Methodology strengths/weaknesses
- Relevant connections to [brief's connection criteria]

If the study is not relevant per the validation criteria, respond with:
NOT_RELEVANT: [one-sentence reason]
```

### 4. Iterative Refinement Loop

The pipeline is not designed to be perfect on run one. It's designed to be cheap enough to re-run.

**Night 1:** Broad sweep. "Find all studies linking heavy metals to gut microbiome."
- Result: 900 documents scanned, 180 flagged relevant
- Discovery: 40% mention metallothionein (unexpected)

**Morning review:** Karen spots the pattern. Refines.

**Night 2:** Targeted pass. "Go back through all 900. Extract every metallothionein mention. Context, correlation, direct measurement vs reference."
- Result: Structured extraction across all documents for one specific biomarker

**Night 3:** Connection mapping. "Cross-reference metallothionein findings with autoimmune marker studies from night 1. Find overlapping authors, shared citations, contradictions."

Each iteration costs a few dollars (K2 token pricing). Each morning, Karen has better data and a sharper question for the next night.

### 5. Results Dashboard

Karen wakes up and sees:

**Summary view:**
- X documents processed, Y flagged relevant, Z connections found
- Top findings ranked by confidence/relevance
- Unexpected patterns surfaced
- Contradictions flagged

**Drill-down:**
- Click any finding to see which studies support it
- Click any study to see the raw extraction
- Click any connection to see the two studies side by side

**Action items:**
- "These 12 studies warrant closer reading" (linked to full PDFs)
- "These 3 contradictions need resolution"
- "Suggested refinements for next run: [auto-generated based on patterns]"

---

## Economics

**K2 (Moonshot K2.5) pricing advantage:**
- Trillion-parameter model with broad knowledge base (likely ingested PubMed)
- Token pricing significantly lower than comparable models
- An overnight 900-document run: estimated $2-5
- Daily iteration over a week: $15-35 total
- Cheaper than one hour of a research assistant's time

**Multi-account strategy:**
- 6 accounts at lower tiers = 6x throughput ceiling
- Round-robin key assignment per clone
- Same or lower total cost than one premium account

---

## Why K2 Specifically

For code generation, model size matters less than training data quality. For medical research:
- Trillion parameters = broader knowledge coverage
- Likely trained on scientific literature (PubMed, bioRxiv, etc.)
- Can recognize enzymes, pathways, biomarkers by name
- Can infer connections that a smaller model would miss
- The pattern-matching Karen does manually is exactly what a large model excels at when given structured prompts

---

## Prerequisites

1. **Pulse engine** (this project) — coordination clock
2. **Clone pipeline** (this project) — parallel agent management
3. **PDF-to-JSON converter** — structured document ingestion
4. **RAG system** — vector indexing and retrieval
5. **Research preflight** — prompt validation system
6. **Results dashboard** — morning-after review UI
7. **Launchpad integration** — overnight scheduling, monitoring

---

## Relationship to Current Project

The Kimi IDE streaming render engine is step 1. It builds:
- The pulse engine (coordination clock for everything)
- Tool call segment rendering (seeing what agents are doing)
- The clone spawning pattern (parallel wire processes)
- The compact HUD view (monitoring parallel work)

Karen's research assistant is the same architecture running at scale, overnight, with a research-specific preflight instead of a code-specific one.

---

*Captured: 2026-03-01*
*Status: Vision — not yet implemented*
*First user: Karen (medical research, freelance)*
