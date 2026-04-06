/**
 * Claude Code uses specific tool names in its ACP implementation.
 * We map these to the Kimi IDE canonical names for consistent UI and event handling.
 */
const CLAUDE_TO_CANONICAL_MAP = {
  'Bash': 'shell',
  'Read': 'read',
  'Edit': 'edit',
  'Write': 'write',
  'Glob': 'glob',
  'Grep': 'grep',
  'WebSearch': 'web_search',
  'WebFetch': 'fetch',
  'Task': 'subagent',
  'TodoWrite': 'todo'
};

/**
 * Map a Claude tool name to its canonical form.
 * Unknown tools are lowercased but preserve their original name.
 * @param {string} claudeName
 * @returns {string}
 */
function mapClaudeToolName(claudeName) {
  return CLAUDE_TO_CANONICAL_MAP[claudeName] || claudeName.toLowerCase();
}

/**
 * Check if a tool name is a valid Claude tool.
 * @param {string} name
 * @returns {boolean}
 */
function isClaudeTool(name) {
  return name in CLAUDE_TO_CANONICAL_MAP;
}

module.exports = {
  CLAUDE_TO_CANONICAL_MAP,
  mapClaudeToolName,
  isClaudeTool
};
