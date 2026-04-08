# Correction Spec: Fixing the Harness Architecture

**Status:** Required before proceeding  
**Problem:** `RobinHarness` was incorrectly implemented as a KIMI CLI wrapper  
**Solution:** Rename current to `KimiHarness`, create real `RobinHarness` with Vercel SDK

---

## What Went Wrong

### Phase 1 Misnaming

The extraction of inline KIMI CLI handling from `server.js` was correctly implemented, but **misnamed**:

| What Was Done | What Should Have Been |
|---------------|----------------------|
| Created `lib/harness/robin/` | Should be `lib/harness/kimi/` |
| Named class `RobinHarness` | Should be `KimiHarness` |
| Spawned `kimi` CLI process | Correct behavior, wrong name |

### The Confusion

**Robin** was intended to be:
- The **built-in default** harness
- Uses Vercel AI SDK (not a CLI subprocess)
- Supports BYOK (bring your own API keys)
- Supports local models (Ollama, etc.)

**KIMI CLI** is:
- An **external** harness users download
- Spawns `kimi` subprocess with wire protocol
- One of many external CLI options

---

## Correction Steps

### Step 1: Rename Current Implementation

```bash
# Rename directory
mv lib/harness/robin lib/harness/kimi

# Update all internal references
```

**In `lib/harness/kimi/index.js`:**
```javascript
// Change:
class RobinHarness extends EventEmitter {
  constructor() {
    super();
    this.id = 'robin';        // → 'kimi'
    this.name = 'Robin CLI';  // → 'KIMI CLI'
    this.provider = 'kimi';   // ✓ keep
```

**In `lib/harness/kimi/session-state.js`:**
```javascript
// Change:
class RobinSessionState {    // → KimiSessionState
```

**In `lib/harness/index.js`:**
```javascript
// Change:
export { RobinHarness } from './robin';  // → from './kimi'
export { KimiHarness } from './kimi';    // add this
```

**In `lib/harness/compat.js`:**
```javascript
// Change:
const { RobinHarness } = require('./robin');  // → require('./kimi')
const { KimiHarness } = require('./kimi');

// Update all references:
// robinHarness → kimiHarness
// getHarness() → getKimiHarness()
```

**In `lib/harness/feature-flags.js`:**
```javascript
// Update harness modes:
const HARNESS_OPTIONS = [
  { id: 'robin', name: 'Robin', provider: 'vercel-sdk' },  // new
  { id: 'kimi', name: 'KIMI CLI', provider: 'kimi' },       // renamed
];
```

### Step 2: Install Vercel AI SDK Dependencies

```bash
cd kimi-ide-server
npm install ai @ai-sdk/openai @ai-sdk/anthropic
```

### Step 3: Create Real RobinHarness

**New file: `lib/harness/robin/index.js`**

```javascript
const { EventEmitter } = require('events');
const { streamText, tool } = require('ai');

/**
 * Robin Harness - Built-in Vercel AI SDK implementation
 * 
 * This is the DEFAULT harness. It:
 * - Uses Vercel AI SDK for API calls
 * - Supports BYOK (OpenAI, Anthropic, etc.)
 * - Supports local models (Ollama)
 * - Does NOT spawn external CLI processes
 */
class RobinHarness extends EventEmitter {
  constructor() {
    super();
    this.id = 'robin';
    this.name = 'Robin';
    this.provider = 'vercel-sdk';
    this.config = {};
    this.sessions = new Map();
  }

  async initialize(config = {}) {
    this.config = {
      // Default to OpenAI if configured, else local
      provider: config.provider || process.env.ROBIN_PROVIDER || 'openai',
      model: config.model || process.env.ROBIN_MODEL || 'gpt-4o-mini',
      apiKey: config.apiKey || process.env.OPENAI_API_KEY,
      baseUrl: config.baseUrl || process.env.ROBIN_BASE_URL,
      ...config
    };
    console.log('[RobinHarness] Initialized with provider:', this.config.provider);
  }

  async startThread(threadId, projectRoot) {
    const session = {
      threadId,
      projectRoot,
      messages: [],
      config: { ...this.config }
    };
    
    this.sessions.set(threadId, session);
    
    return {
      threadId,
      sendMessage: (message, options) => this.sendMessage(threadId, message, options),
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

    // Build messages array
    const messages = [
      { role: 'system', content: this.getSystemPrompt() },
      ...session.messages,
      { role: 'user', content: message }
    ];

    // Emit turn begin
    yield {
      type: 'turn_begin',
      timestamp: Date.now(),
      turnId: `turn-${threadId}-${Date.now()}`,
      userInput: message
    };

    // Get the model
    const model = await this.getModel(session.config);

    // Stream the response
    try {
      const result = await streamText({
        model,
        messages,
        tools: this.getTools(),
        maxSteps: 10,
        onStepFinish: (step) => {
          this.emit('step', { threadId, step });
        }
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

      // Handle tool calls
      if (result.toolCalls && result.toolCalls.length > 0) {
        hasToolCalls = true;
        for (const tc of result.toolCalls) {
          yield {
            type: 'tool_call',
            timestamp: Date.now(),
            toolCallId: tc.toolCallId,
            toolName: tc.toolName
          };

          yield {
            type: 'tool_call_args',
            timestamp: Date.now(),
            toolCallId: tc.toolCallId,
            argsChunk: JSON.stringify(tc.args)
          };

          // Note: Tool execution happens client-side
          // Client sends tool_result back via WebSocket
        }
      }

      // Update session history
      session.messages.push({ role: 'user', content: message });
      session.messages.push({ role: 'assistant', content: fullText });

      // Emit turn end
      yield {
        type: 'turn_end',
        timestamp: Date.now(),
        turnId: `turn-${threadId}-${Date.now()}`,
        fullText,
        hasToolCalls,
        _meta: {
          harnessId: 'robin',
          provider: session.config.provider,
          model: session.config.model,
          tokenUsage: result.usage
        }
      };

    } catch (error) {
      console.error('[RobinHarness] Stream error:', error);
      yield {
        type: 'turn_end',
        timestamp: Date.now(),
        turnId: `turn-${threadId}-${Date.now()}`,
        fullText: `Error: ${error.message}`,
        hasToolCalls: false,
        _meta: { error: error.message }
      };
    }
  }

  async getModel(config) {
    const { createOpenAI } = await import('@ai-sdk/openai');
    const { createAnthropic } = await import('@ai-sdk/anthropic');
    
    switch (config.provider) {
      case 'openai':
        return createOpenAI({ apiKey: config.apiKey })(config.model);
      
      case 'anthropic':
        return createAnthropic({ apiKey: config.apiKey })(config.model);
      
      case 'ollama':
        // Ollama uses OpenAI-compatible API
        return createOpenAI({
          baseURL: config.baseUrl || 'http://localhost:11434/v1',
          apiKey: 'ollama' // Ollama doesn't need real key
        })(config.model);
      
      default:
        throw new Error(`Unknown provider: ${config.provider}`);
    }
  }

  getSystemPrompt() {
    return `You are Robin, a helpful AI assistant. You help users with coding tasks, file operations, and general questions.`;
  }

  getTools() {
    // Tools are handled client-side for now
    // In future, could validate tool calls here
    return {};
  }

  async dispose() {
    this.sessions.clear();
  }
}

module.exports = { RobinHarness };
```

