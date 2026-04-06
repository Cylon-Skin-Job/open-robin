/**
 * Public API for the AI Harness system.
 *
 * This is the main entry point for harness functionality.
 * All other modules should import from here.
 *
 * @see ../specs/PHASE-2-COMPATIBILITY-LAYER-SPEC.md
 */

// ============================================================================
// Types (JSDoc exports for IDE support)
// ============================================================================

/**
 * @typedef {import('./types').CanonicalEvent} CanonicalEvent
 * @typedef {import('./types').CanonicalEventType} CanonicalEventType
 * @typedef {import('./types').TurnBeginEvent} TurnBeginEvent
 * @typedef {import('./types').ContentEvent} ContentEvent
 * @typedef {import('./types').ThinkingEvent} ThinkingEvent
 * @typedef {import('./types').ToolCallEvent} ToolCallEvent
 * @typedef {import('./types').ToolCallArgsEvent} ToolCallArgsEvent
 * @typedef {import('./types').ToolResultEvent} ToolResultEvent
 * @typedef {import('./types').TurnEndEvent} TurnEndEvent
 * @typedef {import('./types').SendOptions} SendOptions
 * @typedef {import('./types').ChatMessage} ChatMessage
 * @typedef {import('./types').TokenUsage} TokenUsage
 * @typedef {import('./types').HarnessConfig} HarnessConfig
 * @typedef {import('./types').HarnessSession} HarnessSession
 * @typedef {import('./types').AIHarness} AIHarness
 * @typedef {import('./feature-flags').HarnessMode} HarnessMode
 */

// ============================================================================
// Feature Flags
// ============================================================================

const {
  getHarnessMode,
  setThreadMode,
  clearThreadMode,
  setGlobalMode,
  shouldUseNewHarness,
  isParallelMode,
  getFlagStatus,
  resetOverrides,
  HARNESS_OPTIONS
} = require('./feature-flags');

// ============================================================================
// Compatibility Layer
// ============================================================================

const {
  spawnThreadWire,
  sendToThread,
  getModeStatus,
  emergencyRollback,
  isNewHarnessEnabled,
  getParallelResults,
  clearParallelResults
} = require('./compat');

// ============================================================================
// Registry
// ============================================================================

const { HarnessRegistry, registry } = require('./registry');

// ============================================================================
// Harness Implementations
// ============================================================================

const { RobinHarness } = require('./robin');
const { KimiHarness } = require('./kimi');
const { CodexHarness } = require('./clis/codex');
const { BaseCLIHarness } = require('./clis/base-cli-harness');

// ============================================================================
// Utilities
// ============================================================================

const {
  mapRobinToolName,
  isRobinTool
} = require('./kimi/tool-mapper');

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  // Types (exported as JSDoc comments above)

  // Feature flags
  getHarnessMode,
  setThreadMode,
  clearThreadMode,
  setGlobalMode,
  shouldUseNewHarness,
  isParallelMode,
  getFlagStatus,
  resetOverrides,
  HARNESS_OPTIONS,

  // Compatibility layer
  spawnThreadWire,
  sendToThread,
  getModeStatus,
  emergencyRollback,
  isNewHarnessEnabled,
  getParallelResults,
  clearParallelResults,

  // Harness implementations
  RobinHarness,
  KimiHarness,
  CodexHarness,
  BaseCLIHarness,

  // Registry
  HarnessRegistry,
  registry,

  // Utilities
  mapRobinToolName,
  isRobinTool
};
