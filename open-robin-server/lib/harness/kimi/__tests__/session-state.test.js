const { KimiSessionState } = require('../session-state');

describe('KimiSessionState', () => {
  it('should initialize with correct defaults', () => {
    const state = new KimiSessionState();
    
    expect(state.currentTurn).toBeNull();
    expect(state.assistantParts).toEqual([]);
    expect(state.toolArgs).toEqual({});
    expect(state.activeToolId).toBeNull();
    expect(state.hasToolCalls).toBe(false);
    expect(state.contextUsage).toBeNull();
    expect(state.tokenUsage).toBeNull();
    expect(state.messageId).toBeNull();
    expect(state.planMode).toBe(false);
  });

  it('should reset turn state correctly', () => {
    const state = new KimiSessionState();
    
    // Set up some state
    state.currentTurn = { id: 't1', text: 'test', userInput: 'hi' };
    state.assistantParts = [{ type: 'text', content: 'hello' }];
    state.toolArgs = { tc1: '{}' };
    state.activeToolId = 'tc1';
    state.hasToolCalls = true;
    
    state.resetTurn();
    
    expect(state.currentTurn).toBeNull();
    expect(state.assistantParts).toEqual([]);
    expect(state.toolArgs).toEqual({});
    expect(state.activeToolId).toBeNull();
    expect(state.hasToolCalls).toBe(false);
    // Metadata should NOT be reset here
    expect(state.contextUsage).toBeNull();
  });

  it('should reset metadata correctly', () => {
    const state = new KimiSessionState();
    
    state.contextUsage = 0.5;
    state.tokenUsage = { input_other: 100 };
    state.messageId = 'msg-1';
    state.planMode = true;
    
    state.resetMetadata();
    
    expect(state.contextUsage).toBeNull();
    expect(state.tokenUsage).toBeNull();
    expect(state.messageId).toBeNull();
    expect(state.planMode).toBe(false);
  });

  it('should add text content', () => {
    const state = new KimiSessionState();
    
    state.addText('Hello');
    expect(state.assistantParts).toHaveLength(1);
    expect(state.assistantParts[0]).toEqual({ type: 'text', content: 'Hello' });
    
    state.addText(' world');
    expect(state.assistantParts).toHaveLength(1);
    expect(state.assistantParts[0].content).toBe('Hello world');
  });

  it('should add thinking content', () => {
    const state = new KimiSessionState();
    
    state.addThinking('Let me think');
    expect(state.assistantParts).toHaveLength(1);
    expect(state.assistantParts[0]).toEqual({ type: 'think', content: 'Let me think' });
    
    state.addThinking(' about this');
    expect(state.assistantParts).toHaveLength(1);
    expect(state.assistantParts[0].content).toBe('Let me think about this');
  });

  it('should alternate between text and think parts', () => {
    const state = new KimiSessionState();
    
    state.addText('Hello');
    state.addThinking('Let me think');
    state.addText('world');
    
    expect(state.assistantParts).toHaveLength(3);
    expect(state.assistantParts[0]).toEqual({ type: 'text', content: 'Hello' });
    expect(state.assistantParts[1]).toEqual({ type: 'think', content: 'Let me think' });
    expect(state.assistantParts[2]).toEqual({ type: 'text', content: 'world' });
  });

  it('should start tool call correctly', () => {
    const state = new KimiSessionState();
    
    state.startToolCall('tc-1', 'read');
    
    expect(state.hasToolCalls).toBe(true);
    expect(state.activeToolId).toBe('tc-1');
    expect(state.toolArgs).toEqual({ 'tc-1': '' });
    expect(state.assistantParts).toHaveLength(1);
    expect(state.assistantParts[0]).toMatchObject({
      type: 'tool_call',
      toolCallId: 'tc-1',
      name: 'read',
      arguments: {},
      result: { output: '', display: [] }
    });
  });

  it('should accumulate tool args', () => {
    const state = new KimiSessionState();
    
    state.startToolCall('tc-1', 'read');
    state.addToolArgs('tc-1', '{"path"');
    state.addToolArgs('tc-1', ':"/test"}');
    
    expect(state.toolArgs['tc-1']).toBe('{"path":"/test"}');
  });

  it('should not add args for unknown tool', () => {
    const state = new KimiSessionState();
    
    state.addToolArgs('unknown-id', 'some args');
    
    expect(state.toolArgs['unknown-id']).toBeUndefined();
  });

  it('should complete tool call with parsed args', () => {
    const state = new KimiSessionState();
    
    state.startToolCall('tc-1', 'read');
    state.addToolArgs('tc-1', '{"path":"/test"}');
    state.completeToolCall('tc-1', 'read', {
      output: 'file contents',
      display: [],
      is_error: false
    });
    
    const toolPart = state.assistantParts[0];
    expect(toolPart.arguments).toEqual({ path: '/test' });
    expect(toolPart.result).toMatchObject({
      output: 'file contents',
      display: [],
      error: undefined
    });
    expect(state.toolArgs['tc-1']).toBeUndefined(); // Should be deleted
  });

  it('should handle error result', () => {
    const state = new KimiSessionState();
    
    state.startToolCall('tc-1', 'read');
    state.addToolArgs('tc-1', '{"path":"/test"}');
    state.completeToolCall('tc-1', 'read', {
      output: 'Permission denied',
      display: [],
      is_error: true
    });
    
    expect(state.assistantParts[0].result.error).toBe('Permission denied');
  });

  it('should handle invalid JSON in args', () => {
    const state = new KimiSessionState();
    
    state.startToolCall('tc-1', 'read');
    state.addToolArgs('tc-1', 'invalid json');
    state.completeToolCall('tc-1', 'read', {
      output: 'result',
      display: []
    });
    
    expect(state.assistantParts[0].arguments).toEqual({});
  });

  it('should include files in result', () => {
    const state = new KimiSessionState();
    
    state.startToolCall('tc-1', 'write');
    state.addToolArgs('tc-1', '{"path":"/test.txt"}');
    state.completeToolCall('tc-1', 'write', {
      output: 'File written',
      display: [],
      files: ['/test.txt']
    });
    
    expect(state.assistantParts[0].result.files).toEqual(['/test.txt']);
  });
});
