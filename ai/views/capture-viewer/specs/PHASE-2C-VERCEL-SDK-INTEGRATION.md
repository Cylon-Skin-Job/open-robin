# Phase 2C: Vercel AI SDK Integration for Robin

**Status:** Required to complete Robin harness  
**Prerequisites:** Phase 1 extraction complete (but misnamed as Robin)  
**Goal:** Make Robin harness actually use Vercel AI SDK instead of KIMI CLI

---

## The Situation

Phase 1 extracted KIMI CLI handling into `lib/harness/robin/`, but it still spawns `kimi --wire --yolo`. The "Robin" harness is just KIMI CLI with a different name.

**This phase fixes that.**

---

## Two Options

### Option A: Rename + Create New (Recommended)

1. Move `lib/harness/robin/` → `lib/harness/kimi/` (preserves Phase 1 work)
2. Create new `lib/harness/robin/` with Vercel AI SDK
3. Both harnesses coexist

### Option B: Rewrite in Place

1. Keep `lib/harness/robin/` location
2. Replace contents with Vercel SDK implementation
3. Lose the extracted KIMI CLI harness (or keep it elsewhere)

**Recommendation: Option A** - preserves Phase 1 work, enables comparison/testing

---

## Option A Implementation Plan

### Step 1: Rename Current "Robin" to "Kimi"

```bash
# Rename directory
mv lib/harness/robin lib/harness/kimi

# Update class name in lib/harness/kimi/index.js
# RobinHarness → KimiHarness
# id: 'robin' → id: 'kimi'
# name: 'Robin CLI' → name: 'KIMI CLI'
```

Update all imports:
- `lib/harness/compat.js` - change `require('./robin')` to `require('./kimi')`
- `lib/harness/index.js` - export KimiHarness instead of RobinHarness

### Step 2: Install Vercel AI SDK

```bash
cd kimi-ide-server
npm install ai @ai-sdk/openai @ai-sdk/anthropic
```

**package.json additions:**
```json
{
  "dependencies": {
    "ai": "^4.0.0",
    "@ai-sdk/openai": "^1.0.0",
    "@ai-sdk/anthropic": "^1.0.0"
  }
}
```

### Step 3: Create Real Robin Harness

**lib/harness/robin/index.js:**

```javascript
const { streamText, tool } = require('ai');
const { openai } = require('@ai-sdk/openai');
const { anthropic } = require('@ai-sdk/anthropic');

/**
 * Robin Harness - Vercel AI SDK implementation
 * 
 * BYOK (Bring Your Own Key) harness supporting:
 * - OpenAI (GPT-4, GPT-4o, etc.)
 * - Anthropic (Claude 3, etc.)
 * - Ollama (local models)
 * 
 * No KIMI CLI involved - pure API calls.
 */
class RobinHarness {
  constructor() {
    this.id = 'robin';
    this.name = 'Robin';
    this.provider = 'byok';
    this.config = {};
    this.sessions = new Map();
  }

  async initialize(config) {
    this.config = { 
      provider: 'openai',  // default
      model: 'gpt-4o',
      apiKey: process.env.OPENAI_API_KEY,
      ...config 
    };
  }

  async startThread(threadId, projectRoot) {
    // Store session config
    const session = {
      threadId,
      projectRoot,
      messages: [],
      config: { ...this.config }
    };
    
    this.sessions.set(threadId, session);
    
    return {
      threadId,
      sendMessage: this.sendMessage.bind(this, threadId),
      stop: async () => {
        this.sessions.delete(threadId);
      }
    };
  }

  async *sendMessage(threadId, message, options = {}) {
    const session = this.sessions.get(threadId);
    if (!session) {
      throw new Error(`No session for thread ${threadId}`);
    }

    // Add user message to history
    session.messages.push({ role: 'user', content: message });

    // Yield turn begin
    yield {
      type: 'turn_begin',
      timestamp: Date.now(),
      turnId: `turn-${Date.now()}`,
      userInput: message
    };

    // Get model provider
    const model = this.getModel(session.config);

    // Stream response
    const result = await streamText({
      model,
      messages: [
        { role: 'system', content: this.getSystemPrompt() },
        ...session.messages
      ],
      tools: this.getTools(),
      maxSteps: 10
    });

    let fullText = '';
    let hasToolCalls = false;

    // Stream text chunks
    for await (const chunk of result.textStream) {
      fullText += chunk;
      yield {
        type: 'content',
        timestamp: Date.now(),
        text: chunk
      };
    }

    // Handle tool calls if any
    if (result.toolCalls) {
      hasToolCalls = true;
      for (const toolCall of result.toolCalls) {
        yield {
          type: 'tool_call',
          timestamp: Date.now(),
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName
        };

        yield {
          type: 'tool_call_args',
          timestamp: Date.now(),
          toolCallId: toolCall.toolCallId,
          argsChunk: JSON.stringify(toolCall.args)
        };

        // Tool execution happens client-side
        // Wait for tool_result from client
      }
    }

    // Add assistant response to history
    session.messages.push({ role: 'assistant', content: fullText });

    // Yield turn end
    yield {
      type: 'turn_end',
      timestamp: Date.now(),
      turnId: `turn-${Date.now()}`,
      fullText,
      hasToolCalls,
      _meta: {
        harnessId: 'robin',
        provider: session.config.provider,
        model: session.config.model,
        tokenUsage: result.usage
      }
    };
  }

  getModel(config) {
    switch (config.provider) {
      case 'openai':
        return openai(config.model);
      case 'anthropic':
        return anthropic(config.model);
      default:
        throw new Error(`Unknown provider: ${config.provider}`);
    }
  }

  getSystemPrompt() {
    return `You are Robin, a helpful AI assistant.`;
  }

  getTools() {
    // Define tools that Robin can use
    return {
      read_file: tool({
        description: 'Read a file from the filesystem',
        parameters: {
          type: 'object',
          properties: {
            file_path: { type: 'string' }
          },
          required: ['file_path']
        }
      }),
      // ... other tools
    };
  }

  async dispose() {
    this.sessions.clear();
  }
}

module.exports = { RobinHarness };
```

