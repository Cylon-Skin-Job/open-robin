import './ConnectingOverlay.css';

interface ConnectingOverlayProps {
  harnessName?: string;
}

export function ConnectingOverlay({ harnessName }: ConnectingOverlayProps) {
  return (
    <div className="connecting-overlay">
      <div className="co-spinner" />
      <span className="co-label">
        {harnessName ? `Connecting to ${harnessName}…` : 'Connecting…'}
      </span>
    </div>
  );
}
