/**
 * Robin CLI uses PascalCase tool names.
 * We map to canonical lowercase for consistent UI handling.
 */
const ROBIN_TO_CANONICAL_MAP = {
  'ReadFile': 'read',
  'WriteFile': 'write',
  'EditFile': 'edit',
  'Bash': 'shell',
  'Glob': 'glob',
  'Grep': 'grep',
  'WebSearch': 'web_search',
  'WebFetch': 'fetch',
  'Agent': 'subagent',
  'TodoWrite': 'todo'
};

/**
 * Map a Robin tool name to its canonical form.
 * Unknown tools are lowercased but preserve their original name.
 * @param {string} robinName
 * @returns {string}
 */
function mapRobinToolName(robinName) {
  return ROBIN_TO_CANONICAL_MAP[robinName] || robinName.toLowerCase();
}

/**
 * Check if a tool name is a valid Robin tool.
 * @param {string} name
 * @returns {boolean}
 */
function isRobinTool(name) {
  return name in ROBIN_TO_CANONICAL_MAP;
}

module.exports = {
  ROBIN_TO_CANONICAL_MAP,
  mapRobinToolName,
  isRobinTool
};
