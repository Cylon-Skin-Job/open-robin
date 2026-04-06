const { mapCodexToolName, mapCanonicalToCodex, isCodexTool } = require('../tool-mapper');

describe('Codex tool-mapper', () => {
  describe('mapCodexToolName', () => {
    it('should map Codex tool names to canonical names', () => {
      expect(mapCodexToolName('readFile')).toBe('read');
      expect(mapCodexToolName('writeFile')).toBe('write');
      expect(mapCodexToolName('editFile')).toBe('edit');
      expect(mapCodexToolName('runCommand')).toBe('shell');
      expect(mapCodexToolName('searchFiles')).toBe('glob');
      expect(mapCodexToolName('grepSearch')).toBe('grep');
    });

    it('should map lowercase fallback for unknown tools', () => {
      expect(mapCodexToolName('UnknownTool')).toBe('unknowntool');
    });

    it('should return empty string for null/undefined', () => {
      expect(mapCodexToolName(null)).toBe('');
      expect(mapCodexToolName(undefined)).toBe('');
    });
  });

  describe('mapCanonicalToCodex', () => {
    it('should map canonical names to Codex names', () => {
      expect(mapCanonicalToCodex('read')).toBe('readFile');
      expect(mapCanonicalToCodex('write')).toBe('writeFile');
      expect(mapCanonicalToCodex('edit')).toBe('editFile');
      expect(mapCanonicalToCodex('shell')).toBe('runCommand');
    });

    it('should return original name if no mapping exists', () => {
      expect(mapCanonicalToCodex('unknown')).toBe('unknown');
    });
  });

  describe('isCodexTool', () => {
    it('should identify Codex tools', () => {
      expect(isCodexTool('readFile')).toBe(true);
      expect(isCodexTool('writeFile')).toBe(true);
      expect(isCodexTool('unknown')).toBe(false);
    });
  });
});
