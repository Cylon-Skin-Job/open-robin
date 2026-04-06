const { ClaudeCodeHarness } = require('../../lib/harness/clis/claude-code');
const { ClaudeAcpEventTranslator } = require('../../lib/harness/clis/claude-code/acp-event-translator');
const { ClaudeSessionState } = require('../../lib/harness/clis/claude-code/session-state');

describe('ClaudeCodeHarness', () => {
  let harness;

  beforeEach(() => {
    harness = new ClaudeCodeHarness();
  });

  it('should have correct metadata', () => {
    expect(harness.id).toBe('claude-code');
    expect(harness.name).toBe('Claude Code (Anthropic)');
    expect(harness.cliName).toBe('claude');
    expect(harness.provider).toBe('anthropic');
  });

  it('should generate correct spawn arguments', () => {
    const args = harness.getSpawnArgs('thread-1', '/project');
    expect(args).toContain('--acp');
    expect(args).toContain('--approval-mode');
    expect(args).toContain('auto');
  });

  it('should support model override in config', async () => {
    await harness.initialize({ model: 'claude-3-opus' });
    const args = harness.getSpawnArgs('thread-1', '/project');
    expect(args).toContain('--model');
    expect(args).toContain('claude-3-opus');
  });
});

describe('ClaudeAcpEventTranslator', () => {
  let translator;
  let state;

  beforeEach(() => {
    state = new ClaudeSessionState();
    translator = new ClaudeAcpEventTranslator(state);
    state.startTurn('turn-1', 'Hello');
  });

  it('should translate agent_message_chunk to content event', () => {
    const msg = {
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
    expect(state.currentTurn.text).toBe('Hello world');
  });

  it('should translate agent_thought_chunk to thinking event', () => {
    const msg = {
      method: 'session/update',
      params: {
        update: {
          sessionUpdate: 'agent_thought_chunk',
          content: { type: 'text', text: 'Thinking...' }
        }
      }
    };

    const event = translator.translate(msg);
    expect(event.type).toBe('thinking');
    expect(event.text).toBe('Thinking...');
    expect(state.assistantParts[0].type).toBe('think');
    expect(state.assistantParts[0].content).toBe('Thinking...');
  });

  it('should translate tool_call to tool_call events', () => {
    const msg = {
      method: 'session/update',
      params: {
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'tc-1',
          toolName: 'Bash',
          title: 'Run command',
          rawInput: '{"command":"ls"}'
        }
      }
    };

    const events = translator.translate(msg);
    expect(Array.isArray(events)).toBe(true);
    expect(events[0].type).toBe('tool_call');
    expect(events[0].toolName).toBe('shell'); // Mapped
    expect(events[1].type).toBe('tool_call_args');
    expect(events[1].argsChunk).toBe('{"command":"ls"}');
  });

  it('should translate tool_result update', () => {
    state.startToolCall('tc-1', 'shell', 'Run command');
    
    const msg = {
      method: 'session/update',
      params: {
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tc-1',
          status: 'completed',
          output: 'file1.txt'
        }
      }
    };

    const event = translator.translate(msg);
    expect(event.type).toBe('tool_result');
    expect(event.output).toBe('file1.txt');
    expect(state.assistantParts[0].result.output).toBe('file1.txt');
  });

  it('should translate session/prompt response to turn_end', () => {
    state.addText('Done.');
    
    const msg = {
      id: 123,
      result: {
        stopReason: 'end_turn',
        _meta: {
          usage: { inputTokens: 100, outputTokens: 50 }
        }
      }
    };

    const event = translator.translate(msg);
    expect(event.type).toBe('turn_end');
    expect(event.fullText).toBe('Done.');
    expect(event._meta.tokenUsage.output).toBe(50);
  });
});
