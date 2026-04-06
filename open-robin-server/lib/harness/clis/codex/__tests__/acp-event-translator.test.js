const { CodexEventTranslator } = require('../acp-event-translator');
const { CodexSessionState } = require('../session-state');

describe('CodexEventTranslator', () => {
  let state;
  let translator;

  beforeEach(() => {
    state = new CodexSessionState();
    translator = new CodexEventTranslator(state);
  });

  describe('session/new response', () => {
    it('should translate session/new response to turn_begin', () => {
      const msg = {
        jsonrpc: '2.0',
        id: 2,
        result: {
          sessionId: 'sess-123',
          modes: { currentModeId: 'full-auto' },
          models: { currentModelId: 'gpt-4o' }
        }
      };

      const event = translator.translate(msg);

      expect(event.type).toBe('turn_begin');
      expect(event.turnId).toMatch(/^turn-/);
      expect(state.sessionId).toBe('sess-123');
      expect(state.currentMode).toBe('full-auto');
      expect(state.currentModel).toBe('gpt-4o');
    });
  });

  describe('agent message chunks', () => {
    beforeEach(() => {
      state.startTurn('turn-123', 'test input');
    });

    it('should translate agent_message_chunk to content event', () => {
      const msg = {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'sess-123',
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'Hello world' }
          }
        }
      };

      const event = translator.translate(msg);

      expect(event.type).toBe('content');
      expect(event.text).toBe('Hello world');
      expect(event.turnId).toBe('turn-123');
      expect(state.getFullText()).toBe('Hello world');
    });

    it('should handle token usage in agent_message_chunk', () => {
      const msg = {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: '' },
            _meta: {
              usage: {
                inputTokens: 100,
                outputTokens: 50
              }
            }
          }
        }
      };

      translator.translate(msg);

      expect(state.inputTokens).toBe(100);
      expect(state.outputTokens).toBe(50);
    });
  });

  describe('tool calls', () => {
    beforeEach(() => {
      state.startTurn('turn-123', 'test input');
    });

    it('should translate tool_call to tool_call event with canonical name', () => {
      const msg = {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: 'call-123',
            toolName: 'readFile', // Codex name
            title: 'Read file',
            rawInput: '{"file_path":"test.js"}'
          }
        }
      };

      const events = translator.translate(msg);

      expect(Array.isArray(events)).toBe(true);
      expect(events).toHaveLength(2);
      
      // First event: tool_call
      expect(events[0].type).toBe('tool_call');
      expect(events[0].toolCallId).toBe('call-123');
      expect(events[0].toolName).toBe('read'); // Canonical name
      
      // Second event: tool_call_args
      expect(events[1].type).toBe('tool_call_args');
      expect(events[1].argsChunk).toBe('{"file_path":"test.js"}');
    });

    it('should translate tool_call_update (completed) to tool_result', () => {
      // First register the tool call
      state.startToolCall('call-123', 'read', 'test.js', '{"file_path":"test.js"}');
      
      const msg = {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'call-123',
            status: 'completed',
            content: [{ type: 'text', text: 'file content' }]
          }
        }
      };

      const event = translator.translate(msg);

      expect(event.type).toBe('tool_result');
      expect(event.toolCallId).toBe('call-123');
      expect(event.toolName).toBe('read');
      expect(event.output).toBe('file content');
      expect(event.isError).toBe(false);
    });
  });

  describe('session/prompt response (turn_end)', () => {
    beforeEach(() => {
      state.startTurn('turn-123', 'test input');
      state.addText('Response text');
      state.startToolCall('call-1', 'read', 'test.js');
      state.setTokenUsage({ inputTokens: 100, outputTokens: 50 });
    });

    it('should translate prompt response to turn_end', () => {
      const msg = {
        jsonrpc: '2.0',
        id: 3,
        result: {
          stopReason: 'end_turn'
        }
      };

      const event = translator.translate(msg);

      expect(event.type).toBe('turn_end');
      expect(event.turnId).toBe('turn-123');
      expect(event.fullText).toBe('Response text');
      expect(event.hasToolCalls).toBe(true);
      expect(event._meta.stopReason).toBe('end_turn');
      expect(event._meta.tokenUsage).toEqual({ input_other: 100, output: 50 });
      expect(event._meta.harnessId).toBe('codex');
    });
  });
});
