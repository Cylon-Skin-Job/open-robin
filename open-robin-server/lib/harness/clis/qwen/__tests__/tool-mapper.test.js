const {
  mapQwenToolName,
  isQwenTool,
  isMcpTool,
  parseMcpToolName
} = require('../tool-mapper');

describe('QwenToolMapper', () => {
  describe('mapQwenToolName', () => {
    it('should map file operations', () => {
      expect(mapQwenToolName('list_directory')).toBe('list');
      expect(mapQwenToolName('read_file')).toBe('read');
      expect(mapQwenToolName('write_file')).toBe('write');
      expect(mapQwenToolName('edit')).toBe('edit');
      expect(mapQwenToolName('read_many_files')).toBe('read_many');
    });

    it('should map search operations', () => {
      expect(mapQwenToolName('grep_search')).toBe('grep');
      expect(mapQwenToolName('glob')).toBe('glob');
    });

    it('should map shell execution', () => {
      expect(mapQwenToolName('run_shell_command')).toBe('shell');
    });

    it('should map web operations', () => {
      expect(mapQwenToolName('web_fetch')).toBe('fetch');
      expect(mapQwenToolName('web_search')).toBe('web_search');
    });

    it('should map user interaction', () => {
      expect(mapQwenToolName('ask_user_question')).toBe('ask');
    });

    it('should map memory/tracking tools', () => {
      expect(mapQwenToolName('save_memory')).toBe('memory');
      expect(mapQwenToolName('todo_write')).toBe('todo');
    });

    it('should map agent tools', () => {
      expect(mapQwenToolName('agent')).toBe('agent');
      expect(mapQwenToolName('skill')).toBe('skill');
    });

    it('should lowercase unknown tools', () => {
      expect(mapQwenToolName('CustomTool')).toBe('customtool');
      expect(mapQwenToolName('UNKNOWN_TOOL')).toBe('unknown_tool');
    });

    it('should preserve unknown tool names', () => {
      expect(mapQwenToolName('some_custom_tool')).toBe('some_custom_tool');
    });
  });

  describe('isQwenTool', () => {
    it('should return true for known Qwen tools', () => {
      expect(isQwenTool('read_file')).toBe(true);
      expect(isQwenTool('write_file')).toBe(true);
      expect(isQwenTool('run_shell_command')).toBe(true);
      expect(isQwenTool('ask_user_question')).toBe(true);
    });

    it('should return false for unknown tools', () => {
      expect(isQwenTool('custom_tool')).toBe(false);
      expect(isQwenTool('something_else')).toBe(false);
    });
  });

  describe('isMcpTool', () => {
    it('should return true for MCP tools', () => {
      expect(isMcpTool('mcp_server_tool')).toBe(true);
      expect(isMcpTool('mcp_')).toBe(true);
    });

    it('should return false for non-MCP tools', () => {
      expect(isMcpTool('read_file')).toBe(false);
      expect(isMcpTool('tool')).toBe(false);
    });
  });

  describe('parseMcpToolName', () => {
    it('should parse MCP tool names with server and tool', () => {
      expect(parseMcpToolName('mcp_server_tool')).toEqual({
        serverName: 'server',
        toolName: 'tool'
      });
    });

    it('should handle underscores in tool names', () => {
      expect(parseMcpToolName('mcp_my_server_my_tool')).toEqual({
        serverName: 'my',
        toolName: 'server_my_tool'
      });
    });

    it('should return null for non-MCP tools', () => {
      expect(parseMcpToolName('read_file')).toBeNull();
    });

    it('should return null for mcp_ with no parts', () => {
      expect(parseMcpToolName('mcp_')).toBeNull();
    });
  });
});
