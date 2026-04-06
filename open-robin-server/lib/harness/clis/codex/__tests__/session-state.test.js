const { CodexSessionState } = require('../session-state');

describe('CodexSessionState', () => {
  let state;

  beforeEach(() => {
    state = new CodexSessionState();
  });

  it('should initialize with default values', () => {
    expect(state.currentTurn).toBeNull();
    expect(state.assistantParts).toEqual([]);
    expect(state.sessionId).toBeNull();
    expect(state.hasToolCalls).toBe(false);
  });

  it('should start a new turn correctly', () => {
    state.startTurn('turn-1', 'hello');
    
    expect(state.currentTurn).toEqual({
      id: 'turn-1',
      text: '',
      userInput: 'hello'
    });
    expect(state.assistantParts).toEqual([]);
    expect(state.hasToolCalls).toBe(false);
  });

  it('should accumulate text correctly', () => {
    state.startTurn('turn-1', 'hello');
    state.addText('Hello');
    state.addText(' world');
    
    expect(state.currentTurn.text).toBe('Hello world');
    expect(state.assistantParts).toHaveLength(1);
    expect(state.assistantParts[0]).toEqual({
      type: 'text',
      content: 'Hello world'
    });
  });

  it('should track tool calls correctly', () => {
    state.startTurn('turn-1', 'hello');
    state.startToolCall('call-1', 'readFile', 'Read file', '{"file_path":"test.js"}');
    
    expect(state.hasToolCalls).toBe(true);
    expect(state.activeToolId).toBe('call-1');
    expect(state.pendingToolCalls.has('call-1')).toBe(true);
    expect(state.assistantParts).toHaveLength(1);
    expect(state.assistantParts[0].type).toBe('tool_call');
    expect(state.assistantParts[0].name).toBe('readFile');
    expect(state.assistantParts[0].arguments).toEqual({ file_path: 'test.js' });
  });

  it('should complete tool calls correctly', () => {
    state.startTurn('turn-1', 'hello');
    state.startToolCall('call-1', 'readFile', 'Read file', '{"file_path":"test.js"}');
    state.completeToolCall('call-1', 'file content', false);
    
    expect(state.activeToolId).toBeNull();
    expect(state.pendingToolCalls.has('call-1')).toBe(false);
    expect(state.assistantParts[0].result).toEqual({
      output: 'file content',
      isError: false
    });
  });

  it('should set session info correctly', () => {
    state.setSessionInfo('sess-123', { currentModelId: 'gpt-4o' }, 'full-auto');
    
    expect(state.sessionId).toBe('sess-123');
    expect(state.currentModel).toBe('gpt-4o');
    expect(state.currentMode).toBe('full-auto');
  });

  it('should set token usage correctly', () => {
    state.setTokenUsage({ inputTokens: 100, outputTokens: 50 });
    
    expect(state.inputTokens).toBe(100);
    expect(state.outputTokens).toBe(50);
  });

  it('should reset turn correctly', () => {
    state.startTurn('turn-1', 'hello');
    state.addText('some text');
    state.resetTurn();
    
    expect(state.currentTurn).toBeNull();
    expect(state.assistantParts).toEqual([]);
  });
});
