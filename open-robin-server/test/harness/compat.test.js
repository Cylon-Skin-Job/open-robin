/**
 * Compatibility layer tests.
 *
 * @see ../../specs/PHASE-2-COMPATIBILITY-LAYER-SPEC.md
 */

const {
  getHarnessMode,
  setThreadMode,
  clearThreadMode,
  setGlobalMode,
  resetOverrides,
  shouldUseNewHarness,
  isParallelMode,
  getFlagStatus
} = require('../../lib/harness/feature-flags');

describe('Feature Flags', () => {
  const originalEnv = process.env.HARNESS_MODE;

  beforeEach(() => {
    resetOverrides();
    delete process.env.HARNESS_MODE;
  });

  afterEach(() => {
    resetOverrides();
    process.env.HARNESS_MODE = originalEnv;
  });

  describe('getHarnessMode', () => {
    it('defaults to legacy when no flags set', () => {
      expect(getHarnessMode()).toBe('legacy');
    });

    it('reads from environment variable', () => {
      process.env.HARNESS_MODE = 'new';
      expect(getHarnessMode()).toBe('new');
    });

    it('thread override takes precedence over env', () => {
      process.env.HARNESS_MODE = 'new';
      setThreadMode('thread-1', 'legacy');

      expect(getHarnessMode('thread-1')).toBe('legacy');
      expect(getHarnessMode('thread-2')).toBe('new');
    });

    it('thread override takes precedence over global', () => {
      setGlobalMode('parallel');
      setThreadMode('thread-1', 'new');

      // Thread override should win over global
      expect(getHarnessMode('thread-1')).toBe('new');
      // Other threads use global
      expect(getHarnessMode('thread-2')).toBe('parallel');
    });

    it('ignores invalid environment values', () => {
      process.env.HARNESS_MODE = 'invalid';
      expect(getHarnessMode()).toBe('legacy');
    });
  });

  describe('shouldUseNewHarness', () => {
    it('returns false for legacy mode', () => {
      process.env.HARNESS_MODE = 'legacy';
      expect(shouldUseNewHarness()).toBe(false);
    });

    it('returns true for new mode', () => {
      process.env.HARNESS_MODE = 'new';
      expect(shouldUseNewHarness()).toBe(true);
    });

    it('returns true for parallel mode', () => {
      process.env.HARNESS_MODE = 'parallel';
      expect(shouldUseNewHarness()).toBe(true);
    });

    it('respects thread overrides', () => {
      process.env.HARNESS_MODE = 'new';
      setThreadMode('thread-1', 'legacy');

      expect(shouldUseNewHarness('thread-1')).toBe(false);
      expect(shouldUseNewHarness('thread-2')).toBe(true);
    });
  });

  describe('isParallelMode', () => {
    it('returns true only for parallel mode', () => {
      process.env.HARNESS_MODE = 'parallel';
      expect(isParallelMode()).toBe(true);

      process.env.HARNESS_MODE = 'new';
      expect(isParallelMode()).toBe(false);

      process.env.HARNESS_MODE = 'legacy';
      expect(isParallelMode()).toBe(false);
    });
  });

  describe('setThreadMode', () => {
    it('sets mode for a specific thread', () => {
      setThreadMode('thread-abc', 'new');
      expect(getHarnessMode('thread-abc')).toBe('new');
    });

    it('throws on invalid mode', () => {
      expect(() => setThreadMode('thread-1', 'invalid')).toThrow();
    });
  });

  describe('setGlobalMode', () => {
    it('sets global override', () => {
      setGlobalMode('parallel');
      expect(getHarnessMode()).toBe('parallel');
    });

    it('clears override when set to null', () => {
      setGlobalMode('new');
      expect(getHarnessMode()).toBe('new');

      setGlobalMode(null);
      expect(getHarnessMode()).toBe('legacy');
    });

    it('throws on invalid mode', () => {
      expect(() => setGlobalMode('invalid')).toThrow();
    });
  });

  describe('clearThreadMode', () => {
    it('clears thread-specific override', () => {
      setThreadMode('thread-1', 'new');
      expect(getHarnessMode('thread-1')).toBe('new');

      clearThreadMode('thread-1');
      expect(getHarnessMode('thread-1')).toBe('legacy');
    });
  });

  describe('resetOverrides', () => {
    it('clears all overrides', () => {
      setGlobalMode('new');
      setThreadMode('thread-1', 'parallel');

      resetOverrides();

      expect(getHarnessMode()).toBe('legacy');
      expect(getHarnessMode('thread-1')).toBe('legacy');
    });
  });

  describe('getFlagStatus', () => {
    it('returns complete flag status', () => {
      process.env.HARNESS_MODE = 'new';
      setThreadMode('thread-1', 'legacy');

      const status = getFlagStatus();

      expect(status.environment).toBe('new');
      expect(status.effectiveMode).toBe('new');
      expect(status.threadOverrides['thread-1']).toBe('legacy');
    });
  });
});

describe('Spawn Behavior', () => {
  // Integration tests would go here
  // These require actual kimi CLI to be available

  it.skip('legacy mode spawns process directly', async () => {
    // TODO: Implement once harness is ready
  });

  it.skip('new mode spawns via harness', async () => {
    // TODO: Implement once harness is ready
  });
});
