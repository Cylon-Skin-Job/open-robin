---
title: Render Pipeline Refactor Spec
created: 2026-03-25
status: in-progress
---

# Render Pipeline Refactor Spec

Summary of all changes made during the 2026-03-25 session. Covers the orb, timing, text/tool separation, transforms, and file cleanup.

---

## 1. Dynamic Orb (was: fixed 2s timer)

### Problem
The orb had a fixed 2s CSS animation. If the API took longer than 2s to return the first token (which it often does — measured up to 2.9s), there was a visible gap of dead air between the orb disappearing and the first content appearing.

### Solution
The orb is now **dynamic** — it holds indefinitely until the first token arrives, then runs a 500ms disposal sequence.

### Timeline
```
0ms       Orb element mounts (opacity 0, scale 0.3)
0-500ms   Wait phase — nothing visible (CSS animation-delay: 500ms)
500-2000ms  Expand phase — opacity 0→1, scale 0.3→1 over 1500ms
2000ms+   Hold phase — orb at full size, pulsing, waiting for first token
TOKEN     Dispose phase — shrink to 0.3, fade out over 500ms
+500ms    orbDone=true → first segment mounts immediately
```

### Key files
- `src/styles/animations.css` — `blur-sphere-expand`, `blur-sphere-dispose` keyframes
- `src/components/LiveSegmentRenderer.tsx` — `orbDisposing` state, `useEffect` watches `segments[0].content.length > 0`

### Rules
- The orb is NOT part of the render pipeline. It never appears a second time.
- No render logic (shimmer, delays, parsers) applies to the orb.
- The orb's job: bridge the gap between user action and first token. Nothing more.

---

## 2. Shimmer Skip for First Segment

### Problem
After the orb ended, the first tool segment (`LiveToolSegment`) ran a 500ms shimmer delay before starting its reveal. This created a second gap.

### Solution
First segment after the orb (`index === 0`) passes `skipShimmer={true}` to `LiveToolSegment`. The shimmer phase is skipped — reveal starts immediately on mount. The `tool-fade-in` CSS animation (200ms, opacity 0→1) still plays.

### Key files
- `src/components/LiveSegmentRenderer.tsx` — `skipShimmer` prop on `LiveToolSegment`

---

## 3. Tool Fade-In Reduced to 200ms

Was 300ms. Now 200ms. Both the CSS animation and the `SHIMMER_FADE_IN` timing constant.

### Key files
- `src/styles/animations.css` — `.tool-fade-in` animation duration
- `src/lib/timing.ts` — `SHIMMER_FADE_IN = 200`

---

## 4. Blinking Cursor Restored

### What
A blinking block cursor (`&#x2588;`) appears during typing animation in both tool and text segments. It sits at the end of typed content, blinks at line starts, races across as characters appear.

### Implementation
- Tool segments: `<span className="typing-cursor">` appended in JSX when `phase === 'revealing'`
- Text segments: `<span class="typing-cursor">` appended to HTML string when `typing === true`
- CSS: `.typing-cursor` with `animation: blink 800ms infinite`, themed via `--theme-primary`

### Key files
- `src/components/LiveSegmentRenderer.tsx` — cursor in both `LiveToolSegment` and `LiveTextSegment`
- `src/styles/animations.css` — `blink` keyframes, `.typing-cursor` styles

---

## 5. Timing Instrumentation

### What
`[TIMING]` console logs at every critical point for measuring render gaps.

### Events logged
- `SEND` — user sends message (`performance.now()`)
- `FIRST TOKEN` — first thinking or content token arrives (+ TTFT calculation)
- `ORB START` — orb element mounts
- `ORB DISPOSE START` — disposal triggered by first token
- `ORB END` — disposal animation complete
- `RENDER SIGNAL` — first `LiveToolSegment.useEffect` fires (+ deltas from send, orb end, first token)
- `REVEAL START` — orchestrator begins typing

### Storage
All timestamps stored on `window.__TIMING` so Playwright tests can read them.

