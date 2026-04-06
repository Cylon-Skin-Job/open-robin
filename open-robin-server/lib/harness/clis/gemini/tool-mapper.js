/**
 * Gemini CLI uses snake_case tool names.
 * We map to canonical lowercase for consistent UI handling.
 */
const GEMINI_TO_CANONICAL_MAP = {
  // File operations
  'list_directory': 'list',
  'read_file': 'read',
  'write_file': 'write',
  'replace': 'edit',
  'read_many_files': 'read_many',
  
  // Search operations
  'grep_search': 'grep',
  'glob': 'glob',
  
  // Shell execution
  'run_shell_command': 'shell',
  
  // Web operations
  'google_web_search': 'web_search',
  'web_fetch': 'fetch',
  
  // User interaction
  'ask_user': 'ask',
  
  // Memory/tracking
  'save_memory': 'memory',
  'write_todos': 'todo',
};

/**
 * Map a Gemini tool name to its canonical form.
 * Unknown tools are lowercased but preserve their original name.
 * @param {string} geminiName
 * @returns {string}
 */
function mapGeminiToolName(geminiName) {
  return GEMINI_TO_CANONICAL_MAP[geminiName] || geminiName.toLowerCase();
}

/**
 * Check if a tool name is a known Gemini tool.
 * @param {string} name
 * @returns {boolean}
 */
function isGeminiTool(name) {
  return name in GEMINI_TO_CANONICAL_MAP;
}

/**
 * Check if a tool is an MCP tool (prefixed with mcp_)
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
  GEMINI_TO_CANONICAL_MAP,
  mapGeminiToolName,
  isGeminiTool,
  isMcpTool,
  parseMcpToolName
};
