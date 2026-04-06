const {
  GEMINI_TO_CANONICAL_MAP,
  mapGeminiToolName,
  isGeminiTool,
  isMcpTool,
  parseMcpToolName
} = require('../tool-mapper');

describe('tool-mapper', () => {
  describe('mapGeminiToolName', () => {
    it('should map known Gemini tools to canonical names', () => {
      expect(mapGeminiToolName('list_directory')).toBe('list');
      expect(mapGeminiToolName('read_file')).toBe('read');
      expect(mapGeminiToolName('write_file')).toBe('write');
      expect(mapGeminiToolName('replace')).toBe('edit');
      expect(mapGeminiToolName('run_shell_command')).toBe('shell');
      expect(mapGeminiToolName('grep_search')).toBe('grep');
      expect(mapGeminiToolName('glob')).toBe('glob');
      expect(mapGeminiToolName('google_web_search')).toBe('web_search');
      expect(mapGeminiToolName('web_fetch')).toBe('fetch');
      expect(mapGeminiToolName('ask_user')).toBe('ask');
      expect(mapGeminiToolName('save_memory')).toBe('memory');
      expect(mapGeminiToolName('write_todos')).toBe('todo');
      expect(mapGeminiToolName('read_many_files')).toBe('read_many');
    });

    it('should lowercase unknown tools', () => {
      expect(mapGeminiToolName('UNKNOWN_TOOL')).toBe('unknown_tool');
      expect(mapGeminiToolName('MyCustomTool')).toBe('mycustomtool');
    });

    it('should preserve unknown tool names in lowercase', () => {
      expect(mapGeminiToolName('custom_tool')).toBe('custom_tool');
    });
  });

  describe('isGeminiTool', () => {
    it('should return true for known Gemini tools', () => {
      expect(isGeminiTool('list_directory')).toBe(true);
      expect(isGeminiTool('read_file')).toBe(true);
      expect(isGeminiTool('write_file')).toBe(true);
    });

    it('should return false for unknown tools', () => {
      expect(isGeminiTool('unknown_tool')).toBe(false);
      expect(isGeminiTool('customTool')).toBe(false);
    });
  });

  describe('isMcpTool', () => {
    it('should return true for MCP tools', () => {
      expect(isMcpTool('mcp_github_get_file')).toBe(true);
      expect(isMcpTool('mcp_slack_post_message')).toBe(true);
      expect(isMcpTool('mcp_test_tool')).toBe(true);
    });

    it('should return false for non-MCP tools', () => {
      expect(isMcpTool('list_directory')).toBe(false);
      expect(isMcpTool('read_file')).toBe(false);
      expect(isMcpTool('mcp')).toBe(false); // Just prefix, not a tool
    });
  });

  describe('parseMcpToolName', () => {
    it('should parse MCP tool names correctly', () => {
      expect(parseMcpToolName('mcp_github_get_file')).toEqual({
        serverName: 'github',
        toolName: 'get_file'
      });
      expect(parseMcpToolName('mcp_slack_post_message')).toEqual({
        serverName: 'slack',
        toolName: 'post_message'
      });
    });

    it('should handle multi-part tool names', () => {
      // Note: First part is always server, rest is tool name
      expect(parseMcpToolName('mcp_my_server_tool_name')).toEqual({
        serverName: 'my',
        toolName: 'server_tool_name'
      });
    });

    it('should return null for non-MCP tools', () => {
      expect(parseMcpToolName('list_directory')).toBeNull();
      expect(parseMcpToolName('read_file')).toBeNull();
      expect(parseMcpToolName('mcp')).toBeNull();
    });

    it('should return null for invalid MCP tool names', () => {
      expect(parseMcpToolName('mcp_')).toBeNull(); // No tool name
      expect(parseMcpToolName('mcp_tool')).toBeNull(); // No server name
    });
  });

  describe('GEMINI_TO_CANONICAL_MAP', () => {
    it('should contain all expected mappings', () => {
      expect(GEMINI_TO_CANONICAL_MAP).toHaveProperty('list_directory', 'list');
      expect(GEMINI_TO_CANONICAL_MAP).toHaveProperty('read_file', 'read');
      expect(GEMINI_TO_CANONICAL_MAP).toHaveProperty('write_file', 'write');
      expect(GEMINI_TO_CANONICAL_MAP).toHaveProperty('replace', 'edit');
      expect(GEMINI_TO_CANONICAL_MAP).toHaveProperty('run_shell_command', 'shell');
      expect(GEMINI_TO_CANONICAL_MAP).toHaveProperty('grep_search', 'grep');
      expect(GEMINI_TO_CANONICAL_MAP).toHaveProperty('glob', 'glob');
      expect(GEMINI_TO_CANONICAL_MAP).toHaveProperty('google_web_search', 'web_search');
      expect(GEMINI_TO_CANONICAL_MAP).toHaveProperty('web_fetch', 'fetch');
      expect(GEMINI_TO_CANONICAL_MAP).toHaveProperty('ask_user', 'ask');
      expect(GEMINI_TO_CANONICAL_MAP).toHaveProperty('save_memory', 'memory');
      expect(GEMINI_TO_CANONICAL_MAP).toHaveProperty('write_todos', 'todo');
    });
  });
});
