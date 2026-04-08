# Run Auditing

Every wiki run produces a complete trace — ticket, frozen process files, step-by-step reasoning, before/after snapshots. This makes the agent's work auditable and optimizable.

## What a Run Contains

```
agents/{agent-id}/runs/{timestamp}/
├── ticket.md              ← frozen copy of the ticket that triggered this run
├── AGENT.md               ← frozen agent identity at run time
├── WORKFLOW.md            ← frozen process rules at run time
├── manifest.json          ← machine-readable metadata
├── steps/
│   ├── 01-gather.md       ← what was read, what was found
│   ├── 02-propose.md      ← proposed changes + confidence
│   ├── 03-edges.md        ← edge check, child ticket declarations
│   ├── 04-execute.md      ← what was edited, reasoning
│   └── 05-verify.md       ← convergence proof
└── snapshots/
    ├── {topic}-before.md   ← PAGE.md before edit
    └── {topic}-after.md    ← PAGE.md after edit
```

## Why Frozen Copies Matter

AGENT.md and WORKFLOW.md are copied into each run folder at start. When you audit a run from three months ago, you see exactly what the agent was told to do — not the current version of those files. This is essential for:

- **Reproducibility:** Knowing what instructions produced what result
- **Process evolution:** Comparing old WORKFLOW.md and prompts to current and seeing what improved
- **Blame analysis:** If a run produced a bad edit, was it the prompts, the workflow, or the model?

## DSPy-Style Crawl

Periodically crawl completed runs to score quality and find optimization opportunities.

### What to Score

| Step | Question | Signal |
|------|----------|--------|
| 01-gather | Did it read all relevant source material? | Missed sources = incomplete gather |
| 02-propose | Was the confidence level accurate? | High-confidence proposals that were wrong = calibration issue |
| 03-edges | Did it catch all affected pages? | Missed edges discovered later = edge check gap |
| 04-execute | Did the edit match the proposal? | Drift between proposal and execution = process skip |
| NN-converge | Did it actually converge? False convergence? | Pages edited again soon after = false convergence |

### How to Crawl

```
1. List all runs: ls ai/workspaces/background-agents/agents/{agent-id}/runs/
   Each run is a timestamped folder with frozen copies of everything
2. For each run, read manifest.json:
   - How many topics touched?
   - How deep was edge propagation?
   - Any cycles?
   - Did it converge?
3. For runs that converged, check:
   - Were any touched topics edited again within 7 days? (false convergence)
   - Did child runs succeed or get blocked?
4. For blocked runs, read 02-propose.md:
   - Was the block justified? (low confidence that was correct)
   - Or was it overly cautious? (blocked on something verifiable)
5. Compare WORKFLOW.md across runs:
   - When did the process change?
   - Did quality improve after changes?
```

### Patterns to Look For

| Pattern | What it means | Fix |
|---------|--------------|-----|
| Gather steps consistently miss git history | Agent not checking commits | Add "read git log" to WORKFLOW.md gather checklist |
| Edge checks over-trigger (too many false stale edges) | Edge detection too sensitive | Tighten the staleness criteria in WORKFLOW.md |
| High-confidence proposals get rejected | Confidence calibration off | Add more verification requirements for "high" |
| Same topic touched in multiple consecutive runs | Pages are unstable or triggers are too aggressive | Debounce triggers or add a cooldown |
| Runs consistently converge at depth 1 | Edge propagation working but shallow | Good — this is healthy |
| Runs frequently hit the circuit breaker | Circular dependencies in the wiki graph | Restructure pages to break cycles |

### When to Audit

- After the first 10 runs (initial calibration)
- Monthly (ongoing quality check)
- After changing WORKFLOW.md (verify improvement)
- After adding several new wiki topics (graph complexity changed)

## Compaction

Auditing needs data. Compaction removes it. Balance:

- **0-30 days:** Full run data. Audit freely.
- **30-90 days:** Snapshots removed, steps and manifests remain. Can still audit process.
- **90+ days:** Only manifest.json and ticket.md. Summary-level auditing only.

Run your DSPy crawl within the 30-day window for full detail.

## Related

- [Wiki-System](Wiki-System) — the wiki workspace that produces runs
- [Workspace-Agent-Model](Workspace-Agent-Model) — the process files that get frozen
- [Ticket-Routing](Ticket-Routing) — how tickets trigger runs
