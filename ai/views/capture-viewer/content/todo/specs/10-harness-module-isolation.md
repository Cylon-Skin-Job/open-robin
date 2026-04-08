# SPEC-10: Harness Module Isolation

## SCOPE BOUNDARY — READ THIS FIRST

This spec ensures each CLI harness is a fully self-contained module with no cross-imports between harnesses. It does NOT create a shared base class. It does NOT merge harnesses. It does NOT change harness behavior.

Each harness module must own its complete translation pipeline in both directions:
```
send(canonical) → harness → CLI wire format → CLI process
CLI process → wire output → harness → canonical → controller
```

If two harnesses have identical code today, that's fine — it's **copied, not inherited**. These CLI vendors will diverge. A shared base becomes a liability the moment one vendor changes their protocol.

**If you finish early, stop.**

---

## Problem

One cross-module dependency: Claude Code imports its wire parser from Gemini's directory. If Gemini's parser changes, Claude Code silently breaks.

Additionally, the harness module structure should be verified — each module should own all 5 files (index, wire-parser, event-translator, session-state, tool-mapper) with no cross-imports.

---

## Current State

```
lib/harness/clis/
  base-cli-harness.js     ← shared base class (477 lines) — ALL harnesses extend this
  qwen/
    index.js               (433 lines)
    wire-parser.js          ← QwenAcpWireParser (own copy)
    event-translator.js     ← QwenAcpEventTranslator (own copy)
    session-state.js        ← QwenAcpSessionState
    tool-mapper.js          ← mapQwenToolName
  gemini/
    index.js               (405 lines)
    acp-wire-parser.js      ← AcpWireParser
    acp-event-translator.js ← AcpEventTranslator
    session-state.js        ← GeminiSessionState
    tool-mapper.js          ← mapGeminiToolName
  codex/
    index.js               (391 lines)
    acp-wire-parser.js      ← own copy (stripped version of Gemini's)
    acp-event-translator.js ← CodexEventTranslator
    session-state.js        ← CodexSessionState
    tool-mapper.js          ← mapCodexToolName
  claude-code/
    index.js               (365 lines)
    acp-event-translator.js ← own translator
    session-state.js        ← ClaudeCodeSessionState
    tool-mapper.js          ← mapClaudeCodeToolName
    ❌ NO wire parser — imports from ../gemini/acp-wire-parser
```

---

## Task 1: Give Claude Code Its Own Wire Parser

**The fix:** Copy `gemini/acp-wire-parser.js` to `claude-code/acp-wire-parser.js`. Update the import in `claude-code/index.js`.

### Step 1: Copy the file
```
cp lib/harness/clis/gemini/acp-wire-parser.js lib/harness/clis/claude-code/acp-wire-parser.js
```

### Step 2: Update the class name and comment
In the copied file, update the JSDoc comment from "Gemini CLI" to "Claude Code CLI". Keep the class name as `AcpWireParser` — it's generic enough.

### Step 3: Update the import in claude-code/index.js
```js
// Old:
const { AcpWireParser } = require('../gemini/acp-wire-parser');

// New:
const { AcpWireParser } = require('./acp-wire-parser');
```

That's it. One copy, one import change.

---

## Task 2: Verify No Other Cross-Imports

After fixing Claude Code, verify that NO harness module imports from another harness module:

```bash
# Should return ZERO results after the fix
grep -r "require.*\.\./qwen\|require.*\.\./gemini\|require.*\.\./codex\|require.*\.\./claude-code" lib/harness/clis/*/
```

**Allowed imports:**
- `require('../base-cli-harness')` — all harnesses extend the shared base (this is the base class contract, not a cross-harness dependency)
- `require('../../../event-bus')` — shared infrastructure
- `require('../../model-catalog')` — shared infrastructure

**NOT allowed:**
- Any import from one harness directory into another

---

## Task 3: Verify Each Module Has All 5 Files

Each harness directory should contain:

| File | Purpose |
|------|---------|
| `index.js` | Main harness class (extends BaseCLIHarness) |
| `*wire-parser.js` | JSON-RPC line parsing → message objects |
| `*event-translator.js` | Wire messages → canonical events |
| `session-state.js` | Per-thread state tracking |
| `tool-mapper.js` | CLI tool names → canonical tool names |

List the contents of each directory and confirm all 5 are present. If any are missing, flag it in the report but do NOT create stub files.

---

## What NOT to Do

- Do not create a shared ACP base class
- Do not merge any harness modules
- Do not extract shared utility functions
- Do not change harness behavior
- Do not modify base-cli-harness.js
- Do not touch the registry, compat layer, or feature flags
- Do not "improve" any harness code
- Do not standardize file naming across harnesses (qwen uses `wire-parser.js`, others use `acp-wire-parser.js` — leave it)

---

## Verification

1. `grep -r "require.*\.\./qwen\|require.*\.\./gemini\|require.*\.\./codex\|require.*\.\./claude-code" lib/harness/clis/*/` returns zero results
2. `claude-code/acp-wire-parser.js` exists and is imported by `claude-code/index.js`
3. Each of the 4 harness directories has all 5 files (or documents which are missing)
4. Server starts without errors: `node server.js`

---

## Silent Fail Risks

| Risk | What Breaks | Symptom |
|------|-------------|---------|
| Claude Code still imports Gemini parser | Gemini parser change breaks Claude Code | Claude Code harness silently fails to parse |
| Copied parser missing a method | Claude Code can't parse messages | No events emitted, chat appears dead |
