/**
 * Orb — Gatekeeper animation shown before the first token arrives.
 *
 * Invoked once per turn, disposed when content starts streaming.
 * Not part of the chat render pipeline. Completely independent of tool segments.
 *
 * Lifecycle:
 *   mount → expand (1.5s) → breathe (loop) → dispose trigger → collapse (500ms) → onDone
 *
 * The breathing loop handles variable API latency (2-6+ seconds)
 * without looking frozen at full size.
 */

import { useEffect, useRef } from 'react';

interface OrbProps {
  /** Set to true when the first token arrives — triggers disposal */
  disposing: boolean;
  /** Called when the disposal animation completes */
  onDone: () => void;
}

export function Orb({ disposing, onDone }: OrbProps) {
  const disposeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasStartedDispose = useRef(false);

  // Timing instrumentation
  useEffect(() => {
    const t = (window as any).__TIMING;
    if (t) {
      t.orbStartAt = performance.now();
      const sinceS = t.sendAt ? (performance.now() - t.sendAt).toFixed(1) : '?';
      console.log(`[TIMING] ORB START at ${performance.now().toFixed(1)}ms — ${sinceS}ms after send`);
    }

    return () => {
      if (disposeTimerRef.current) clearTimeout(disposeTimerRef.current);
    };
  }, []);

  // When disposing flips to true, start the collapse and fire onDone after 500ms
  useEffect(() => {
    if (!disposing || hasStartedDispose.current) return;
    hasStartedDispose.current = true;

    const t = (window as any).__TIMING;
    if (t) {
      const now = performance.now();
      const sinceSend = t.sendAt ? (now - t.sendAt).toFixed(1) : '?';
      console.log(`[TIMING] ORB DISPOSE START at ${now.toFixed(1)}ms — ${sinceSend}ms after send`);
    }

    disposeTimerRef.current = setTimeout(() => {
      const t = (window as any).__TIMING;
      if (t) {
        t.orbEndAt = performance.now();
        const sinceSend = t.sendAt ? (performance.now() - t.sendAt).toFixed(1) : '?';
        console.log(`[TIMING] ORB END at ${performance.now().toFixed(1)}ms — ${sinceSend}ms after send`);
      }
      onDone();
    }, 500);
  }, [disposing, onDone]);

  // CSS class determines animation state:
  //   blur-sphere         → expand (1.5s) then breathe (loop)
  //   blur-sphere disposing → collapse from current state (500ms)
  const className = `material-symbols-outlined blur-sphere${disposing ? ' disposing' : ''}`;

  return (
    <div style={{ padding: '4px 0' }}>
      <span
        className={className}
        style={{
          fontSize: '16px',
          color: 'var(--theme-primary)',
        }}
      >
        lens_blur
      </span>
    </div>
  );
}
