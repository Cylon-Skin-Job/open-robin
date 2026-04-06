/**
 * Qwen CLI tool name → canonical lowercase mapping.
 *
 * Qwen Code CLI is a fork of Gemini CLI, so most tool names are identical.
 * We map to canonical lowercase for consistent UI handling.
 */
const QWEN_TO_CANONICAL_MAP = {
  // File operations
  'list_directory': 'list',
  'read_file': 'read',
  'write_file': 'write',
  'edit': 'edit',
  'read_many_files': 'read_many',

  // Search operations
  'grep_search': 'grep',
  'glob': 'glob',

  // Shell execution
  'run_shell_command': 'shell',

  // Web operations
  'web_fetch': 'fetch',
  'web_search': 'web_search',

  // User interaction
  'ask_user_question': 'ask',

  // Memory/tracking
  'save_memory': 'memory',
  'todo_write': 'todo',

  // Agent delegation
  'agent': 'agent',
  'skill': 'skill',

  // Plan mode
  'exit_plan_mode': 'exit_plan_mode',
};

/**
 * Map a Qwen tool name to its canonical form.
 * Unknown tools are lowercased but preserve their original name.
 * @param {string} qwenName
 * @returns {string}
 */
function mapQwenToolName(qwenName) {
  return QWEN_TO_CANONICAL_MAP[qwenName] || qwenName.toLowerCase();
}

/**
 * Check if a tool name is a known Qwen tool.
 * @param {string} name
 * @returns {boolean}
 */
function isQwenTool(name) {
  return name in QWEN_TO_CANONICAL_MAP;
}

/**
 * Check if a tool is an MCP tool (prefixed with mcp_)
 * Qwen supports MCP tools with the same convention as Gemini.
 * @param {string} name
 * @returns {boolean}
 */
function isMcpTool(name) {
  return name.startsWith('mcp_');
}

/**
 * Extract MCP server and tool name from an MCP tool call.
 * Format: mcp_<serverName>_<toolName>
 * Note: Both server and tool names can contain underscores
 * @param {string} name
 * @returns {{serverName: string, toolName: string} | null}
 */
function parseMcpToolName(name) {
  if (!isMcpTool(name)) return null;

  const parts = name.slice(4).split('_'); // Remove 'mcp_' prefix
  if (parts.length < 2) return null;

  // First part is the server name, rest is the tool name
  const serverName = parts[0];
  const toolName = parts.slice(1).join('_');

  return { serverName, toolName };
}

module.exports = {
  QWEN_TO_CANONICAL_MAP,
  mapQwenToolName,
  isQwenTool,
  isMcpTool,
  parseMcpToolName
};
