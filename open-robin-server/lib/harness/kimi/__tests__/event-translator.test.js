const { EventTranslator } = require('../event-translator');
const { KimiSessionState } = require('../session-state');

describe('EventTranslator', () => {
  it('should translate TurnBegin to canonical turn_begin', () => {
    const state = new KimiSessionState();
    const translator = new EventTranslator(state);
    
    const msg = {
      jsonrpc: '2.0',
      method: 'event',
      params: {
        type: 'TurnBegin',
        payload: { user_input: 'Hello' }
      }
    };
    
    const event = translator.translate(msg);
    
    expect(event).toMatchObject({
      type: 'turn_begin',
      userInput: 'Hello'
    });
    expect(event.timestamp).toBeDefined();
    expect(event.turnId).toMatch(/^turn-/);
  });

  it('should map KIMI tool names to canonical', () => {
    const state = new KimiSessionState();
    const translator = new EventTranslator(state);
    
    // First TurnBegin to initialize state
    translator.translate({
      jsonrpc: '2.0',
      method: 'event',
      params: { type: 'TurnBegin', payload: {} }
    });
    
    const msg = {
      jsonrpc: '2.0',
      method: 'event',
      params: {
        type: 'ToolCall',
        payload: {
          id: 'tc-1',
          function: { name: 'ReadFile' }
        }
      }
    };
    
    const event = translator.translate(msg);
    
    expect(event.toolName).toBe('read'); // Not 'ReadFile'
  });

  it('should translate ContentPart text to content event', () => {
    const state = new KimiSessionState();
    const translator = new EventTranslator(state);
    
    // First TurnBegin to initialize state
    translator.translate({
      jsonrpc: '2.0',
      method: 'event',
      params: { type: 'TurnBegin', payload: {} }
    });
    
    const msg = {
      jsonrpc: '2.0',
      method: 'event',
      params: {
        type: 'ContentPart',
        payload: { type: 'text', text: 'Hello world' }
      }
    };
    
    const event = translator.translate(msg);
    
    expect(event).toMatchObject({
      type: 'content',
      text: 'Hello world'
    });
  });

  it('should translate ContentPart think to thinking event', () => {
    const state = new KimiSessionState();
    const translator = new EventTranslator(state);
    
    // First TurnBegin to initialize state
    translator.translate({
      jsonrpc: '2.0',
      method: 'event',
      params: { type: 'TurnBegin', payload: {} }
    });
    
    const msg = {
      jsonrpc: '2.0',
      method: 'event',
      params: {
        type: 'ContentPart',
        payload: { type: 'think', think: 'Let me think...' }
      }
    };
    
    const event = translator.translate(msg);
    
    expect(event).toMatchObject({
      type: 'thinking',
      text: 'Let me think...'
    });
  });

  it('should accumulate text content in state', () => {
    const state = new KimiSessionState();
    const translator = new EventTranslator(state);
    
    translator.translate({
      jsonrpc: '2.0',
      method: 'event',
      params: { type: 'TurnBegin', payload: {} }
    });
    
    translator.translate({
      jsonrpc: '2.0',
      method: 'event',
      params: { type: 'ContentPart', payload: { type: 'text', text: 'Hello ' } }
    });
    
    translator.translate({
      jsonrpc: '2.0',
      method: 'event',
      params: { type: 'ContentPart', payload: { type: 'text', text: 'world' } }
    });
    
    expect(state.currentTurn.text).toBe('Hello world');
    expect(state.assistantParts).toHaveLength(1);
    expect(state.assistantParts[0].content).toBe('Hello world');
  });

  it('should handle ToolCall and ToolCallPart', () => {
    const state = new KimiSessionState();
    const translator = new EventTranslator(state);
    
    translator.translate({
      jsonrpc: '2.0',
      method: 'event',
      params: { type: 'TurnBegin', payload: {} }
    });
    
    const toolCallEvent = translator.translate({
      jsonrpc: '2.0',
      method: 'event',
      params: {
        type: 'ToolCall',
        payload: { id: 'tc-1', function: { name: 'Bash' } }
      }
    });
    
    expect(toolCallEvent).toMatchObject({
      type: 'tool_call',
      toolCallId: 'tc-1',
      toolName: 'shell'
    });
    expect(state.hasToolCalls).toBe(true);
    expect(state.activeToolId).toBe('tc-1');
    
    const argsEvent = translator.translate({
      jsonrpc: '2.0',
      method: 'event',
      params: {
        type: 'ToolCallPart',
        payload: { arguments_part: '{"command": "ls"}' }
      }
    });
    
    expect(argsEvent).toMatchObject({
      type: 'tool_call_args',
      argsChunk: '{"command": "ls"}'
    });
    expect(state.toolArgs['tc-1']).toBe('{"command": "ls"}');
  });

  it('should handle StatusUpdate and include metadata in TurnEnd', () => {
    const state = new KimiSessionState();
    const translator = new EventTranslator(state);
    
    translator.translate({
      jsonrpc: '2.0',
      method: 'event',
      params: { type: 'TurnBegin', payload: {} }
    });
    
    translator.translate({
      jsonrpc: '2.0',
      method: 'event',
      params: {
        type: 'StatusUpdate',
        payload: {
          context_usage: 0.5,
          token_usage: { input_other: 100, output: 50 },
          message_id: 'msg-123',
          plan_mode: true
        }
      }
    });
    
    expect(state.contextUsage).toBe(0.5);
    expect(state.tokenUsage).toEqual({ input_other: 100, output: 50 });
    expect(state.messageId).toBe('msg-123');
    expect(state.planMode).toBe(true);
    
    const turnEndEvent = translator.translate({
      jsonrpc: '2.0',
      method: 'event',
      params: { type: 'TurnEnd', payload: {} }
    });
    
    expect(turnEndEvent._meta).toMatchObject({
      contextUsage: 0.5,
      tokenUsage: { input_other: 100, output: 50 },
      messageId: 'msg-123',
      planMode: true
    });
  });

  it('should return null for non-event methods', () => {
    const state = new KimiSessionState();
    const translator = new EventTranslator(state);
    
    const result = translator.translate({
      jsonrpc: '2.0',
      method: 'request',
      params: { type: 'some_request' }
    });
    
    expect(result).toBeNull();
  });

  it('should return null for unknown event types', () => {
    const state = new KimiSessionState();
    const translator = new EventTranslator(state);
    
    const result = translator.translate({
      jsonrpc: '2.0',
      method: 'event',
      params: { type: 'UnknownEvent', payload: {} }
    });
    
    expect(result).toBeNull();
  });
});
