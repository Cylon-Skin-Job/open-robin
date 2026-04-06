/**
 * Tool name mapping for Codex CLI.
 * 
 * Codex uses different tool names than the canonical format.
 * This module maps between Codex tool names and canonical tool names.
 */

/**
 * Map from Codex tool names to canonical tool names.
 * @type {Record<string, string>}
 */
const CODEX_TO_CANONICAL_MAP = {
  // File operations
  'readFile': 'read',
  'writeFile': 'write',
  'editFile': 'edit',
  'applyPatch': 'edit',
  
  // Shell/command operations
  'runCommand': 'shell',
  'bash': 'shell',
  'exec': 'shell',
  
  // Search operations
  'glob': 'glob',
  'searchFiles': 'glob',
  'grep': 'grep',
  'grepSearch': 'grep',
  'searchCode': 'grep',
  
  // Web operations
  'webSearch': 'web_search',
  'webFetch': 'fetch',
  'fetchUrl': 'fetch',
  
  // Agent operations
  'agent': 'subagent',
  'subagent': 'subagent',
  'delegate': 'subagent',
  
  // Task management
  'todoWrite': 'todo',
  'setTodo': 'todo',
  
  // File system
  'listDirectory': 'list',
  'ls': 'list',
  'mkdir': 'mkdir',
  'deleteFile': 'remove',
  'rm': 'remove'
};

/**
 * Map from canonical tool names to Codex tool names.
 * @type {Record<string, string>}
 */
const CANONICAL_TO_CODEX_MAP = {
  'read': 'readFile',
  'write': 'writeFile',
  'edit': 'editFile',
  'shell': 'runCommand',
  'glob': 'glob',
  'grep': 'grep',
  'web_search': 'webSearch',
  'fetch': 'webFetch',
  'subagent': 'agent',
  'todo': 'todoWrite',
  'list': 'listDirectory',
  'mkdir': 'mkdir',
  'remove': 'deleteFile'
};

/**
 * Map a Codex tool name to canonical format.
 * 
 * @param {string} codexToolName - Tool name from Codex
 * @returns {string} Canonical tool name (or original if no mapping exists)
 */
function mapCodexToolName(codexToolName) {
  if (!codexToolName) return '';
  return CODEX_TO_CANONICAL_MAP[codexToolName] || codexToolName.toLowerCase();
}

/**
 * Map a canonical tool name to Codex format.
 * 
 * @param {string} canonicalToolName - Canonical tool name
 * @returns {string} Codex tool name (or original if no mapping exists)
 */
function mapCanonicalToCodex(canonicalToolName) {
  if (!canonicalToolName) return '';
  return CANONICAL_TO_CODEX_MAP[canonicalToolName] || canonicalToolName;
}

/**
 * Check if a tool name is a known Codex tool.
 * 
 * @param {string} toolName
 * @returns {boolean}
 */
function isCodexTool(toolName) {
  if (!toolName) return false;
  return toolName in CODEX_TO_CANONICAL_MAP;
}

/**
 * Get all known Codex tool names.
 * @returns {string[]}
 */
function getCodexToolNames() {
  return Object.keys(CODEX_TO_CANONICAL_MAP);
}

module.exports = {
  CODEX_TO_CANONICAL_MAP,
  CANONICAL_TO_CODEX_MAP,
  mapCodexToolName,
  mapCanonicalToCodex,
  isCodexTool,
  getCodexToolNames
};
