# Phase 3: External CLI Harnesses

**Status:** Draft  
**Version:** 1.0  
**Prerequisites:** CORRECTION-SPEC complete (Robin = Vercel SDK, KIMI = CLI)  
**Goal:** Add support for external AI CLI tools (Codex, Gemini, OpenCode, Qwen, etc.)

---

## Overview

Phase 3 extends the harness system to support multiple external CLI tools beyond KIMI. Users can install any supported CLI and select it as their AI backend, while Robin remains the built-in default.

### Supported External CLIs

| CLI | Provider | Status | Installation |
|-----|----------|--------|--------------|
| **KIMI** | Moonshot AI | ✅ Phase 1 | `npm install -g kimi` |
| **Codex** | OpenAI | 🆕 Phase 3 | `npm install -g @openai/codex` |
| **Gemini CLI** | Google | 🆕 Phase 3 | `npm install -g @google/gemini-cli` |
| **OpenCode** | (Open Source) | 🆕 Phase 3 | `npm install -g opencode` |
| **Qwen CLI** | Alibaba | 🆕 Phase 3 | `npm install -g @qwen/cli` |
| **Claude Code** | Anthropic | 🆕 Phase 3 | `npm install -g @anthropic/claude-code` |
| **Aider** | (Open Source) | 🆕 Phase 3 | `pip install aider-chat` |

---

## Architecture

### Harness Types

```
┌─────────────────────────────────────────────────────────────────┐
│                      HARNESS MANAGER                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐  ┌─────────────────────────────────────┐  │
│  │    BUILT-IN     │  │         EXTERNAL CLI HARNESSES      │  │
│  │                 │  │                                     │  │
│  │  ┌───────────┐  │  │  ┌────────┐ ┌────────┐ ┌────────┐  │  │
│  │  │   Robin   │  │  │  │  KIMI  │ │ Codex  │ │Gemini  │  │  │
│  │  │  Vercel   │  │  │  │  CLI   │ │  CLI   │ │  CLI   │  │  │
│  │  │   SDK     │  │  │  └────────┘ └────────┘ └────────┘  │  │
│  │  │  (Default)│  │  │  ┌────────┐ ┌────────┐ ┌────────┐  │  │
│  │  └───────────┘  │  │  │OpenCode│ │Qwen CLI│ │ Aider  │  │  │
│  │                 │  │  │  CLI   │ │  CLI   │ │  CLI   │  │  │
│  │  Always         │  │  └────────┘ └────────┘ └────────┘  │  │
│  │  Available      │  │                                     │  │
│  └─────────────────┘  │      User Installs as Needed        │  │
│                       └─────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### File Structure

```
lib/harness/
├── index.js                    # Harness registry & exports
├── types.js                    # Shared type definitions
├── feature-flags.js            # Harness selection
├── compat.js                   # Backward compatibility
├── robin/                      # Built-in Vercel SDK harness
│   └── index.js
├── kimi/                       # KIMI CLI harness
│   ├── index.js
│   ├── wire-parser.js
│   ├── event-translator.js
│   └── ...
└── clis/                       # EXTERNAL CLI HARNESSES (Phase 3)
    ├── codex/
    │   ├── index.js            # CodexHarness
│   │   ├── wire-parser.js      # Codex-specific wire protocol
│   │   └── tool-mapper.js      # Codex → canonical tool names
    ├── gemini/
    │   ├── index.js            # GeminiHarness
    │   └── ...
    ├── opencode/
    │   ├── index.js            # OpenCodeHarness
    │   └── ...
    ├── qwen/
    │   ├── index.js            # QwenHarness
    │   └── ...
    ├── claude-code/
    │   ├── index.js            # ClaudeCodeHarness
    │   └── ...
    └── aider/
        ├── index.js            # AiderHarness
        └── ...
```

---

## External CLI Harness Interface

All external CLI harnesses implement the same interface:

```typescript
interface ExternalCLIHarness {
  readonly id: string;           // 'kimi' | 'codex' | 'gemini' | etc.
  readonly name: string;         // Display name
  readonly provider: string;     // Provider ID
  readonly cliName: string;      // CLI binary name
  
  // Check if CLI is installed
  isInstalled(): Promise<boolean>;
  