### Key files
- `src/hooks/useWebSocket.ts` — SEND, FIRST TOKEN logs
- `src/components/LiveSegmentRenderer.tsx` — ORB, RENDER SIGNAL, REVEAL START logs
- `e2e/timing-debug.spec.ts` — Playwright test that captures and reports all timing

---

## 6. Text Module Split (`src/lib/text/`)

### Problem
Text chunk parsing, buffering, and boundary detection were in generic-sounding files (`chunkParser.ts`, `chunkBuffer.ts`) that could be confused with tool-side parsers. All text sub-types (paragraphs, headers, code fences, lists) were handled by one `marked.parse()` call with no isolation.

### Solution
```
src/lib/text/
  ├── index.ts              ← dispatcher + re-exports
  ├── chunk-boundary.ts     ← was chunkParser.ts (text boundary detection)
  ├── chunk-buffer.ts       ← was chunkBuffer.ts (queue + speed attenuator)
  ├── html-utils.ts         ← truncateHtmlToChars, getVisibleTextLength
  └── renderers/
      ├── types.ts          ← TextSubRenderer interface
      ├── paragraph.ts      ← default prose (fallback)
      ├── header.ts         ← # headings
      ├── code-fence.ts     ← ``` fenced blocks
      └── list.ts           ← bullet/numbered lists
```

### Sub-renderer interface
```ts
interface TextSubRenderer {
  matches(content: string, fromIndex: number): boolean;
  findBoundary(content: string, fromIndex: number): number;
  toHtml(content: string): string;
}
```

### Dispatcher
`getTextSubRenderer(content, fromIndex)` — tries renderers in order: code-fence > header > list > paragraph. First match wins.

### Status
Modules created and importable. **Not yet wired into the animate loop** — `LiveTextSegment` still uses the old single-pass `getContentRenderer('markdown').parseChunks`. Next step: replace that with the dispatcher.

---

## 7. Transforms Module (`src/lib/transforms/`)

### Problem
`marked.parse()` called from 8 files. `escapeHtml` defined 4 times. No single source of truth for how markdown or code renders.

### Solution
```
src/lib/transforms/
  ├── index.ts        ← single entry point
  ├── markdown.ts     ← ONE configured marked instance → markdownToHtml()
  └── code.ts         ← ONE escapeHtml(), codeBlockHtml(), preWrapHtml()
