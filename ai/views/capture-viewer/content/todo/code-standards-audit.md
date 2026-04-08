# Code Standards Audit

Non-conforming files identified against `ai/views/wiki-viewer/content/enforcement/code-standards/PAGE.md`.

---

## CRITICAL: Oversized Files (400+ lines)

| File | Lines | Problem |
|------|-------|---------|
| `open-robin-server/server.js` | 1752 | God file - routing, WebSocket, static files, harnesses, audio, views, Robin, clipboard, wiki, event bus, config, triggers, threads |
| `open-robin-client/src/components/Robin/RobinOverlay.tsx` | 886 | Tabs + wiki + CLI registry + config + themes + chat |
| `open-robin-server/lib/thread/ThreadWebSocketHandler.js` | 590 | WebSocket + thread switching + wire process management |
| `open-robin-server/lib/thread/ThreadManager.js` | 590 | ThreadIndex + ChatFile + lifecycle + timeouts |
| `open-robin-client/src/lib/ws-client.ts` | 551 | Connection + routing + multiple message type handlers |
| `open-robin-client/src/mic/VoiceRecorder.tsx` | 527 | Voice recording + transcription + UI |
| `open-robin-client/src/lib/catalog-visual.ts` | 492 | Catalog visualization/rendering |
| `open-robin-client/src/components/hover-icon-modal/HoverIconModal.tsx` | 472 | Modal + dropdown logic |
| `open-robin-server/lib/harness/clis/base-cli-harness.js` | 477 | Base harness orchestration + stream handling |
| `open-robin-server/lib/harness/clis/qwen/index.js` | 433 | Event translation + session state + tool mapping |
| `open-robin-server/lib/harness/compat.js` | 426 | Compatibility layer with multiple concerns |
| `open-robin-client/src/emojis/EmojiTrigger.tsx` | 418 | Emoji selection/rendering |
| `open-robin-client/src/components/LiveSegmentRenderer.tsx` | 417 | Segment rendering for streamed content |
| `open-robin-server/lib/harness/clis/gemini/index.js` | 405 | Gemini harness implementation |

---

## Hardcoded z-index (should use `var(--z-*, fallback)`)

✅ **FIXED by SPEC-15** — all 11 z-index values replaced with `var(--z-*, fallback)`.

---

## Hardcoded Colors (should use `var(--palette-*, fallback)`)

- `open-robin-client/src/App.css:15-18` - `#646cffaa`, `#61dafbaa`
- `open-robin-client/src/App.css:41` - `#888`

---

## Hardcoded Spacing (should use `var(--space-*, fallback)`)

- ~~`open-robin-client/src/mic/VoiceRecorder.css`~~ ✅ **FIXED by SPEC-17**
- `open-robin-client/src/App.css` - `max-width: 1280px; padding: 2rem` *(dead Vite boilerplate — to be deleted by SPEC-16)*

---

## Components Making Direct API/Fetch Calls

- `open-robin-client/src/components/ChatHarnessPicker/index.tsx` - calls `fetch('/api/harnesses')` directly

---

## Components Importing State Stores (not portable)

- `open-robin-client/src/components/App.tsx` - imports `usePanelStore`
- `open-robin-client/src/components/ToolsPanel.tsx` - imports `usePanelStore`
- `open-robin-client/src/components/tickets/TicketBoard.tsx` - imports `usePanelStore`, `useTicketStore`
- `open-robin-client/src/components/wiki/WikiExplorer.tsx` - imports `usePanelStore`, `useWikiStore`
- `open-robin-client/src/components/wiki/PageViewer.tsx` - imports `usePanelStore`, `useWikiStore`, `useActiveResourceStore`

---

## Inline Styles in JSX (should use component CSS)

- `open-robin-client/src/mic/VoiceRecorder.tsx` - multiple `style={{}}` attributes
- `open-robin-client/src/components/App.tsx` - inline styles on panel-container
- `open-robin-client/src/components/tickets/TicketBoard.tsx` - `style={{ position: 'relative' }}`
- `open-robin-client/src/components/Orb.tsx` - multiple inline styles
- `open-robin-client/src/components/tile-row/DocumentTile.tsx` - `style={{ width: '100%', height: '100%', objectFit: 'cover' }}`

---

## Missing `.rv-` Class Name Prefix

All component CSS classes lack the `.rv-` prefix convention:
- `.voice-recorder__*` -> `.rv-voice-recorder-*`
- `.logo` -> `.rv-logo`
- `.card` -> `.rv-card`
- `.read-the-docs` -> `.rv-read-the-docs`
- `.ticket-detail` -> `.rv-ticket-detail`

---

## High Import Count (5+ unrelated modules)

- `open-robin-client/src/components/App.tsx` - 12 imports across hooks, stores, and components

---

## Summary

| Category | Count | Status |
|----------|-------|--------|
| Oversized files (400+) | 14 | pending |
| Hardcoded z-index locations | 8 | ✅ FIXED (SPEC-15) |
| Hardcoded color locations | 3 | pending (App.css deletion via SPEC-16) |
| Hardcoded spacing in VoiceRecorder.css | 30+ | ✅ FIXED (SPEC-17) |
| Components with direct fetch | 1 | pending (SPEC-19) |
| Components importing stores | 5+ | pending |
| Files with inline styles | 5+ | pending (SPEC-21) |
| Missing rv- prefix | widespread | pending (SPEC-18) |