  // Get CLI version
  getVersion(): Promise<string>;
  
  // Standard harness methods
  initialize(config: HarnessConfig): Promise<void>;
  startThread(threadId: string, projectRoot: string): Promise<HarnessSession>;
  dispose(): Promise<void>;
}
```

---

## Per-CLI Specifications

### 1. Codex (OpenAI)

**CLI:** `@openai/codex`

**Installation:**
```bash
npm install -g @openai/codex
```

**Spawn:**
```javascript
const proc = spawn('codex', [
  '--mode', 'full-auto',  // or 'suggest', 'semi-auto'
  '--model', 'gpt-4o',
  '--approval-mode', 'suggest-when-possible'
], {
  stdio: ['pipe', 'pipe', 'pipe']
});
```

**Wire Protocol:**
- Codex uses a different JSON-RPC format than KIMI
- Events: `message`, `tool_call`, `tool_result`, `done`
- Need custom `CodexWireParser`

**Tool Mapping:**
```javascript
const CODEX_TO_CANONICAL = {
  'readFile': 'read',
  'writeFile': 'write',
  'editFile': 'edit',
  'runCommand': 'shell',
  // ...
};
```

**Files:**
- `lib/harness/clis/codex/index.js`
- `lib/harness/clis/codex/wire-parser.js`
- `lib/harness/clis/codex/tool-mapper.js`

---

### 2. Gemini CLI (Google)

**CLI:** `@google/gemini-cli`

**Installation:**
```bash
npm install -g @google/gemini-cli
```

**Spawn:**
```javascript
const proc = spawn('gemini', [
  'chat',
  '--model', 'gemini-1.5-pro',
  '--format', 'json'  // If supported
], {
  stdio: ['pipe', 'pipe', 'pipe']
});
```

**Notes:**
- Google's CLI may use gRPC or different wire format
- May need to use their Node.js SDK instead of CLI

**Alternative Approach:**
If Gemini CLI doesn't have a wire protocol, implement as SDK wrapper:
```javascript
const { GoogleGenerativeAI } = require('@google/generative-ai');
```

---

### 3. OpenCode

**CLI:** `opencode`

**Installation:**
```bash
npm install -g opencode
```

**Notes:**
- Open-source alternative
- May have similar wire protocol to KIMI
- Need to investigate their protocol format

---

### 4. Qwen CLI

**CLI:** `@qwen/cli`

**Installation:**
```bash
npm install -g @qwen/cli
```

**Spawn:**
```javascript
const proc = spawn('qwen', [
  '--model', 'qwen3-coder',
  '--wire'  // If they have wire mode
], {
  stdio: ['pipe', 'pipe', 'pipe']
});
```

---

### 5. Claude Code (Anthropic)

**CLI:** `@anthropic/claude-code`

**Installation:**
```bash
npm install -g @anthropic/claude-code
```

**Notes:**
- Anthropic's official CLI
- May have different wire protocol
- High priority (Anthropic models are popular)

---

### 6. Aider

**CLI:** `aider` (Python)

**Installation:**
```bash
pip install aider-chat
```

**Spawn:**
```javascript
const proc = spawn('aider', [
  '--model', 'gpt-4o',
  '--no-git',  // Or configure git integration
  '--stream'   // If supported
], {
  stdio: ['pipe', 'pipe', 'pipe']
});
```

**Notes:**
- Python-based, not Node.js
- Different installation path
- May need different process management

---

## Implementation Steps

### Step 1: Create CLI Harness Base Class

**File: `lib/harness/clis/base-cli-harness.js`**

```javascript
const { EventEmitter } = require('events');
const { spawn } = require('child_process');

/**
 * Base class for external CLI harnesses
 */
class BaseCLIHarness extends EventEmitter {
  constructor(options) {
    super();
    this.id = options.id;
    this.name = options.name;
    this.cliName = options.cliName;
    this.cliPath = null;
    this.config = {};
    this.sessions = new Map();
  }

  /**
   * Check if CLI is installed and available
   */
  async isInstalled() {
    return new Promise((resolve) => {
      const proc = spawn(this.cliName, ['--version'], {
        shell: true,
        stdio: 'ignore'
      });
      
      proc.on('error', () => resolve(false));
      proc.on('exit', (code) => resolve(code === 0));
      
      // Timeout after 2 seconds
      setTimeout(() => {
        proc.kill();
        resolve(false);
      }, 2000);
    });
  }

