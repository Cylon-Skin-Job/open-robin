const { QwenAcpSessionState } = require('../session-state');

describe('QwenAcpSessionState', () => {
  let state;

  beforeEach(() => {
    state = new QwenAcpSessionState();
  });

  describe('startTurn', () => {
    it('should initialize a new turn', () => {
      state.startTurn('turn-1', 'Hello world');

      expect(state.currentTurn).not.toBeNull();
      expect(state.currentTurn.id).toBe('turn-1');
      expect(state.currentTurn.userInput).toBe('Hello world');
      expect(state.currentTurn.text).toBe('');
    });

    it('should reset previous state', () => {
      state.addText('old text');
      state.startToolCall('old-tool', 'read', 'read', '{}');

      state.startTurn('turn-2', 'new');

      expect(state.getFullText()).toBe('');
      expect(state.hasPendingToolCalls()).toBe(false);
    });
  });

  describe('addText', () => {
    it('should accumulate text', () => {
      state.startTurn('turn-1', 'test');
      state.addText('Hello');
      state.addText(' World');

      expect(state.getFullText()).toBe('Hello World');
    });
  });

  describe('addThinking', () => {
    it('should accumulate thinking text', () => {
      state.startTurn('turn-1', 'test');
      state.addThinking('Let me think...');
      state.addThinking('...about this');

      const thinkingPart = state.assistantParts.find(p => p.type === 'think');
      expect(thinkingPart).toBeDefined();
      expect(thinkingPart.content).toBe('Let me think......about this');
    });
  });

  describe('tool calls', () => {
    it('should track tool calls', () => {
      state.startTurn('turn-1', 'test');
      state.startToolCall('tool-1', 'read', 'read');

      expect(state.hasToolCalls).toBe(true);
      expect(state.hasPendingToolCalls()).toBe(true);
      expect(state.getPendingToolCall('tool-1')).toBeDefined();
    });

    it('should complete tool calls', () => {
      state.startTurn('turn-1', 'test');
      state.startToolCall('tool-1', 'read', 'read');
      state.completeToolCall('tool-1', 'file contents', false);

      expect(state.hasPendingToolCalls()).toBe(false);
    });
  });

  describe('setSessionInfo', () => {
    it('should set session metadata', () => {
      state.setSessionInfo('sess-1', { currentModelId: 'qwen3-coder-plus' }, 'yolo');

      expect(state.sessionId).toBe('sess-1');
      expect(state.currentModel).toBe('qwen3-coder-plus');
      expect(state.currentMode).toBe('yolo');
    });
  });

  describe('setTokenUsage', () => {
    it('should set token usage', () => {
      state.setTokenUsage({
        input_tokens: 1000,
        output_tokens: 200,
        model_usage: [{ model: 'qwen3-coder-plus', input_tokens: 1000, output_tokens: 200 }]
      });

      expect(state.inputTokens).toBe(1000);
      expect(state.outputTokens).toBe(200);
      expect(state.modelUsage).toHaveLength(1);
    });
  });

  describe('setStopReason', () => {
    it('should set stop reason', () => {
      state.setStopReason('end_turn');
      expect(state.stopReason).toBe('end_turn');
    });
  });

  describe('resetTurn', () => {
    it('should clear turn state', () => {
      state.startTurn('turn-1', 'test');
      state.addText('Hello');
      state.startToolCall('tool-1', 'read', 'read');

      state.resetTurn();

      expect(state.currentTurn).toBeNull();
      expect(state.getFullText()).toBe('');
      expect(state.hasPendingToolCalls()).toBe(false);
    });
  });
});