### Step 4: Update Feature Flags

**lib/harness/feature-flags.js:**

```javascript
// Add provider selection
const HARNESS_OPTIONS = [
  {
    id: 'robin',
    name: 'Robin (Vercel AI SDK)',
    description: 'BYOK: OpenAI, Anthropic, etc.',
    provider: 'byok',
    recommended: true
  },
  {
    id: 'kimi',
    name: 'KIMI CLI',
    description: 'Local KIMI CLI tool',
    provider: 'kimi'
  }
];
```

### Step 5: Update Compat Layer

**lib/harness/compat.js:**

```javascript
const { KimiHarness } = require('./kimi');
const { RobinHarness } = require('./robin');

// Two different harnesses
let kimiHarness = null;
let robinHarness = null;

function getHarness(harnessId) {
  if (harnessId === 'kimi') {
    if (!kimiHarness) {
      kimiHarness = new KimiHarness();
      kimiHarness.initialize({});
    }
    return kimiHarness;
  }
  
  if (harnessId === 'robin') {
    if (!robinHarness) {
      robinHarness = new RobinHarness();
      robinHarness.initialize({
        provider: process.env.ROBIN_PROVIDER || 'openai',
        model: process.env.ROBIN_MODEL || 'gpt-4o',
        apiKey: process.env.OPENAI_API_KEY
      });
    }
    return robinHarness;
  }
}
```

### Step 6: Environment Configuration

**.env.example:**
```bash
# Robin (Vercel AI SDK) Configuration
ROBIN_PROVIDER=openai
ROBIN_MODEL=gpt-4o
OPENAI_API_KEY=sk-...

# Or Anthropic
# ROBIN_PROVIDER=anthropic
# ROBIN_MODEL=claude-3-sonnet-20240229
# ANTHROPIC_API_KEY=sk-ant-...

# KIMI CLI (Legacy)
KIMI_PATH=kimi
```

---

## Key Differences After Fix

| Feature | Kimi Harness | Robin Harness |
|---------|-------------|---------------|
| **Process** | Spawns `kimi` CLI | Uses Vercel SDK |
| **Protocol** | JSON-RPC wire | Direct API calls |
| **Models** | k1.6 only | OpenAI, Anthropic, etc. |
| **API Key** | None (local) | User provides (BYOK) |
| **Streaming** | Wire chunks | SDK textStream |
| **Tools** | CLI executes | Client executes |
| **Identity** | "Kimi" | "Robin" |

---

## Verification Checklist

- [ ] `npm install ai @ai-sdk/openai` succeeds
- [ ] `lib/harness/kimi/` exists (renamed from robin)
- [ ] `lib/harness/robin/` exists (new Vercel SDK implementation)
- [ ] Robin harness calls OpenAI API directly (no `kimi` process)
- [ ] Feature flags can switch between kimi/robin per-thread
- [ ] UI selector shows both options
- [ ] Robin uses "Robin" system prompt identity
- [ ] Kimi uses existing KIMI behavior

---

## Migration Path

1. **Week 1:** Rename robin→kimi, install Vercel SDK, create new robin
2. **Week 2:** Test Robin harness with OpenAI
3. **Week 3:** Add Anthropic support
4. **Week 4:** UI selector integration, make Robin default

---

*This document corrects the misunderstanding in earlier specs.*
