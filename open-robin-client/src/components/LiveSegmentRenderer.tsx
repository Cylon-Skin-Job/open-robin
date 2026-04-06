/**
 * LiveSegmentRenderer — Two-phase rendering for live streaming turns.
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │ PHASE 1: ORB (gatekeeper)                                  │
 * │                                                             │
 * │ The orb is NOT part of the chat render pipeline.            │
 * │ It runs a fixed 2-second animation (expand → hold →        │
 * │ collapse). When it finishes, it's removed. Only THEN does  │
 * │ Phase 2 begin. This buys 500-800ms of lead time for the    │
 * │ first token to arrive from the API.                         │
 * │                                                             │
 * │ If the API hasn't responded in 2s, we likely have a        │
 * │ connection issue — that's a separate concern.               │
 * ├─────────────────────────────────────────────────────────────┤
 * │ PHASE 2: SEGMENT RENDER                                    │
 * │                                                             │
 * │ Segments animate one at a time:                             │
 * │ 1. ToolCallBlock appears (icon + label shimmer)             │
 * │ 2. Content typing blitz (speed from chunkBuffer)            │
 * │ 3. Post-typing pause                                        │
 * │ 4. Collapse animation                                       │
 * │ 5. Next segment starts                                      │
 * │                                                             │
 * │ Text segments use paragraph/header chunk parsing.           │
 * │ No render engine — self-manages timing.                     │
 * └─────────────────────────────────────────────────────────────┘
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { StreamSegment } from '../types';
import { getToolRenderer } from '../lib/tool-renderers';
import { computeTimingProfile, type TimingProfile } from '../lib/pressure';
import { animateTool } from '../lib/tool-animate';
import { renderTextInstant } from '../lib/text';
import { animateText } from '../lib/text/text-animate';
import { sleep, injectCursor } from '../lib/animate-utils';
import { ToolCallBlock } from './ToolCallBlock';
import { Orb } from './Orb';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN COMPONENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface LiveSegmentRendererProps {
  segments: StreamSegment[];
  onRevealComplete?: () => void;
}

export function LiveSegmentRenderer({ segments, onRevealComplete }: LiveSegmentRendererProps) {
  const [orbDone, setOrbDone] = useState(false);
  const [orbDisposing, setOrbDisposing] = useState(false);
  const [revealedCount, setRevealedCount] = useState(0);
  const prevLenRef = useRef(0);
  const hasTokenRef = useRef(false);

  // ── Phase 1: Watch for first token → trigger orb disposal ──
  useEffect(() => {
    if (hasTokenRef.current || orbDone) return;

    const hasContent = segments.length > 0 && segments[0].content.length > 0;
    if (hasContent) {
      hasTokenRef.current = true;
      setOrbDisposing(true);
    }
  }, [segments, orbDone]);

  const handleOrbDone = useCallback(() => {
    setOrbDone(true);
  }, []);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Phase 2: Sequential segment reveal + completion detection
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //
  // INVARIANT: Segments render ONE AT A TIME. Segment N+1 does
  // not mount until segment N calls onDone. This is enforced by
  // rendering segments.slice(0, revealedCount + 1).
  //
  // INVARIANT: Turn finalization (onRevealComplete → finalizeTurn)
  // fires EXACTLY ONCE, and ONLY when BOTH conditions are true:
  //   1. All segments have been revealed (revealedCount >= segments.length)
  //   2. turn_end has arrived (onRevealComplete is defined)
  //
  // These two events can arrive in EITHER ORDER:
  //   - Stream finishes first → renderer catches up later → effect fires
  //   - Renderer catches up first → turn_end arrives later → effect fires
  //
  // WHY THIS IS AN EFFECT AND NOT IN THE CALLBACK:
  // onSegmentDone is captured by segment components at mount time via
  // useEffect([], ...). If onRevealComplete changes after mount (turn_end
  // arrives mid-animation), the already-mounted segment has a stale closure.
  // An effect watching [revealedCount, segments.length, onRevealComplete]
  // always sees current values — no stale closures possible.
  //
  // KNOWN PAST BUG (DO NOT REINTRODUCE):
  // Checking completion inside onSegmentDone causes a hang when all
  // segments finish BEFORE turn_end arrives. onRevealComplete is undefined
  // at that point, nobody re-triggers the check, turn hangs forever.
  // The effect-based approach re-evaluates on EVERY change to any input.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  const finalizedRef = useRef(false);

  // onSegmentDone: ONLY bumps the counter. No completion logic here.
  // Stable callback — no deps, no stale closure risk. Every mounted
  // segment gets the same function reference.
  const onSegmentDone = useCallback((_index: number) => {
    setRevealedCount(prev => prev + 1);
  }, []);

  // Completion detection: reactive effect, not a callback.
  // Fires whenever revealedCount, segments.length, or onRevealComplete changes.
  useEffect(() => {
    if (finalizedRef.current) return;
    if (!onRevealComplete) return;           // turn_end hasn't arrived yet
    if (segments.length === 0) return;       // no segments to reveal
    if (revealedCount < segments.length) return; // still revealing

    // Both conditions met: all revealed AND turn_end received.
    finalizedRef.current = true;
    onRevealComplete();
  }, [revealedCount, segments.length, onRevealComplete]);

  // Reset on turn change (segments shrink = new turn or thread switch)
  useEffect(() => {
    if (segments.length < prevLenRef.current) {
      setRevealedCount(0);
      finalizedRef.current = false;
      skippedRef.current.clear();
    }
    prevLenRef.current = segments.length;
  }, [segments.length]);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Pressure gauge — backlog-aware timing attenuation
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //
  // backlogRef updates every render with the current distance
  // between the stream frontier and the reveal cursor.
  // getTimingProfile() is a stable function that segments call
  // at each animation pause point to get CURRENT timing values.
  //
  // See lib/pressure.ts for tier definitions and thresholds.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  const backlogRef = useRef(0);
  backlogRef.current = segments.length - revealedCount;

  /** Stable getter — segments call this at each decision point. */
  const getTimingProfile = useCallback((): TimingProfile => {
    return computeTimingProfile(backlogRef.current);
  }, []);


  // Snap-to-frontier: when backlog is hopeless, jump ahead.
  // Skipped segments get skipAnimation=true and render instantly.
  const skippedRef = useRef(new Set<number>());

  useEffect(() => {
    const profile = computeTimingProfile(segments.length - revealedCount);
    if (profile.snapToFrontier && !finalizedRef.current) {
      const target = Math.max(0, segments.length - profile.snapKeepLive);
      if (target > revealedCount) {
        for (let i = 0; i < target; i++) {
          skippedRef.current.add(i);
        }
        setRevealedCount(target);
      }
    }
  }, [segments.length, revealedCount]);

  // ── Render ──

  // Phase 1: Orb is running. Nothing else renders.
  if (!orbDone) {
    return <Orb disposing={orbDisposing} onDone={handleOrbDone} />;
  }

  // Phase 2: Orb is done. Render segments sequentially.
  if (!segments || segments.length === 0) {
    return <div className="message-assistant-content streaming" />;
  }

  // Mount only completed segments + the one currently animating
  const visibleCount = revealedCount + 1;

  return (
    <>
      {segments.slice(0, visibleCount).map((seg, i) => (
        seg.type === 'text' ? (
          <LiveTextSegment
            key={`text-${i}`}
            segment={seg}
            index={i}
            skipAnimation={skippedRef.current.has(i)}
            getTimingProfile={getTimingProfile}
            onDone={onSegmentDone}
          />
        ) : (
          <LiveToolSegment
            key={seg.toolCallId || `seg-${i}`}
            segment={seg}
            index={i}
            skipShimmer={i === 0}
            skipAnimation={skippedRef.current.has(i)}
            getTimingProfile={getTimingProfile}
            onDone={onSegmentDone}
          />
        )
      ))}
    </>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 2 COMPONENTS — Segment renderers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ── Live Text Segment ─────────────────────────────────────────────────

interface LiveTextSegmentProps {
  segment: StreamSegment;
  index: number;
  skipAnimation?: boolean;
  getTimingProfile: () => TimingProfile;
  onDone: (index: number) => void;
}

/**
 * LiveTextSegment — Thin shell. All logic lives in text-animate.ts.
 *
 * Owns React state and refs. Delegates animation to animateText().
 * Display state is HTML (pre-rendered by sub-renderers), not raw markdown.
 */
function LiveTextSegment({ segment, index, skipAnimation, getTimingProfile, onDone }: LiveTextSegmentProps) {
  const [displayedHtml, setDisplayedHtml] = useState('');
  const [, setTyping] = useState(true);
  const animatingRef = useRef(false);
  const contentRef = useRef(segment.content);
  const completeRef = useRef(segment.complete ?? false);
  const cancelRef = useRef(false);

  contentRef.current = segment.content;
  completeRef.current = segment.complete ?? false;

  useEffect(() => {
    if (animatingRef.current) return;
    animatingRef.current = true;

    if (skipAnimation) {
      setDisplayedHtml(renderTextInstant(contentRef.current));
      setTyping(false);
      setTimeout(() => onDone(index), 0);
      return;
    }

    cancelRef.current = false;

    animateText({
      contentRef, completeRef, cancelRef,
      segmentType: segment.type,
      setDisplayedHtml, setTyping, getTimingProfile,
      onDone: () => onDone(index),
    });

    return () => { cancelRef.current = true; };
  }, []);

  return (
    <div
      className="message-assistant-content streaming"
      dangerouslySetInnerHTML={{ __html: displayedHtml }}
    />
  );
}

// ── Live Tool Segment ─────────────────────────────────────────────────

interface LiveToolSegmentProps {
  segment: StreamSegment;
  index: number;
  /** Skip shimmer delay — used for first segment after orb (orb already bridged the wait) */
  skipShimmer?: boolean;
  skipAnimation?: boolean;
  getTimingProfile: () => TimingProfile;
  onDone: (index: number) => void;
}

/**
 * LiveToolSegment — Phase controller for non-text segments.
 *
 * This is ONLY the phase state machine. It does NOT know how to
 * reveal content. It dispatches to a reveal sub-module based on
 * renderMode from the catalog.
 *
 * Phases: shimmer → reveal → collapse → done
 *
 * Timing is dynamic — getTimingProfile() is called at each phase
 * boundary, returning pressure-adjusted values. If the renderer falls
 * behind the stream, pauses compress and reveals accelerate.
 * See lib/pressure.ts for tier definitions.
 */
function LiveToolSegment({ segment, index, skipShimmer, skipAnimation, getTimingProfile, onDone }: LiveToolSegmentProps) {
  const [phase, setPhase] = useState<'shimmer' | 'revealing' | 'collapsing' | 'done'>('shimmer');
  const [expanded, setExpanded] = useState(true);
  const [displayedContent, setDisplayedContent] = useState('');
  const animatingRef = useRef(false);
  const contentRef = useRef(segment.content);
  const completeRef = useRef(segment.complete ?? false);
  const cancelRef = useRef(false);
  const collapseMsRef = useRef(300); // synced with ToolCallBlock CSS transition

  contentRef.current = segment.content;
  completeRef.current = segment.complete ?? false;

  useEffect(() => {
    if (animatingRef.current) return;
    animatingRef.current = true;
    cancelRef.current = false;

    // ── Skipped segments render instantly (snap-to-frontier) ──
    if (skipAnimation) {
      setDisplayedContent(contentRef.current);
      setPhase('done');
      setExpanded(false);
      setTimeout(() => onDone(index), 0);
      return;
    }

    // ── TIMING: Log when this segment's animate() fires ──
    const t = (window as any).__TIMING;
    const mountAt = performance.now();
    if (t) {
      const sinceSend = t.sendAt ? (mountAt - t.sendAt).toFixed(1) : '?';
      const sinceOrbEnd = t.orbEndAt ? (mountAt - t.orbEndAt).toFixed(1) : 'orb not ended?';
      const sinceFirst = t.firstTokenAt ? (mountAt - t.firstTokenAt).toFixed(1) : 'no token yet';
      console.log(`[TIMING] RENDER SIGNAL (${segment.type} #${index}) at ${mountAt.toFixed(1)}ms — ${sinceSend}ms after send — ${sinceOrbEnd}ms after orb end — ${sinceFirst}ms after first token — content length: ${contentRef.current.length}`);
    }

    const animate = async () => {
      // Phase 1: Shimmer — query pressure NOW
      if (!skipShimmer) {
        const p = getTimingProfile();
        if (p.shimmerTotal > 0) {
          await sleep(p.shimmerTotal);
          if (cancelRef.current) return;
        }
      }

      // Phase 2: Reveal — dispatched to tool-animate.ts (Level 2b controller).
      // The catalog determines strategy, transform, renderer, speed, and
      // whether to hold for tool result. See lib/catalog.ts.
      setPhase('revealing');
      if (t) {
        const revealAt = performance.now();
        const sinceSend = t.sendAt ? (revealAt - t.sendAt).toFixed(1) : '?';
        console.log(`[TIMING] REVEAL START (${segment.type} #${index}) at ${revealAt.toFixed(1)}ms — ${sinceSend}ms after send`);
      }
      await animateTool({
        contentRef, completeRef, cancelRef,
        segmentType: segment.type,
        toolArgs: segment.toolArgs,
        setDisplayedContent,
        getTimingProfile,
        onDone: () => {},  // collapse phase handles the real onDone
      });
      if (cancelRef.current) return;

      // Phase 3: Collapse. The reveal is done — content has been
      // shown. Collapse immediately. The sequential gating
      // (revealedCount) ensures the next segment mounts after
      // this one calls onDone.
      setPhase('collapsing');
      const collapseProfile = getTimingProfile();
      collapseMsRef.current = collapseProfile.collapseDuration;
      if (collapseProfile.postTypingPause > 0) await sleep(collapseProfile.postTypingPause);
      setExpanded(false);
      if (collapseProfile.collapseDuration > 0) await sleep(collapseProfile.collapseDuration);

      // Brief gap then mount next — 100ms feels back-to-back
      setPhase('done');
      await sleep(100);
      onDone(index);
    };

    animate();
    return () => { cancelRef.current = true; };
  }, []);

  const renderer = getToolRenderer(segment.type);

  return (
    <ToolCallBlock
      type={segment.type}
      label={renderer.buildTitle(1, segment.toolArgs)}
      toolArgs={segment.toolArgs}
      isError={segment.isError}
      expanded={expanded}
      onToggle={() => setExpanded(!expanded)}
      shimmer={phase === 'shimmer' || phase === 'revealing'}
      collapseDuration={collapseMsRef.current}
    >
      {displayedContent && (
        <div
          style={renderer.contentStyle}
          dangerouslySetInnerHTML={{
            __html: phase === 'revealing' && renderer.showCursor
              ? injectCursor(renderer.formatContent(displayedContent, segment.toolArgs))
              : renderer.formatContent(displayedContent, segment.toolArgs),
          }}
        />
      )}
    </ToolCallBlock>
  );
}

