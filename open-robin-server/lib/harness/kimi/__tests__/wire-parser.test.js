const { WireParser } = require('../wire-parser');

describe('WireParser', () => {
  it('should buffer incomplete lines', () => {
    const parser = new WireParser();
    const messages = [];
    parser.on('message', (m) => messages.push(m));
    
    parser.feed('{"jsonrpc":"2.0","method":"eve');
    parser.feed('nt","params":{"type":"TurnBe');
    parser.feed('gin","payload":{}}}\n');
    
    expect(messages).toHaveLength(1);
    expect(messages[0].params?.type).toBe('TurnBegin');
  });

  it('should emit parse_error for invalid JSON', () => {
    const parser = new WireParser();
    const errors = [];
    parser.on('parse_error', (...args) => errors.push(args));
    
    parser.feed('not valid json\n');
    
    expect(errors).toHaveLength(1);
  });

  it('should handle multiple complete messages in one feed', () => {
    const parser = new WireParser();
    const messages = [];
    parser.on('message', (m) => messages.push(m));
    
    parser.feed('{"jsonrpc":"2.0","method":"event","params":{"type":"TurnBegin"}}\n{"jsonrpc":"2.0","method":"event","params":{"type":"ContentPart"}}\n');
    
    expect(messages).toHaveLength(2);
    expect(messages[0].params.type).toBe('TurnBegin');
    expect(messages[1].params.type).toBe('ContentPart');
  });

  it('should skip empty lines', () => {
    const parser = new WireParser();
    const messages = [];
    parser.on('message', (m) => messages.push(m));
    
    parser.feed('\n\n{"jsonrpc":"2.0","method":"event","params":{"type":"TurnBegin"}}\n\n');
    
    expect(messages).toHaveLength(1);
  });

  it('should preserve incomplete buffer between feeds', () => {
    const parser = new WireParser();
    
    parser.feed('{"jsonrpc":"2.0"');
    expect(parser.getBuffer()).toBe('{"jsonrpc":"2.0"');
    
    parser.feed(',"method":"event"}');
    expect(parser.getBuffer()).toBe('{"jsonrpc":"2.0","method":"event"}');
    
    parser.feed('\n');
    expect(parser.getBuffer()).toBe('');
  });

  it('should clear buffer on clear()', () => {
    const parser = new WireParser();
    
    parser.feed('incomplete data');
    expect(parser.getBuffer()).toBe('incomplete data');
    
    parser.clear();
    expect(parser.getBuffer()).toBe('');
  });
});
