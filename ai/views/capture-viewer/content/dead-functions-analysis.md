# Dead Functions Analysis

Generated: March 29, 2026

## Client-Side Dead Functions (`kimi-ide-client/src/`)

### 1. `isModuleLoaded()` - `engine/runtime-module.ts:194`
Exported but never called. Intended to check if a panel has an active runtime module.

### 2. `reloadModule()` - `engine/runtime-module.ts:183`  
Exported but never called. Intended for hot-reload support of panel modules.

### 3. `onModalAction()` - `lib/modal.ts:53`
Exported but never imported. The callback registration for modal actions exists but nobody registers a callback.

### 4. `dismissModal()` - `lib/modal.ts:41`
Exported but never called. Only referenced in a comment in `ModalOverlay.tsx`.

### 5. `getCodeChunkBoundary()` - `lib/text/chunk-boundary.ts:128`
Exported but never imported. Was intended for line-by-line code chunking.

### 6. `getCodeCommentBoundary()` - `lib/text/chunk-boundary.ts:145`
Exported but never imported. Was intended for `//` comment-based chunking.

### 7. `ChunkBuffer.peek()` - `lib/text/chunk-buffer.ts:55`
Method defined on the interface and implemented but never called.

### 8. `ChunkBuffer.size()` - `lib/text/chunk-buffer.ts:68`
Method defined but never called.

### 9. `ChunkBuffer.clear()` - `lib/text/chunk-buffer.ts:72`
Method defined but never called.

### 10. `captureConsoleLogs()` - `lib/logger.ts:12`
Called in `ws-client.ts` but is a no-op (empty function body).

### 11. `TIMING` const - `types/index.ts:176`
Exported constant object with timing values, but never imported. Code uses `(window as any).__TIMING` instead.

---

## Server-Side Dead Functions (`kimi-ide-server/`)

### 12. `getProjectConfig()` - `config.js:85`
Exported but never imported outside config.js.

### 13. `setProjectConfig()` - `config.js:90`
Exported but never imported outside config.js.

### 14. `getPanelState()` - `config.js:105`
Exported but never imported outside config.js.

### 15. `setPanelState()` - `config.js:115`
Exported but never imported outside config.js.

### 16. `saveChatHistory()` - `config.js:140`
Exported but never imported outside config.js.

### 17. `loadChatHistory()` - `config.js:151`
Exported but never imported outside config.js.

### 18. `updateConfig()` - `config.js:79`
Exported but never imported outside config.js.

### 19. `saveConfig()` - `config.js:55`
Exported but never imported outside config.js (used internally).

### 20. `loadConfig()` - `config.js:34`
Exported but never imported outside config.js (used internally).

### 21. `setLastProject()` - `config.js:100`
Exported but never imported outside config.js.

---

## Summary Table

| Function | File | Notes |
|----------|------|-------|
| `isModuleLoaded()` | `engine/runtime-module.ts` | Future hot-reload support |
| `reloadModule()` | `engine/runtime-module.ts` | Future hot-reload support |
| `onModalAction()` | `lib/modal.ts` | Callback registration unused |
| `dismissModal()` | `lib/modal.ts` | Never called |
| `getCodeChunkBoundary()` | `lib/text/chunk-boundary.ts` | Unused chunking strategy |
| `getCodeCommentBoundary()` | `lib/text/chunk-boundary.ts` | Unused chunking strategy |
| `ChunkBuffer.peek()` | `lib/text/chunk-buffer.ts` | Queue method unused |
| `ChunkBuffer.size()` | `lib/text/chunk-buffer.ts` | Queue method unused |
| `ChunkBuffer.clear()` | `lib/text/chunk-buffer.ts` | Queue method unused |
| `captureConsoleLogs()` | `lib/logger.ts` | No-op function |
| `TIMING` | `types/index.ts` | Replaced by window.__TIMING |
| `getProjectConfig()` | `config.js` | Unused config helper |
| `setProjectConfig()` | `config.js` | Unused config helper |
| `getPanelState()` | `config.js` | Unused config helper |
| `setPanelState()` | `config.js` | Unused config helper |
| `saveChatHistory()` | `config.js` | Chat now uses SQLite |
| `loadChatHistory()` | `config.js` | Chat now uses SQLite |
| `updateConfig()` | `config.js` | Only used internally |
| `saveConfig()` | `config.js` | Only used internally |
| `loadConfig()` | `config.js` | Only used internally |
| `setLastProject()` | `config.js` | Only used internally |

## Notes

Most of the config.js exports appear to be legacy from when the server managed chat history in JSON files—now that threads use SQLite via `HistoryFile` and `ThreadManager`, these functions are obsolete.
