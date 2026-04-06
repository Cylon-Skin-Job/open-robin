const { GeminiSessionState } = require('../session-state');

describe('GeminiSessionState', () => {
  let state;

  beforeEach(() => {
    state = new GeminiSessionState();
  });

  describe('turn management', () => {
    it('should initialize a new turn', () => {
      state.startTurn('turn-123', 'Hello');

      expect(state.currentTurn).toEqual({
        id: 'turn-123',
        text: '',
        userInput: 'Hello'
      });
    });

    it('should reset turn state', () => {
      state.startTurn('turn-123', 'Hello');
      state.addText('Response');
      state.startToolCall('call-1', 'list', '.');
      
      state.resetTurn();

      expect(state.currentTurn).toBeNull();
      expect(state.assistantParts).toHaveLength(0);
      expect(state.pendingToolCalls.size).toBe(0);
      expect(state.hasToolCalls).toBe(false);
    });
  });

  describe('text accumulation', () => {
    beforeEach(() => {
      state.startTurn('turn-123', 'test');
    });

    it('should accumulate text in current turn', () => {
      state.addText('Hello');
      state.addText(' world');

      expect(state.getFullText()).toBe('Hello world');
      expect(state.currentTurn.text).toBe('Hello world');
    });

    it('should append to existing text part', () => {
      state.addText('Hello');
      state.addText(' world');

      expect(state.assistantParts).toHaveLength(1);
      expect(state.assistantParts[0]).toEqual({
        type: 'text',
        content: 'Hello world'
      });
    });

    it('should create new part after tool call', () => {
      state.addText('Before tool');
      state.startToolCall('call-1', 'list', '.');
      state.addText('After tool');

      expect(state.assistantParts).toHaveLength(3);
      expect(state.assistantParts[0].type).toBe('text');
      expect(state.assistantParts[1].type).toBe('tool_call');
      expect(state.assistantParts[2].type).toBe('text');
    });
  });

  describe('tool call management', () => {
    beforeEach(() => {
      state.startTurn('turn-123', 'test');
    });

    it('should start a tool call', () => {
      state.startToolCall('call-123', 'list', '.', '{"dir_path":"."}');

      expect(state.hasToolCalls).toBe(true);
      expect(state.activeToolId).toBe('call-123');
      expect(state.pendingToolCalls.has('call-123')).toBe(true);
      
      const tool = state.getPendingToolCall('call-123');
      expect(tool).toEqual({
        toolCallId: 'call-123',
        toolName: 'list',
        title: '.',
        rawInput: '{"dir_path":"."}'
      });
    });

    it('should complete a tool call successfully', () => {
      state.startToolCall('call-123', 'list', '.', '{"dir_path":"."}');
      state.completeToolCall('call-123', 'file1.txt\nfile2.txt', false);

      expect(state.pendingToolCalls.has('call-123')).toBe(false);
      expect(state.activeToolId).toBeNull();
      
      const toolPart = state.assistantParts.find(p => p.toolCallId === 'call-123');
      expect(toolPart.result).toEqual({
        output: 'file1.txt\nfile2.txt',
        isError: false
      });
    });

    it('should complete a tool call with error', () => {
      state.startToolCall('call-123', 'read', 'test.txt');
      state.completeToolCall('call-123', 'File not found', true);

      const toolPart = state.assistantParts.find(p => p.toolCallId === 'call-123');
      expect(toolPart.result).toEqual({
        output: 'File not found',
        isError: true
      });
    });

    it('should track multiple pending tool calls', () => {
      state.startToolCall('call-1', 'list', '.');
      state.startToolCall('call-2', 'read', 'file.txt');

      expect(state.pendingToolCalls.size).toBe(2);
      expect(state.hasPendingToolCalls()).toBe(true);
    });

    it('should parse JSON raw input', () => {
      state.startToolCall('call-123', 'list', '.', '{"dir_path":".","recursive":true}');

      const toolPart = state.assistantParts.find(p => p.toolCallId === 'call-123');
      expect(toolPart.arguments).toEqual({ dir_path: '.', recursive: true });
    });

    it('should handle null raw input', () => {
      state.startToolCall('call-123', 'list', '.', null);

      const toolPart = state.assistantParts.find(p => p.toolCallId === 'call-123');
      expect(toolPart.arguments).toEqual({});
    });
  });

  describe('session info', () => {
    it('should set session info', () => {
      state.setSessionInfo('sess-123', { currentModelId: 'gemini-2.5-pro' }, 'yolo');

      expect(state.sessionId).toBe('sess-123');
      expect(state.currentModel).toBe('gemini-2.5-pro');
      expect(state.currentMode).toBe('yolo');
    });

    it('should handle null values', () => {
      state.setSessionInfo('sess-123', null, null);

      expect(state.sessionId).toBe('sess-123');
      expect(state.currentModel).toBeNull();
      expect(state.currentMode).toBeNull();
    });
  });

  describe('token usage', () => {
    it('should set token usage from quota', () => {
      state.setTokenUsage({
        input_tokens: 100,
        output_tokens: 50,
        model_usage: [{ model: 'gemini-2.5-pro', input_tokens: 100, output_tokens: 50 }]
      });

      expect(state.inputTokens).toBe(100);
      expect(state.outputTokens).toBe(50);
      expect(state.modelUsage).toHaveLength(1);
    });

    it('should handle null quota', () => {
      state.setTokenUsage(null);

      expect(state.inputTokens).toBeNull();
      expect(state.outputTokens).toBeNull();
    });
  });

  describe('stop reason', () => {
    it('should set stop reason', () => {
      state.setStopReason('end_turn');
      expect(state.stopReason).toBe('end_turn');

      state.setStopReason('max_tokens');
      expect(state.stopReason).toBe('max_tokens');
    });
  });

  describe('getFullText', () => {
    it('should return empty string when no turn', () => {
      expect(state.getFullText()).toBe('');
    });

    it('should return accumulated text', () => {
      state.startTurn('turn-123', 'test');
      state.addText('Hello');
      state.addText(' world');

      expect(state.getFullText()).toBe('Hello world');
    });
  });
});
