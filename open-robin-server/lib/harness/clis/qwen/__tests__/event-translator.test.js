const { QwenAcpEventTranslator } = require('../event-translator');
const { QwenAcpSessionState } = require('../session-state');

describe('QwenAcpEventTranslator', () => {
  let state;
  let translator;

  beforeEach(() => {
    state = new QwenAcpSessionState();
    translator = new QwenAcpEventTranslator(state);
  });

  describe('translate', () => {
    it('should return null for invalid input', () => {
      expect(translator.translate(null)).toBeNull();
      expect(translator.translate(undefined)).toBeNull();
      expect(translator.translate('string')).toBeNull();
      expect(translator.translate(42)).toBeNull();
    });
  });

  describe('session/new response → turn_begin', () => {
    it('should translate session/new to turn_begin', () => {
      const msg = {
        jsonrpc: '2.0',
        id: 2,
        result: {
          sessionId: 'sess-123',
          models: { currentModelId: 'qwen3-coder-plus' },
          modes: { currentModeId: 'yolo' }
        }
      };

      const event = translator.translate(msg);

      expect(event.type).toBe('turn_begin');
      expect(event.turnId).toMatch(/^turn-/);
      expect(event.userInput).toBe('');
      expect(state.sessionId).toBe('sess-123');
      expect(state.currentModel).toBe('qwen3-coder-plus');
    });
  });

  describe('session/prompt response → turn_end', () => {
    it('should translate session/prompt to turn_end', () => {
      state.startTurn('turn-1', 'test');
      state.addText('Hello');

      const msg = {
        jsonrpc: '2.0',
        id: 3,
        result: {
          stopReason: 'end_turn',
          _meta: {
            quota: {
              input_tokens: 1000,
              output_tokens: 50
            }
          }
        }
      };

      const event = translator.translate(msg);

      expect(event.type).toBe('turn_end');
      expect(event.turnId).toBe('turn-1');
      expect(event.fullText).toBe('Hello');
      expect(event.hasToolCalls).toBe(false);
      expect(event._meta.harnessId).toBe('qwen');
      expect(event._meta.provider).toBe('alibaba');
      expect(event._meta.stopReason).toBe('end_turn');
    });

    it('should include tool call flag', () => {
      state.startTurn('turn-1', 'test');
      state.startToolCall('tool-1', 'read', 'read');
      state.addText('Done');

      const msg = {
        jsonrpc: '2.0',
        id: 3,
        result: {
          stopReason: 'end_turn'
        }
      };

      const event = translator.translate(msg);
      expect(event.hasToolCalls).toBe(true);
    });
  });

  describe('error response → turn_end with error', () => {
    it('should translate error to turn_end', () => {
      const msg = {
        jsonrpc: '2.0',
        id: 3,
        error: {
          code: -32600,
          message: 'Invalid request'
        }
      };

      const event = translator.translate(msg);

      expect(event.type).toBe('turn_end');
      expect(event._meta.error).toBe(true);
      expect(event._meta.errorCode).toBe(-32600);
      expect(event._meta.errorMessage).toBe('Invalid request');
    });
  });

  describe('session/update notifications', () => {
    describe('agent_message_chunk', () => {
      it('should translate text content', () => {
        state.startTurn('turn-1', 'test');

        const msg = {
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: 'Hello world' }
            }
          }
        };

        const event = translator.translate(msg);

        expect(event.type).toBe('content');
        expect(event.text).toBe('Hello world');
        expect(state.getFullText()).toBe('Hello world');
      });
    });

    describe('agent_thought_chunk', () => {
      it('should translate thinking content', () => {
        state.startTurn('turn-1', 'test');

        const msg = {
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            update: {
              sessionUpdate: 'agent_thought_chunk',
              content: { type: 'text', text: 'Let me analyze this...' }
            }
          }
        };

        const event = translator.translate(msg);

        expect(event.type).toBe('thinking');
        expect(event.text).toBe('Let me analyze this...');
      });
    });

    describe('tool_call', () => {
      it('should translate tool call', () => {
        state.startTurn('turn-1', 'test');

        const msg = {
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            update: {
              sessionUpdate: 'tool_call',
              toolCallId: 'tool-1',
              toolName: 'read_file',
              title: 'Read File',
              rawInput: JSON.stringify({ file_path: '/test.js' })
            }
          }
        };

        const events = translator.translate(msg);

        expect(Array.isArray(events)).toBe(true);
        expect(events).toHaveLength(2);
        expect(events[0].type).toBe('tool_call');
        expect(events[0].toolCallId).toBe('tool-1');
        expect(events[0].toolName).toBe('read');
        expect(events[1].type).toBe('tool_call_args');
        expect(events[1].argsChunk).toBe(JSON.stringify({ file_path: '/test.js' }));
      });

      it('should map tool names to canonical form', () => {
        state.startTurn('turn-1', 'test');

        const msg = {
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            update: {
              sessionUpdate: 'tool_call',
              toolCallId: 'tool-1',
              toolName: 'run_shell_command',
              rawInput: JSON.stringify({ cmd: 'ls' })
            }
          }
        };

        const events = translator.translate(msg);
        expect(Array.isArray(events)).toBe(true);
        expect(events[0].toolName).toBe('shell');
      });
    });

    describe('tool_call_update', () => {
      it('should translate tool call completion', () => {
        state.startTurn('turn-1', 'test');
        // First set up the tool call
        state.startToolCall('tool-1', 'read');

        const msg = {
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            update: {
              sessionUpdate: 'tool_call_update',
              toolCallId: 'tool-1',
              status: 'completed',
              content: [{ type: 'text', text: 'file contents' }]
            }
          }
        };

        const event = translator.translate(msg);

        expect(event.type).toBe('tool_result');
        expect(event.toolCallId).toBe('tool-1');
        expect(event.toolName).toBe('read');
        expect(event.isError).toBe(false);
      });

      it('should translate tool call failure', () => {
        state.startTurn('turn-1', 'test');
        state.startToolCall('tool-1', 'read');

        const msg = {
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            update: {
              sessionUpdate: 'tool_call_update',
              toolCallId: 'tool-1',
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

    describe('metadata updates', () => {
      it('should ignore available_commands_update', () => {
        const msg = {
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            update: {
              sessionUpdate: 'available_commands_update'
            }
          }
        };

        expect(translator.translate(msg)).toBeNull();
      });

      it('should ignore session_info_update', () => {
        const msg = {
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            update: {
              sessionUpdate: 'session_info_update'
            }
          }
        };

        expect(translator.translate(msg)).toBeNull();
      });
    });
  });

  describe('extractToolOutput', () => {
    it('should extract text from content array', () => {
      const result = translator.extractToolOutput({
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'text', text: ' World' }
        ]
      });
      expect(result).toBe('Hello World');
    });

    it('should handle string output', () => {
      const result = translator.extractToolOutput({ output: 'direct output' });
      expect(result).toBe('direct output');
    });

    it('should handle object result', () => {
      const result = translator.extractToolOutput({ result: { data: 'value' } });
      expect(result).toBe('{"data":"value"}');
    });
  });
});