  /**
   * Get CLI version
   */
  async getVersion() {
    return new Promise((resolve, reject) => {
      let output = '';
      const proc = spawn(this.cliName, ['--version'], {
        shell: true
      });
      
      proc.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      proc.on('exit', (code) => {
        if (code === 0) {
          resolve(output.trim());
        } else {
          reject(new Error(`Failed to get version`));
        }
      });
      
      proc.on('error', reject);
    });
  }

  /**
   * Find CLI in PATH or common locations
   */
  async findCLI() {
    // Try which/where
    const which = spawn('which', [this.cliName]);
    // ... implementation
  }

  async initialize(config) {
    this.config = { ...this.config, ...config };
    
    const installed = await this.isInstalled();
    if (!installed) {
      throw new Error(
        `${this.name} CLI (${this.cliName}) is not installed. ` +
        `Install it to use this harness.`
      );
    }
    
    this.cliPath = this.cliName; // Simplified - could be full path
  }

  /**
   * Override in subclass to provide spawn args
   */
  getSpawnArgs(threadId, projectRoot) {
    throw new Error('Subclass must implement getSpawnArgs()');
  }

  async startThread(threadId, projectRoot) {
    const args = this.getSpawnArgs(threadId, projectRoot);
    
    const proc = spawn(this.cliPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: projectRoot
    });

    console.log(`[${this.name}] Spawned ${this.cliPath} (pid: ${proc.pid})`);

    // Set up wire parsing (subclass provides parser)
    const parser = this.createWireParser();
    
    // ... common setup

    return {
      threadId,
      process: proc,
      // ...
    };
  }

  /**
   * Override in subclass to create appropriate wire parser
   */
  createWireParser() {
    throw new Error('Subclass must implement createWireParser()');
  }

  async dispose() {
    for (const [threadId, session] of this.sessions) {
      if (!session.process.killed) {
        session.process.kill('SIGTERM');
      }
    }
    this.sessions.clear();
  }
}

module.exports = { BaseCLIHarness };
```

### Step 2: Implement Codex Harness

**File: `lib/harness/clis/codex/index.js`**

```javascript
const { BaseCLIHarness } = require('../base-cli-harness');
const { CodexWireParser } = require('./wire-parser');
const { CodexToolMapper } = require('./tool-mapper');

class CodexHarness extends BaseCLIHarness {
  constructor() {
    super({
      id: 'codex',
      name: 'Codex (OpenAI)',
      cliName: 'codex'
    });
    this.provider = 'openai';
  }

  getSpawnArgs(threadId, projectRoot) {
    return [
      '--mode', this.config.mode || 'full-auto',
      '--model', this.config.model || 'gpt-4o',
      '--approval-mode', this.config.approvalMode || 'suggest-when-possible',
      '--cwd', projectRoot
    ];
  }

  createWireParser() {
    return new CodexWireParser();
  }

  // Additional Codex-specific methods
}

module.exports = { CodexHarness };
```

### Step 3: Create Harness Registry

**Update: `lib/harness/index.js`**

```javascript
const { RobinHarness } = require('./robin');
const { KimiHarness } = require('./kimi');
const { CodexHarness } = require('./clis/codex');
const { GeminiHarness } = require('./clis/gemini');
const { OpenCodeHarness } = require('./clis/opencode');
const { QwenHarness } = require('./clis/qwen');
const { ClaudeCodeHarness } = require('./clis/claude-code');
const { AiderHarness } = require('./clis/aider');

/**
 * Registry of all available harnesses
 */
class HarnessRegistry {
  constructor() {
    this.harnesses = new Map();
    this.registerDefaults();
  }

  registerDefaults() {
    // Built-in (always available)
    this.register('robin', new RobinHarness());
    
    // External CLIs (check if installed)
    this.register('kimi', new KimiHarness());
    this.register('codex', new CodexHarness());
    this.register('gemini', new GeminiHarness());
    this.register('opencode', new OpenCodeHarness());
    this.register('qwen', new QwenHarness());
    this.register('claude-code', new ClaudeCodeHarness());
    this.register('aider', new AiderHarness());
  }

