# Code Standards Audit — Spec Index

22 specs generated from code standards audit. Each spec includes dependencies, gotchas, and silent fail risks.

---

## Recommended Execution Order

### Phase 1: Foundations (CSS tokens + z-index)
| Order | Spec | Priority | Risk |
|-------|------|----------|------|
| 1 | [SPEC-15](15-css-zindex-standardization.md) | Z-index hierarchy | ✅ DONE |
| 2 | [SPEC-17](17-css-spacing-standardization.md) | Spacing + font tokens | ✅ DONE |
| 3 | [SPEC-16](16-css-color-standardization.md) | Color cleanup | LOW — Vite leftovers |

### Phase 2: CSS Cleanup (depends on Phase 1)
| Order | Spec | Priority | Risk |
|-------|------|----------|------|
| 4 | [SPEC-21](21-inline-styles-extraction.md) | Inline styles -> CSS | MEDIUM — blocked by SPEC-17 |
| 5 | [SPEC-18](18-rv-prefix-migration.md) | .rv- class prefix | MEDIUM — 395 classes, querySelector gotcha |

### Phase 3: Server Module Extraction
| Order | Spec | Priority | Risk |
|-------|------|----------|------|
| 6 | [SPEC-04](04-thread-manager-split.md) | ThreadManager split | LOW — no dependencies, do first |
| 7 | [SPEC-03](03-thread-ws-handler-split.md) | ThreadWebSocketHandler split | MEDIUM — depends on SPEC-04 |
| 8 | [SPEC-11](11-compat-js-split.md) | compat.js split | MEDIUM — migration infrastructure |
| 9 | [SPEC-10](10-qwen-harness-split.md) + [SPEC-14](14-gemini-harness-split.md) | Qwen+Gemini shared extraction | HIGH — subtle differences |
| 10 | [SPEC-01](01-server-js-decomposition.md) | server.js decomposition | **CRITICAL — do LAST** |

### Phase 4: Client Component Extraction
| Order | Spec | Priority | Risk |
|-------|------|----------|------|
| 11 | [SPEC-05](05-ws-client-split.md) | ws-client.ts split | HIGH — turn lifecycle fragile |
| 12 | [SPEC-02](02-robin-overlay-split.md) | RobinOverlay split | MEDIUM — after tokens in place |
| 13 | [SPEC-08](08-hover-icon-modal-split.md) | HoverIconModal split | LOW — module-level state gotcha |
| 14 | [SPEC-06](06-voice-recorder-split.md) | VoiceRecorder split | LOW — cleanup order matters |

### Safe Anytime
| Spec | Priority | Risk |
|------|----------|------|
| [SPEC-12](12-emoji-trigger-split.md) | LOW — optional data extraction | Minimal |
| [SPEC-19](19-chat-harness-picker-fetch.md) | LOW — remove redundant fetch | Minimal |

### Do Not Implement (deprioritized or no-split)
| Spec | Reason |
|------|--------|
| [SPEC-07](07-catalog-visual-split.md) | One job (data catalog), acceptable size |
| [SPEC-09](09-base-cli-harness-split.md) | One job (base class), acceptable size |
| [SPEC-13](13-live-segment-renderer-split.md) | **DO NOT SPLIT** — breaks completion detection |
| [SPEC-20](20-state-store-decoupling.md) | Zustand pattern is standard for React |
| [SPEC-22](22-app-tsx-import-reduction.md) | Root orchestrator, imports are composition |

---

## Dependency Graph

```
SPEC-17 (tokens) ──blocks──> SPEC-21 (inline styles)
SPEC-17 (tokens) ──should──> SPEC-02 (RobinOverlay)
SPEC-15 (z-index) ──should──> all CSS work

SPEC-04 (ThreadManager) ──before──> SPEC-03 (ThreadWS)
SPEC-03 (ThreadWS) ──before──> SPEC-11 (compat)
SPEC-11 (compat) ──before──> SPEC-10/14 (harnesses)
ALL server specs ──before──> SPEC-01 (server.js)

SPEC-05 (ws-client) ──before──> SPEC-02 (RobinOverlay robin handlers)
```

## Top 5 Silent Fail Risks

1. **ws-client setPendingTurnEnd** — if not cleared on turn_begin, new turns finalize immediately (past bug)
2. **server.js checkSettingsBounce** — if enforcement lost during extraction, AI writes to settings/ folders
3. **server.js session closure** — if session not injected to extracted handlers, wrong session mutated
4. **ThreadManager autoRename race** — closeSession during Kimi subprocess causes state inconsistency
5. **Qwen/Gemini provider ID** — hardcoded in shared base breaks token normalization
