# IMMEDIATE ACTION REQUIRED

## The Problem

You have been working on Phase 1 and Phase 2 specs for a "Robin" harness, but:

1. **What exists:** `lib/harness/robin/` contains code that spawns `kimi --wire --yolo`
2. **What you wanted:** Robin harness using Vercel AI SDK to call OpenAI/Anthropic APIs
3. **The disconnect:** The "Robin" harness is just KIMI CLI with a different name

## Current State (Misleading)

```
lib/harness/robin/index.js  →  Spawns 'kimi' CLI process
                               (Just extracted KIMI handling)
```

## What Robin Should Be

```
lib/harness/robin/index.js  →  Uses Vercel AI SDK
                               Calls OpenAI/Anthropic APIs
                               No subprocess, no KIMI CLI
```

## What You Need to Decide NOW

### Option 1: Rename Current, Create New (RECOMMENDED)

```bash
# 1. Rename existing (preserves Phase 1 work)
mv lib/harness/robin lib/harness/kimi

# 2. Update class name: RobinHarness → KimiHarness
# 3. Create REAL robin with Vercel SDK
mkdir lib/harness/robin
# Write new RobinHarness using ai package

# 4. Install dependencies
npm install ai @ai-sdk/openai @ai-sdk/anthropic
```

**Result:**
- `lib/harness/kimi/` - KIMI CLI wrapper (extracted Phase 1)
- `lib/harness/robin/` - Vercel SDK (new Phase 2C)

### Option 2: Rewrite in Place

```bash
# 1. Install dependencies
npm install ai @ai-sdk/openai @ai-sdk/anthropic

# 2. Rewrite lib/harness/robin/index.js
# Replace spawn('kimi') with Vercel SDK calls
```

**Result:**
- Loses the extracted KIMI CLI harness
- Robin becomes Vercel SDK based
- No way to compare/test both

## My Recommendation

**Choose Option 1.** Here's why:

1. **Preserves your Phase 1 work** - The extraction wasn't wrong, just misnamed
2. **Enables A/B testing** - Can compare KIMI CLI vs Robin (Vercel)
3. **Clear separation** - Each harness does ONE thing well
4. **Future flexibility** - Can add more SDK-based harnesses later

## Files Affected

| File | Current | Should Be |
|------|---------|-----------|
| `lib/harness/robin/` | KIMI CLI wrapper | **Rename to `kimi/`** |
| `lib/harness/robin/` | Doesn't exist | **Create new with Vercel SDK** |
| `package.json` | No AI SDK | **Add `ai`, `@ai-sdk/*`** |
| Phase 1 spec | Says "Robin" | **Should say "Kimi"** |
| Phase 2B spec | Mixed up | **Robin = Vercel, KIMI = CLI** |

## Next Steps

1. **Decide:** Option 1 or Option 2?
2. **Execute:** Rename files or rewrite?
3. **Install:** `npm install ai @ai-sdk/openai`
4. **Implement:** Real Robin harness with API calls
5. **Test:** Verify Robin calls OpenAI, not KIMI

## Documents Updated

- `PHASE-1-KIMI-HARNESS-SPEC.md` - Now reflects KIMI extraction
- `PHASE-2-COMPATIBILITY-LAYER-SPEC.md` - Notes misnaming
- `PHASE-2B-HARNESS-SELECTOR-UI-SPEC.md` - Robin = Vercel SDK
- `PHASE-2C-VERCEL-SDK-INTEGRATION.md` - NEW: How to implement real Robin
- `HARNESS-STATUS-ASSESSMENT.md` - Full analysis of the situation

---

**Bottom line:** The code in `lib/harness/robin/` is NOT what you wanted. It's KIMI CLI with Robin branding. You need to either rename it to `kimi/` and create a new `robin/`, or rewrite it completely.
