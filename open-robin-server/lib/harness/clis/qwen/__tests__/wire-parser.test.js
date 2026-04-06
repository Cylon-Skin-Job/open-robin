const { QwenAcpWireParser } = require('../wire-parser');

describe('QwenAcpWireParser', () => {
  let parser;

  beforeEach(() => {
    parser = new QwenAcpWireParser();
  });

  it('should parse a single JSON-RPC message', () => {
    const messages = [];
    parser.on('message', (msg) => messages.push(msg));

    parser.feed('{"jsonrpc":"2.0","id":1,"result":{"sessionId":"test-123"}}\n');

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { sessionId: 'test-123' }
    });
  });

  it('should classify responses correctly', () => {
    const responses = [];
    parser.on('response', (msg) => responses.push(msg));

    parser.feed('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n');
    parser.feed('{"jsonrpc":"2.0","id":2,"error":{"code":-1,"message":"fail"}}\n');

    expect(responses).toHaveLength(2);
    expect(responses[0].result).toBeDefined();
    expect(responses[1].error).toBeDefined();
  });

  it('should classify notifications correctly', () => {
    const notifications = [];
    parser.on('notification', (msg) => notifications.push(msg));

    parser.feed('{"jsonrpc":"2.0","method":"session/update","params":{"update":{}}}\n');

    expect(notifications).toHaveLength(1);
    expect(notifications[0].method).toBe('session/update');
  });

  it('should classify requests correctly', () => {
    const requests = [];
    parser.on('request', (msg) => requests.push(msg));

    parser.feed('{"jsonrpc":"2.0","id":5,"method":"someMethod","params":{}}\n');

    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('someMethod');
  });

  it('should handle partial messages in buffer', () => {
    const messages = [];
    parser.on('message', (msg) => messages.push(msg));

    parser.feed('{"jsonrpc":"2.0","id":1,"result":{"ses');
    parser.feed('sionId":"test"}}\n');

    expect(messages).toHaveLength(1);
    expect(messages[0].result.sessionId).toBe('test');
  });

  it('should handle multiple messages in one feed', () => {
    const messages = [];
    parser.on('message', (msg) => messages.push(msg));

    parser.feed(
      '{"jsonrpc":"2.0","id":1,"result":{}}\n' +
      '{"jsonrpc":"2.0","id":2,"result":{}}\n' +
      '{"jsonrpc":"2.0","method":"notify","params":{}}\n'
    );

    expect(messages).toHaveLength(3);
  });

  it('should emit parse errors for invalid JSON', () => {
    const errors = [];
    parser.on('parse_error', (line, err, lineNum) => {
      errors.push({ line, lineNum });
    });

    parser.feed('not valid json\n');

    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe('not valid json');
    expect(errors[0].lineNum).toBe(1);
  });

  it('should flush remaining buffer', () => {
    const messages = [];
    parser.on('message', (msg) => messages.push(msg));

    parser.feed('{"jsonrpc":"2.0","id":1,"result":{}}'); // No newline
    parser.flush();

    expect(messages).toHaveLength(1);
  });

  it('should clear buffer', () => {
    parser.feed('partial message...');
    expect(parser.getBuffer()).toBe('partial message...');

    parser.clear();
    expect(parser.getBuffer()).toBe('');
    expect(parser.lineCount).toBe(0);
  });

  it('should handle empty lines', () => {
    const messages = [];
    parser.on('message', (msg) => messages.push(msg));

    parser.feed('\n\n{"jsonrpc":"2.0","id":1}\n\n');

    expect(messages).toHaveLength(1);
  });

  it('should track line count correctly', () => {
    parser.feed('{"jsonrpc":"2.0","id":1}\n');
    parser.feed('{"jsonrpc":"2.0","id":2}\n');
    parser.feed('invalid\n');

    expect(parser.lineCount).toBe(3);
  });
});