  register(id, harness) {
    this.harnesses.set(id, harness);
  }

  get(id) {
    return this.harnesses.get(id);
  }

  /**
   * Get all harnesses with installation status
   */
  async getAvailableHarnesses() {
    const results = [];
    
    for (const [id, harness] of this.harnesses) {
      try {
        const installed = await harness.isInstalled();
        results.push({
          id,
          name: harness.name,
          installed,
          builtIn: id === 'robin'  // Robin is always available
        });
      } catch (err) {
        results.push({
          id,
          name: harness.name,
          installed: false,
          error: err.message
        });
      }
    }
    
    return results;
  }
}

// Singleton instance
const registry = new HarnessRegistry();

module.exports = {
  registry,
  RobinHarness,
  KimiHarness,
  CodexHarness,
  GeminiHarness,
  OpenCodeHarness,
  QwenHarness,
  ClaudeCodeHarness,
  AiderHarness
};
```

### Step 4: UI Integration

**Update harness selector to show installation status:**

```typescript
// Frontend: Fetch available harnesses
async function getAvailableHarnesses() {
  const response = await fetch('/api/harnesses');
  const harnesses = await response.json();
  
  return harnesses.map(h => ({
    id: h.id,
    name: h.name,
    enabled: h.installed || h.builtIn,
    installed: h.installed,
    builtIn: h.builtIn,
    action: !h.installed && !h.builtIn ? 'install' : null
  }));
}
```

**UI States:**

| Harness | State | Action |
|---------|-------|--------|
| Robin | Available | Select (default) |
| KIMI | Installed | Select |
| KIMI | Not Installed | Show "Install" button |
| Codex | Installed | Select |
| Codex | Not Installed | Show "Install" button |

---

## Priority Order

### High Priority (Implement First)

1. **Codex** - OpenAI's official CLI, widely used
2. **Claude Code** - Anthropic's official CLI, popular

### Medium Priority

3. **Gemini CLI** - Google's official CLI
4. **Aider** - Popular open-source option

### Lower Priority

5. **OpenCode** - Newer, less adoption
6. **Qwen CLI** - Alibaba, less common outside China

---

## Installation Flow

When user selects a harness that's not installed:

```
User selects Codex (not installed)
         ↓
Show: "Codex CLI is not installed"
         ↓
Show install command:
   npm install -g @openai/codex
         ↓
[Copy Command] [I've Installed It]
         ↓
Verify: Check if 'codex' is in PATH
         ↓
Success: Enable selection
```

---

## Configuration

Each CLI harness has its own config:

```json
{
  "harnesses": {
    "robin": {
      "provider": "openai",
      "model": "gpt-4o-mini"
    },
    "kimi": {
      "cliPath": "kimi"
    },
    "codex": {
      "cliPath": "codex",
      "mode": "full-auto",
      "model": "gpt-4o",
      "approvalMode": "suggest-when-possible"
    },
    "claude-code": {
      "cliPath": "claude-code"
    }
  }
}
```

---

## Testing Strategy

### Unit Tests
- Test each CLI harness `isInstalled()` method
- Test wire parser for each protocol format
- Test tool name mapping

### Integration Tests
- Spawn each CLI and verify wire protocol
- Test full conversation flow
- Verify tool calls work correctly

### Manual Testing
- Install each CLI
- Create thread with each harness
- Verify basic chat works
- Verify tool execution works

---

## Rollout Plan

| Week | Work |
|------|------|
| Week 1 | Create base CLI harness class, implement Codex |
| Week 2 | Implement Claude Code, Gemini |
| Week 3 | Implement Aider, OpenCode, Qwen |
| Week 4 | UI integration, installation flow, testing |

---

## Success Criteria

- [ ] Codex harness works end-to-end
- [ ] Claude Code harness works end-to-end
- [ ] User can switch between Robin/Codex/Claude in UI
- [ ] Installation status shown for each CLI
- [ ] Clear error messages when CLI not installed
- [ ] Configuration per harness works
- [ ] All harnesses use canonical event format

---

*Phase 3 builds on the corrected architecture where Robin is the built-in Vercel SDK harness.*
