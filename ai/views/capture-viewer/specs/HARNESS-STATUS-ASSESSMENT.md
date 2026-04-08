# Harness Implementation Status Assessment

**Date:** 2026-04-05  
**Purpose:** Clarify what has been implemented vs what was intended

---

## Executive Summary

**The Problem:** Phase 1 extracted the KIMI CLI handling into a class called `RobinHarness`, but it still just spawns `kimi --wire --yolo`. There is NO Vercel AI SDK integration. The "Robin" harness is KIMI CLI with a different name.

**What You Expected:** Robin harness using Vercel AI SDK to call OpenAI/Anthropic/etc directly (BYOK).

**What Exists:** Robin harness that wraps the KIMI CLI binary (same as before, just extracted).

---

## Current Implementation (What Exists)

### File Structure
```
lib/harness/
├── types.js              # Canonical event type definitions
├── index.js              # Public API exports
├── feature-flags.js      # HARNESS_MODE switching (legacy/new/parallel)
├── compat.js             # Compatibility shim for gradual migration
└── robin/
    ├── index.js          # RobinHarness class (WRAPS KIMI CLI)
    ├── wire-parser.js    # JSON-RPC parsing from KIMI wire protocol
    ├── event-translator.js  # Translates KIMI events to canonical
    ├── session-state.js  # Session state management
    ├── tool-mapper.js    # KIMI tool name mapping
    └── __tests__/        # Unit tests
```

### The RobinHarness Class (lib/harness/robin/index.js)

```javascript
// Line 48-62: IT SPAWNS KIMI CLI
async startThread(threadId, projectRoot) {
  const robinPath = this.config.cliPath || process.env.KIMI_PATH || 'kimi';
  const args = ['--wire', '--yolo', '--session', threadId];
  
  const proc = spawn(robinPath, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, TERM: 'xterm-256color' }
  });
  // ... rest of wire protocol handling
}
```

**This is NOT Vercel AI SDK. This is KIMI CLI with a rename.**

### Package.json Dependencies

```json
{
  "dependencies": {
    "better-sqlite3": "^12.8.0",
    "express": "^5.2.1",
    "gpt-tokenizer": "^3.4.0",
    "knex": "^3.2.7",
    "multer": "^1.4.5-lts.1",
    "nodejs-whisper": "^0.2.9",
    "uuid": "^13.0.0",
    "ws": "^8.19.0"
  }
}
```

**Missing:** `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, etc.

---

## What Was Intended (Vercel AI SDK)

### The Real RobinHarness Should Be:

```javascript
// lib/harness/robin/index.js - WHAT IT SHOULD BE
const { streamText } = require('ai');
const { openai } = require('@ai-sdk/openai');
// or anthropic, etc.

class RobinHarness {
  async *sendMessage(message, options) {
    // Call OpenAI/Anthropic directly via Vercel SDK
    const result = await streamText({
      model: openai('gpt-4o'),
      messages: [...],
      tools: {...},
    });
    
    // Yield canonical events from the stream
    for await (const chunk of result.textStream) {
      yield { type: 'content', text: chunk };
    }
  }
}
```

### Key Differences

| Aspect | Current (Wrong) | Intended (Correct) |
|--------|-----------------|-------------------|
| **Process** | Spawns `kimi` CLI | Uses Vercel AI SDK |
| **Protocol** | Parses JSON-RPC wire | Uses SDK streaming |
| **Models** | k1.6 only | OpenAI, Anthropic, etc. |
| **API Key** | None needed (local CLI) | User provides BYOK |
| **Identity** | Still KIMI under the hood | Actually independent |

---

## What Needs to Happen

### Option A: Fix Robin to Use Vercel AI SDK (Recommended)

1. **Install dependencies:**
   ```bash
   npm install ai @ai-sdk/openai @ai-sdk/anthropic
   ```

2. **Rewrite `lib/harness/robin/index.js`:**
   - Remove `spawn('kimi', ...)` 
   - Implement Vercel SDK streaming
   - Add provider configuration (API keys, model selection)

3. **Create provider adapters:**
   - `lib/harness/robin/providers/openai.js`
   - `lib/harness/robin/providers/anthropic.js`
   - etc.

4. **Update types:**
   - Add provider config to `HarnessConfig`

### Option B: Rename Current "Robin" to "KimiHarness"

1. Rename `lib/harness/robin/` → `lib/harness/kimi/`
2. Rename `RobinHarness` → `KimiHarness`
3. Keep it as the KIMI CLI wrapper
4. Create NEW `lib/harness/robin/` for Vercel SDK (actual Robin)

### Option C: Keep Both

- `lib/harness/kimi/` - KIMI CLI wrapper (extracted Phase 1)
- `lib/harness/robin/` - Vercel AI SDK (new Phase 2)
- UI selector chooses between them

---

## Recommendation

**Go with Option C:**

1. **Rename current `robin/` to `kimi/`** - This preserves the Phase 1 extraction work
2. **Create new `robin/` with Vercel SDK** - This is the actual BYOK harness you wanted
3. **Update specs** to reflect the real architecture

This way:
- Phase 1 work isn't wasted (extracted KIMI CLI handling)
- Robin becomes what you intended (Vercel SDK BYOK)
- You can A/B test between KIMI CLI and Robin (different backends entirely)

---

## Files That Need Changes

### Immediate (To Fix the Confusion)

| File | Action |
|------|--------|
| `lib/harness/robin/index.js` | Either rename to `kimi/` OR rewrite with Vercel SDK |
| `package.json` | Add `ai` and `@ai-sdk/*` dependencies |
| Phase 1 spec | Clarify it extracts KIMI CLI (not Vercel SDK) |
| Phase 2B spec | Update to show Robin = Vercel SDK, KIMI = CLI |

### New Files Needed (For Vercel SDK Robin)

```
lib/harness/robin/index.js          # Rewrite with Vercel SDK
lib/harness/robin/config.js         # Provider configuration
lib/harness/robin/providers/
├── openai.js                       # OpenAI provider
├── anthropic.js                    # Anthropic provider
└── ollama.js                       # Local Ollama provider
```

---

## Bottom Line

**What exists:** Phase 1 extracted KIMI CLI handling into a class called RobinHarness (misleading name).

**What's missing:** Vercel AI SDK integration for actual BYOK functionality.

**Next step:** Either rename current to `kimi/` and create proper `robin/` with Vercel SDK, OR rewrite current `robin/` to use Vercel SDK.