### Step 4: Update Harness Registry

**In `lib/harness/index.js`:**

```javascript
/**
 * Public API for the AI Harness system
 */

// Types
module.exports = {
  // Core harnesses
  RobinHarness: require('./robin').RobinHarness,  // NEW: Vercel SDK
  KimiHarness: require('./kimi').KimiHarness,      // RENAMED: was RobinHarness
  
  // Utilities
  ...require('./feature-flags'),
  ...require('./compat')
};
```

### Step 5: Update UI Options

**In frontend config:**

```typescript
const HARNESS_OPTIONS = [
  {
    id: 'robin',
    name: 'Robin',
    description: 'Built-in AI assistant (Vercel SDK)',
    icon: '🔷',
    details: {
      provider: 'vercel-sdk',
      model: 'gpt-4o-mini / configurable',
      features: ['tools', 'streaming', 'thinking']
    },
    enabled: true,
    recommended: true  // Default
  },
  {
    id: 'kimi',
    name: 'KIMI CLI',
    description: 'External KIMI CLI tool',
    icon: '🤖',
    details: {
      provider: 'kimi',
      model: 'k1.6',
      features: ['tools', 'streaming', 'thinking', 'plan_mode']
    },
    enabled: true
  }
];

export const DEFAULT_HARNESS = 'robin';
```

### Step 6: Environment Configuration

**.env.example:**
```bash
# Robin (Built-in Vercel AI SDK) - DEFAULT
ROBIN_PROVIDER=openai
ROBIN_MODEL=gpt-4o-mini
OPENAI_API_KEY=sk-...

# Alternative: Anthropic
# ROBIN_PROVIDER=anthropic
# ROBIN_MODEL=claude-3-haiku-20240307
# ANTHROPIC_API_KEY=sk-ant-...

# Alternative: Local Ollama
# ROBIN_PROVIDER=ollama
# ROBIN_MODEL=llama3.1
# ROBIN_BASE_URL=http://localhost:11434/v1

# KIMI CLI (External - optional)
KIMI_PATH=kimi
```

---

## Post-Correction Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    HARNESS MANAGER                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   Robin      │  │    KIMI      │  │  Future: Codex,  │  │
│  │  (Default)   │  │    (CLI)     │  │  Gemini, etc.    │  │
│  ├──────────────┤  ├──────────────┤  ├──────────────────┤  │
│  │ Vercel SDK   │  │ Subprocess   │  │ Subprocess       │  │
│  │ API calls    │  │ kimi --wire  │  │ External CLIs    │  │
│  │ Built-in     │  │ Downloadable │  │ Downloadable     │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Verification Checklist

- [ ] `lib/harness/kimi/` exists (renamed from robin/)
- [ ] `lib/harness/robin/` exists (new Vercel SDK implementation)
- [ ] `npm install ai @ai-sdk/openai` completed
- [ ] `KimiHarness` class works (spawns kimi CLI)
- [ ] `RobinHarness` class works (uses Vercel SDK, no subprocess)
- [ ] Default harness is 'robin'
- [ ] Robin uses "Robin" identity in system prompts
- [ ] UI shows Robin first, KIMI CLI second

---

## Next Phases (After Correction)

| Phase | Work |
|-------|------|
| **Phase 3** | Add more external CLI harnesses (Codex, Gemini, etc.) |
| **Phase 4** | Provider configuration UI (API keys, model selection) |
| **Phase 5** | Local model support (Ollama integration) |
| **Phase 6** | Advanced features (multi-model, fallback, etc.) |

---

*This correction must be completed before proceeding with additional harness implementations.*