```

### Result
- `marked` imported exactly **once** in the entire codebase
- `escapeHtml` defined exactly **once**
- Every component imports from `transforms/`
- Change code styling → edit `code.ts` → uniform everywhere
- Change markdown config → edit `markdown.ts` → uniform everywhere
- Add syntax highlighting → one place to wire it

### Consumers (all updated)
- `LiveSegmentRenderer.tsx`
- `InstantSegmentRenderer.tsx`
- `wiki/PageViewer.tsx`
- `segment-renderers/markdown.ts`
- `segment-renderers/code.ts`
- `segment-renderers/line-stream.ts`
- `segment-renderers/diff.ts`
- `segment-renderers/grouped-summary.ts`
- `text/renderers/paragraph.ts`
- `text/renderers/header.ts`
- `text/renderers/code-fence.ts`
- `text/renderers/list.ts`

---

## 8. Server Cleanup

### Removed
- Redundant Python file server on port 5173 (from `restart-kimi.sh`)
- All references to port 5173 in restart script
- Empty `kimi-ide/` abandoned directory
- Log files: `server.log`, `server-live.log`, `wire-debug.log`, `dev.log`
- `kimi-ide-client/Untitled` (empty artifact)
- 42 test screenshots in `e2e/screenshots/`
- Empty `pipeline/` directories in server
- Stale `.claude/worktrees/`

### Moved to `ai/scripts/`
- `scripts/git-credential-kimi.sh`
- `scripts/sync-wiki.sh`
- `scripts/setup-secrets.js`
- `scripts/capture-wire-output.js`

### Moved to `ai/workspaces/capture/`
- Stale root docs (debug.md, ROADMAP.md, BUG_REPORT.md)
- Server spec docs (STREAMING_RENDER_SPEC.md, DROPDOWN_CODE_SPEC.md, analysis/*.md)
- Thread system docs (README.md, SERVER_INTEGRATION.md)
- Watcher filter docs (4 files)
- Client docs (FAILING_TESTS.md, FILE_EXPLORER_CHUNK_*.md)

### Result
- ONE server, ONE port (3001), ONE process
- `restart-kimi.sh` only references port 3001
- Scripts unified under `ai/scripts/` (agent tools)

---

## 9. Screenshot Symlink + Image Serving

### What
`ai/workspaces/capture/screenshots/` → symlink to `~/Desktop/Screenshots/`. Server serves images via HTTP. Capture workspace renders image thumbnails.

### Server route
`GET /api/workspace-file/:workspace/{*filePath}` — resolves symlinks, fuzzy-matches Unicode spaces in macOS screenshot filenames, serves the file.

### Client
`DocumentTile` detects image extensions (png, jpg, gif, webp, svg) and renders `<img>` with `object-fit: cover` instead of text preview. TileRow skips requesting file content for images (they don't need it).

### Key files
- `kimi-ide-server/server.js` — workspace-file HTTP route
- `src/components/tile-row/DocumentTile.tsx` — `isImageFile()`, image rendering
- `src/components/tile-row/TileRow.tsx` — image/text split in file loading

---

## 10. Wiki Pages Created

### Setup Wizard (`ai/workspaces/wiki/setup-wizard/PAGE.md`)
Onboarding checklist: required/recommended/optional tiers. Privacy principles: no auto system changes, local-first, opt-in escalation.

### Screenshot Capture (`ai/workspaces/wiki/screenshot-capture/PAGE.md`)
Documents the symlink approach, macOS setup, privacy, multi-project future.

---

## Architecture Diagram (current state)

```
User sends message
  │
  ├─→ WebSocket → useWebSocket.ts
  │     ├─ appendSegment(workspace, type, text)
  │     └─ [TIMING] logs: SEND, FIRST TOKEN
  │
  ├─→ LiveSegmentRenderer mounts
  │     ├─ Orb (dynamic, CSS-only, not in render pipeline)
  │     │   ├─ 500ms wait → 1500ms expand → hold → dispose on token
  │     │   └─ [TIMING] logs: ORB START, DISPOSE, END
  │     │
  │     ├─ LiveToolSegment (think, shell, edit, read, etc.)
  │     │   ├─ skipShimmer (first segment) or shimmer (400ms)
  │     │   ├─ ToolCallBlock (header + icon)
  │     │   ├─ reveal/ orchestrator + parsers
  │     │   ├─ typing cursor during reveal
  │     │   └─ collapse → done
  │     │
  │     └─ LiveTextSegment (prose, code, headers, lists)
  │         ├─ text/ chunk-boundary + chunk-buffer
  │         ├─ text/ renderers (paragraph, header, code-fence, list)
  │         ├─ transforms/ markdownToHtml
  │         ├─ typing cursor during typing
  │         └─ done
  │
  └─→ All HTML transforms via src/lib/transforms/
        ├─ markdownToHtml() — one marked instance
        └─ escapeHtml(), codeBlockHtml(), preWrapHtml()
```

---

## Known Issues / Next Steps

1. **Wire text sub-renderers into animate loop** — `LiveTextSegment` still uses single-pass `getContentRenderer('markdown').parseChunks`. Needs to use `getTextSubRenderer()` dispatcher instead.

2. **Line-break parser stall** — tool segments using `line-break.ts` parser won't emit a chunk until `\n` arrives. Slow-streaming thinking content stalls. Need a timeout fallback to release partial content.

3. **Workspace loading bug** — Wiki, Agents, Issues, Skills workspaces stuck on "Loading". Pre-existing. Documented in `capture/todo/workspace-loading-bug.md`.

4. **User bubble rendering** — Chat bubble appears at top of empty chat, renders twice on refresh. Reverted scroll changes. Needs separate investigation.

5. **Syntax highlighting** — `transforms/code.ts` is ready to accept a highlighting library (Prism, Shiki). Not wired yet.
