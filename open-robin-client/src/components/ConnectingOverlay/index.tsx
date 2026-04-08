import './ConnectingOverlay.css';

interface ConnectingOverlayProps {
  harnessName?: string;
}

export function ConnectingOverlay({ harnessName }: ConnectingOverlayProps) {
  return (
    <div className="rv-connecting-overlay">
      <div className="rv-co-spinner" />
      <span className="rv-co-label">
        {harnessName ? `Connecting to ${harnessName}…` : 'Connecting…'}
      </span>
    </div>
  );
}
