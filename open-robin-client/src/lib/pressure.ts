/**
 * Pressure Gauge — backlog-aware timing attenuation.
 *
 * Pure computation module. No React, no DOM, no side effects.
 * Input: backlog (segments.length - revealedCount).
 * Output: a TimingProfile with adjusted values for every animation phase.
 *
 * The renderer falls behind the stream when the API delivers segments
 * faster than the animation pipeline can consume them. This module
 * compresses timing as backlog grows, and triggers a snap-to-frontier
 * when the backlog is hopeless.
 *
 * TIERS:
 *   normal (0-2)     Full ceremony. The sweet spot — buffer has lookahead.
 *   hurry (3-5)      Compressed pauses and faster typing.
 *   rush (6-10)      No shimmer, minimal pauses, fast typing.
 *   aggressive (11-15) Content shown instantly, minimal collapse.
 *   snap (16+)       Jump to frontier minus 2, resume live from there.
 *
 * TARGET: Hover at backlog 1-2. That's where the typing speed attenuator
 * works best (next chunk always buffered → fast typing, smooth flow).
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type PressureTier = 'normal' | 'hurry' | 'rush' | 'aggressive' | 'snap';

export interface TimingProfile {
  /** Current pressure tier name */
  tier: PressureTier;

  // ── Shimmer phase ──
  /** ms for shimmer (fade-in + hold) before content starts */
  shimmerTotal: number;

  // ── Reveal phase ──
  /** ms between typed chunks */
  interChunkPause: number;
  /** ms per char when next chunk is buffered (lookahead available) */
  speedFast: number;
  /** ms per char when buffer is empty (no lookahead) */
  speedSlow: number;
  /** chars per tick at fast speed */
  batchSizeFast: number;

  // ── Post-reveal phase ──
  /** ms after reveal completes before collapse starts */
  postTypingPause: number;
  /** ms for the CSS collapse animation */
  collapseDuration: number;
  /** ms between segments (after collapse, before next mounts) */
  interSegmentPause: number;

  // ── Behavior flags ──
  /** Skip typing animation entirely — show content at once */
  instantReveal: boolean;
  /** Renderer should jump revealedCount forward to frontier */
  snapToFrontier: boolean;
  /** How many segments to keep animating from the frontier (e.g., 2) */
  snapKeepLive: number;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Tier definitions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const NORMAL: TimingProfile = {
  tier: 'normal',
  shimmerTotal: 400,
  interChunkPause: 80,
  speedFast: 1,
  speedSlow: 6,
  batchSizeFast: 5,
  postTypingPause: 500,
  collapseDuration: 300,
  interSegmentPause: 100,
  instantReveal: false,
  snapToFrontier: false,
  snapKeepLive: 0,
};

const HURRY: TimingProfile = {
  tier: 'hurry',
  shimmerTotal: 200,
  interChunkPause: 40,
  speedFast: 1,
  speedSlow: 3,
  batchSizeFast: 10,
  postTypingPause: 200,
  collapseDuration: 200,
  interSegmentPause: 100,
  instantReveal: false,
  snapToFrontier: false,
  snapKeepLive: 0,
};

const RUSH: TimingProfile = {
  tier: 'rush',
  shimmerTotal: 0,
  interChunkPause: 10,
  speedFast: 1,
  speedSlow: 1,
  batchSizeFast: 20,
  postTypingPause: 50,
  collapseDuration: 100,
  interSegmentPause: 30,
  instantReveal: false,
  snapToFrontier: false,
  snapKeepLive: 0,
};

const AGGRESSIVE: TimingProfile = {
  tier: 'aggressive',
  shimmerTotal: 0,
  interChunkPause: 0,
  speedFast: 1,
  speedSlow: 1,
  batchSizeFast: 50,
  postTypingPause: 0,
  collapseDuration: 50,
  interSegmentPause: 0,
  instantReveal: true,
  snapToFrontier: false,
  snapKeepLive: 0,
};

const SNAP: TimingProfile = {
  tier: 'snap',
  shimmerTotal: 0,
  interChunkPause: 0,
  speedFast: 1,
  speedSlow: 1,
  batchSizeFast: 50,
  postTypingPause: 0,
  collapseDuration: 0,
  interSegmentPause: 0,
  instantReveal: true,
  snapToFrontier: true,
  snapKeepLive: 2,
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Public API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Determine the pressure tier for a given backlog depth. */
export function getPressureTier(backlog: number): PressureTier {
  if (backlog <= 2) return 'normal';
  if (backlog <= 5) return 'hurry';
  if (backlog <= 10) return 'rush';
  if (backlog <= 15) return 'aggressive';
  return 'snap';
}

/**
 * Compute a complete timing profile for the current backlog.
 *
 * Called by LiveSegmentRenderer on every render (via a ref),
 * and by individual segments at each animation pause point.
 * Returns a frozen object — treat as immutable.
 */
export function computeTimingProfile(backlog: number): TimingProfile {
  const tier = getPressureTier(backlog);
  switch (tier) {
    case 'normal': return NORMAL;
    case 'hurry': return HURRY;
    case 'rush': return RUSH;
    case 'aggressive': return AGGRESSIVE;
    case 'snap': return SNAP;
  }
}
