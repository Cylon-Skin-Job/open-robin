const { AcpEventTranslator } = require('../acp-event-translator');
const { GeminiSessionState } = require('../session-state');

describe('AcpEventTranslator', () => {
  let state;
  let translator;

  beforeEach(() => {
    state = new GeminiSessionState();
    translator = new AcpEventTranslator(state);
  });

  describe('session/new response', () => {
    it('should translate session/new response to turn_begin', () => {
      const msg = {
        jsonrpc: '2.0',
        id: 2,
        result: {
          sessionId: 'sess-123',
          modes: { currentModeId: 'yolo' },
          models: { currentModelId: 'gemini-2.5-pro' }
        }
      };

      const event = translator.translate(msg);

      expect(event.type).toBe('turn_begin');
      expect(event.turnId).toMatch(/^turn-/);
      expect(state.sessionId).toBe('sess-123');
      expect(state.currentMode).toBe('yolo');
      expect(state.currentModel).toBe('gemini-2.5-pro');
    });
  });

  describe('agent message chunks', () => {
    beforeEach(() => {
      // Initialize the turn first
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

    it('should accumulate multiple content chunks', () => {
      const chunks = ['Hello ', 'world', '!'];
      
      chunks.forEach(text => {
        const msg = {
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text }
            }
          }
        };
        translator.translate(msg);
      });

      expect(state.getFullText()).toBe('Hello world!');
      expect(state.assistantParts).toHaveLength(1);
      expect(state.assistantParts[0].content).toBe('Hello world!');
    });
  });

  describe('tool calls', () => {
    beforeEach(() => {
      state.startTurn('turn-123', 'test input');
    });

    it('should translate tool_call to tool_call event', () => {
      const msg = {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: 'call-123',
            toolName: 'list_directory',
            title: 'List files',
            rawInput: '{"dir_path":"."}'
          }
        }
      };

      const events = translator.translate(msg);

      expect(Array.isArray(events)).toBe(true);
      expect(events).toHaveLength(2);
      
      // First event: tool_call
      expect(events[0].type).toBe('tool_call');
      expect(events[0].toolCallId).toBe('call-123');
      expect(events[0].toolName).toBe('list'); // Canonical name
      
      // Second event: tool_call_args
      expect(events[1].type).toBe('tool_call_args');
      expect(events[1].argsChunk).toBe('{"dir_path":"."}');
    });

    it('should handle tool_call without rawInput', () => {
      const msg = {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: 'call-456',
            toolName: 'run_shell_command',
            title: 'Run command'
          }
        }
      };

      const event = translator.translate(msg);

      expect(event.type).toBe('tool_call');
      expect(event.toolName).toBe('shell'); // Canonical name
    });

    it('should translate tool_call_update (completed) to tool_result', () => {
      // First register the tool call
      state.startToolCall('call-123', 'list', '.', '{"dir_path":"."}');
      
      const msg = {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'call-123',
            status: 'completed',
            content: [{ type: 'text', text: 'file1.txt\nfile2.txt' }]
          }
        }
      };

      const event = translator.translate(msg);

      expect(event.type).toBe('tool_result');
      expect(event.toolCallId).toBe('call-123');
      expect(event.toolName).toBe('list');
      expect(event.output).toBe('file1.txt\nfile2.txt');
      expect(event.isError).toBe(false);
    });

    it('should translate tool_call_update (failed) to tool_result with error', () => {
      state.startToolCall('call-123', 'read', 'test.txt');
      
      const msg = {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'call-123',
            status: 'failed',
            error: { message: 'File not found' }
          }
        }
      };

      const event = translator.translate(msg);

      expect(event.type).toBe('tool_result');
      expect(event.isError).toBe(true);
      expect(event.output).toBe('File not found');
    });
  });

  describe('session/prompt response (turn_end)', () => {
    beforeEach(() => {
      state.startTurn('turn-123', 'test input');
      state.addText('Response text');
      state.startToolCall('call-1', 'list', '.');
    });

    it('should translate prompt response to turn_end', () => {
      const msg = {
        jsonrpc: '2.0',
        id: 3,
        result: {
          stopReason: 'end_turn',
          _meta: {
            quota: {
              input_tokens: 100,
              output_tokens: 50,
              model_usage: [{ model: 'gemini-2.5-pro', input_tokens: 100, output_tokens: 50 }]
            }
          }
        }
      };

      const event = translator.translate(msg);

      expect(event.type).toBe('turn_end');
      expect(event.turnId).toBe('turn-123');
      expect(event.fullText).toBe('Response text');
      expect(event.hasToolCalls).toBe(true);
      expect(event._meta.stopReason).toBe('end_turn');
      expect(event._meta.tokenUsage).toEqual({ input_other: 100, output: 50 });
      expect(event._meta.modelUsage).toHaveLength(1);
    });
  });

  describe('error handling', () => {
    it('should translate JSON-RPC errors to turn_end with error', () => {
      state.startTurn('turn-123', 'test');
      
      const msg = {
        jsonrpc: '2.0',
        id: 3,
        error: {
          code: -32603,
          message: 'Internal error',
          data: { details: 'Something went wrong' }
        }
      };

      const event = translator.translate(msg);

      expect(event.type).toBe('turn_end');
      expect(event.fullText).toBe('Error: Internal error');
      expect(event._meta.error).toBe(true);
      expect(event._meta.errorCode).toBe(-32603);
    });
  });

  describe('thinking events (future compatibility)', () => {
    beforeEach(() => {
      state.startTurn('turn-123', 'test');
    });

    it('should handle agent_thought_chunk events', () => {
      const msg = {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          update: {
            sessionUpdate: 'agent_thought_chunk',
            content: { type: 'text', text: 'Let me think...' }
          }
        }
      };

      const event = translator.translate(msg);

      expect(event.type).toBe('thinking');
      expect(event.text).toBe('Let me think...');
    });
  });

  describe('ignored events', () => {
    it('should ignore metadata updates', () => {
      const events = [];
      const msgs = [
        { method: 'session/update', params: { update: { sessionUpdate: 'available_commands_update' } } },
        { method: 'session/update', params: { update: { sessionUpdate: 'session_info_update' } } },
        { method: 'session/update', params: { update: { sessionUpdate: 'current_mode_update' } } },
        { method: 'session/update', params: { update: { sessionUpdate: 'config_option_update' } } },
        { method: 'session/update', params: { update: { sessionUpdate: 'plan' } } }
      ];

      msgs.forEach(msg => {
        const event = translator.translate(msg);
        expect(event).toBeNull();
      });
    });

    it('should ignore user message chunks', () => {
      const msg = {
        method: 'session/update',
        params: {
          update: {
            sessionUpdate: 'user_message_chunk',
            content: { type: 'text', text: 'User input' }
          }
        }
      };

      const event = translator.translate(msg);
      expect(event).toBeNull();
    });
  });
});
