const { RobinHarness } = require('./robin');
const { KimiHarness } = require('./kimi');
const { CodexHarness } = require('./clis/codex');
const { GeminiHarness } = require('./clis/gemini');
const { QwenHarness } = require('./clis/qwen');
const { ClaudeCodeHarness } = require('./clis/claude-code');

/**
 * @typedef {import('./types').AIHarness} AIHarness
 * @typedef {Object} HarnessInfo
 * @property {string} id
 * @property {string} name
 * @property {string} provider
 * @property {boolean} installed
 * @property {boolean} builtIn
 * @property {string | null} version
 * @property {string | null} action
 * @property {string | null} installCommand
 * @property {string | null} error
 */

/**
 * Registry for managing all available AI harnesses.
 * 
 * Provides centralized access to harness implementations and
 * dynamic installation status checking for external CLI harnesses.
 */
class HarnessRegistry {
  constructor() {
    /** @type {Map<string, AIHarness>} */
    this.harnesses = new Map();
    /** @type {Map<string, Object>} */
    this.metadata = new Map();
    
    this.registerDefaults();
  }

  /**
   * Register the default harnesses.
   * @private
   */
  registerDefaults() {
    // Built-in harness (always available)
    this.register('robin', new RobinHarness(), {
      builtIn: true,
      description: 'Built-in AI assistant using Vercel AI SDK'
    });

    // External CLI harnesses
    this.register('kimi', new KimiHarness(), {
      builtIn: false,
      description: 'KIMI CLI from Moonshot AI',
      installCommand: 'npm install -g kimi'
    });

    this.register('codex', new CodexHarness(), {
      builtIn: false,
      description: 'OpenAI Codex CLI',
      installCommand: 'npm install -g @openai/codex-acp'
    });

    this.register('gemini', new GeminiHarness(), {
      builtIn: false,
      description: 'Google Gemini CLI with agentic capabilities',
      installCommand: 'npm install -g @google/gemini-cli'
    });

    this.register('qwen', new QwenHarness(), {
      builtIn: false,
      description: 'Alibaba Qwen Code CLI with massive context windows',
      installCommand: 'npm install -g @qwen-code/qwen-code'
    });

    this.register('claude-code', new ClaudeCodeHarness(), {
      builtIn: false,
      description: 'Claude Code CLI from Anthropic',
      installCommand: 'npm install -g @anthropic-ai/claude-code'
    });
  }

  /**
   * Register a harness.
   * 
   * @param {string} id - Harness ID
   * @param {AIHarness} harness - Harness instance
   * @param {Object} [metadata] - Additional metadata
   * @param {boolean} [metadata.builtIn=false] - Whether this is a built-in harness
   * @param {string} [metadata.description] - Description for UI
   * @param {string} [metadata.installCommand] - Command to install this CLI
   */
  register(id, harness, metadata = {}) {
    this.harnesses.set(id, harness);
    this.metadata.set(id, {
      builtIn: false,
      description: '',
      installCommand: null,
      ...metadata
    });
  }

  /**
   * Unregister a harness.
   * @param {string} id
   * @returns {boolean}
   */
  unregister(id) {
    this.metadata.delete(id);
    return this.harnesses.delete(id);
  }

  /**
   * Get a harness by ID.
   * 
   * @param {string} id
   * @returns {AIHarness | undefined}
   */
  get(id) {
    return this.harnesses.get(id);
  }

  /**
   * Get all registered harnesses.
   * @returns {Map<string, AIHarness>}
   */
  getAll() {
    return new Map(this.harnesses);
  }

  /**
   * Get all harness IDs.
   * @returns {string[]}
   */
  getIds() {
    return Array.from(this.harnesses.keys());
  }

  /**
   * Check if a harness is registered.
   * @param {string} id
   * @returns {boolean}
   */
  has(id) {
    return this.harnesses.has(id);
  }

  /**
   * Get metadata for a harness.
   * @param {string} id
   * @returns {Object | undefined}
   */
  getMetadata(id) {
    return this.metadata.get(id);
  }

  /**
   * Get all harnesses with their installation status.
   * 
   * This method checks if each external CLI harness is installed
   * by calling its isInstalled() method.
   * 
   * @returns {Promise<HarnessInfo[]>}
   */
  async getAvailableHarnesses() {
    const results = [];

    for (const [id, harness] of this.harnesses) {
      const meta = this.metadata.get(id) || {};
      
      /** @type {HarnessInfo} */
      const info = {
        id,
        name: harness.name,
        provider: harness.provider,
        installed: meta.builtIn, // Built-ins are always "installed"
        builtIn: meta.builtIn,
        version: null,
        action: null,
        installCommand: meta.installCommand || null,
        error: null
      };

      // For external CLIs, check installation status
      if (!meta.builtIn) {
        try {
          // Check if isInstalled method exists (BaseCLIHarness has it)
          if (typeof harness.isInstalled === 'function') {
            info.installed = await harness.isInstalled();
            
            // If installed, try to get version
            if (info.installed && typeof harness.getVersion === 'function') {
              try {
                info.version = await harness.getVersion();
              } catch (versionErr) {
                // Version check failed but CLI is installed
                info.version = 'unknown';
              }
            }
          } else {
            // Fallback for harnesses without isInstalled
            info.installed = false;
          }

          // Set action based on installation status
          if (!info.installed) {
            info.action = 'install';
          }
        } catch (err) {
          info.installed = false;
          info.error = err instanceof Error ? err.message : String(err);
          info.action = 'install';
        }
      }

      results.push(info);
    }

    return results;
  }

  /**
   * Get a specific harness with installation status.
   * 
   * @param {string} id
   * @returns {Promise<HarnessInfo | null>}
   */
  async getHarnessStatus(id) {
    const harness = this.harnesses.get(id);
    if (!harness) {
      return null;
    }

    const meta = this.metadata.get(id) || {};
    
    /** @type {HarnessInfo} */
    const info = {
      id,
      name: harness.name,
      provider: harness.provider,
      installed: meta.builtIn,
      builtIn: meta.builtIn,
      version: null,
      action: null,
      installCommand: meta.installCommand || null,
      error: null
    };

    if (!meta.builtIn && typeof harness.isInstalled === 'function') {
      try {
        info.installed = await harness.isInstalled();
        
        if (info.installed && typeof harness.getVersion === 'function') {
          try {
            info.version = await harness.getVersion();
          } catch {
            info.version = 'unknown';
          }
        }

        if (!info.installed) {
          info.action = 'install';
        }
      } catch (err) {
        info.installed = false;
        info.error = err instanceof Error ? err.message : String(err);
        info.action = 'install';
      }
    }

    return info;
  }

  /**
   * Initialize a harness with configuration.
   * 
   * @param {string} id - Harness ID
   * @param {import('./types').HarnessConfig} config
   * @returns {Promise<AIHarness>}
   * @throws {Error} If harness not found or initialization fails
   */
  async initializeHarness(id, config) {
    const harness = this.harnesses.get(id);
    if (!harness) {
      throw new Error(`Harness not found: ${id}`);
    }

    await harness.initialize(config);
    return harness;
  }

  /**
   * Dispose all harnesses.
   */
  async disposeAll() {
    for (const [id, harness] of this.harnesses) {
      if (typeof harness.dispose === 'function') {
        try {
          await harness.dispose();
        } catch (err) {
          console.error(`[HarnessRegistry] Error disposing ${id}:`, err);
        }
      }
    }
  }
}

// Singleton instance
const registry = new HarnessRegistry();

module.exports = {
  HarnessRegistry,
  registry
};
