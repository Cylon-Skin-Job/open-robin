import type { ReactNode } from 'react';

interface CountdownRingProps {
  timeLeft: number;
  maxDuration: number;
  circumference: number;
  children?: ReactNode;
}

export function CountdownRing({ timeLeft, maxDuration, circumference, children }: CountdownRingProps) {
  const progress = ((maxDuration - timeLeft) / maxDuration) * 100;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  return (
    <div className="rv-voice-recorder__ring-container">
      <svg className="rv-voice-recorder__ring" viewBox="0 0 100 100">
        <circle className="rv-voice-recorder__ring-bg" cx="50" cy="50" r="45" />
        <circle
          className="rv-voice-recorder__ring-fill"
          cx="50"
          cy="50"
          r="45"
          style={{
            strokeDasharray: circumference,
            strokeDashoffset,
            transition: 'stroke-dashoffset 1s linear'
          }}
        />
      </svg>
      {children}
    </div>
  );
}
