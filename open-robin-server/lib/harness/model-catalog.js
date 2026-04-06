/**
 * Model Catalog — context window sizes for all supported CLI models.
 *
 * Used to calculate context usage percentage when the CLI doesn't
 * report it natively (only KIMI provides context_usage directly).
 *
 * Sources (verified April 2026):
 *   KIMI:        https://platform.moonshot.ai/docs/guide/kimi-k2-5-quickstart
 *   Qwen:        https://huggingface.co/Qwen/Qwen3-Coder-480B-A35B-Instruct
 *   Claude:      https://platform.claude.com/docs/en/about-claude/models/overview
 *   Gemini:      https://ai.google.dev/gemini-api/docs/models
 *   Codex:       https://developers.openai.com/codex/models
 *
 * Format: harnessId → { modelPattern → maxContext }
 * Model patterns are matched with startsWith() so partial matches work
 * (e.g. 'gemini-2.5' matches 'gemini-2.5-pro-preview-0506').
 */

const MODEL_CATALOG = {
  kimi: {
    'k2.5':               256_000,
    'k2':                 256_000,
    'kimi-k2':            256_000,
  },

  'claude-code': {
    'claude-opus-4-6':    1_000_000,
    'claude-sonnet-4-6':  1_000_000,
    'claude-haiku-4-5':     200_000,
    'claude-sonnet-4-5':    200_000,
    'claude-opus-4-5':      200_000,
    'claude-sonnet-4':      200_000,
    'claude-opus-4':        200_000,
  },

  qwen: {
    'qwen3-coder':          262_144,
    'qwen2.5-coder':        131_072,
  },

  gemini: {
    'gemini-3':           1_048_576,
    'gemini-2.5':         1_048_576,
    'gemini-2.0':         1_048_576,
  },

  codex: {
    'gpt-5.4-mini':         400_000,
    'gpt-5.4':              272_000,
    'gpt-5.3-codex-spark':  128_000,
    'gpt-5.3-codex':        128_000,
    'gpt-5.2-codex':        128_000,
    'codex-mini':           256_000,
    'codex-1':              192_000,
    'o4-mini':              256_000,
    'o3':                   256_000,
    'gpt-4o':               128_000,
    'gpt-4.1':            1_000_000,
  },

  robin: {
    // Robin uses Vercel AI SDK — model depends on provider config
    // Defaults to KIMI k2.5 context window
    'default':              256_000,
  },
};

/**
 * Look up the max context window for a harness + model combination.
 *
 * @param {string} harnessId - e.g. 'kimi', 'claude-code', 'qwen', 'gemini', 'codex'
 * @param {string} modelId   - e.g. 'claude-opus-4-6', 'gemini-2.5-pro', 'qwen3-coder-480b'
 * @returns {number|null}    - max context in tokens, or null if unknown
 */
function getMaxContext(harnessId, modelId) {
  const models = MODEL_CATALOG[harnessId];
  if (!models) return null;
  if (!modelId) return null;

  const id = modelId.toLowerCase();

  // Try exact match first
  if (models[id] !== undefined) return models[id];

  // Try prefix match (longest prefix wins)
  let bestMatch = null;
  let bestLen = 0;
  for (const pattern of Object.keys(models)) {
    if (id.startsWith(pattern) && pattern.length > bestLen) {
      bestMatch = pattern;
      bestLen = pattern.length;
    }
  }

  return bestMatch ? models[bestMatch] : null;
}

/**
 * Normalize token usage from any harness into a unified shape.
 *
 * @param {string} harnessId
 * @param {string|null} modelId
 * @param {Object|null} rawTokenUsage - as emitted by the harness
 * @param {number|null} rawContextUsage - 0.0-1.0 if provided by KIMI, else null
 * @returns {Object} unified token usage
 */
function normalizeTokenUsage(harnessId, modelId, rawTokenUsage, rawContextUsage) {
  if (!rawTokenUsage) {
    return {
      input_other: null,
      input_cache_read: null,
      input_cache_creation: null,
      input_total: null,
      output: null,
      total: null,
      context_pct: rawContextUsage ?? null,
      model_usage: null,
    };
  }

  const inputOther = rawTokenUsage.input_other ?? null;
  const inputCacheRead = rawTokenUsage.input_cache_read ?? null;
  const inputCacheCreation = rawTokenUsage.input_cache_creation ?? null;
  const output = rawTokenUsage.output ?? null;
  const modelUsage = rawTokenUsage.model_usage ?? null;

  // Compute input_total from whatever is available
  let inputTotal = null;
  if (inputOther !== null) {
    inputTotal = inputOther + (inputCacheRead || 0) + (inputCacheCreation || 0);
  }

  // Compute grand total
  let total = null;
  if (inputTotal !== null && output !== null) {
    total = inputTotal + output;
  }

  // Context percentage: use native if available, else calculate
  let contextPct = rawContextUsage ?? null;
  if (contextPct === null && inputTotal !== null) {
    const maxContext = getMaxContext(harnessId, modelId);
    if (maxContext) {
      contextPct = inputTotal / maxContext;
    }
  }

  return {
    input_other: inputOther,
    input_cache_read: inputCacheRead,
    input_cache_creation: inputCacheCreation,
    input_total: inputTotal,
    output,
    total,
    context_pct: contextPct,
    model_usage: modelUsage,
  };
}

module.exports = { MODEL_CATALOG, getMaxContext, normalizeTokenUsage };
