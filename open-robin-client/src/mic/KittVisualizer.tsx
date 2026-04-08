interface KittVisualizerProps {
  audioLevel: number; // 0-1 normalized
}

const barHeight = (level: number) => Math.max(4, 4 + level * 106);

export function KittVisualizer({ audioLevel }: KittVisualizerProps) {
  return (
    <div className="rv-voice-recorder__kitt">
      <div className="rv-voice-recorder__kitt-bar" style={{ height: `${barHeight(audioLevel * 0.8)}px` }} />
      <div className="rv-voice-recorder__kitt-bar" style={{ height: `${barHeight(audioLevel)}px` }} />
      <div className="rv-voice-recorder__kitt-bar" style={{ height: `${barHeight(audioLevel * 0.6)}px` }} />
    </div>
  );
}
