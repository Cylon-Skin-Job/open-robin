import { usePanelStore } from '../state/panelStore';

interface ToolsPanelProps {
  currentPanel: string;
  onSwitch: (id: string) => void;
}

export function ToolsPanel({ currentPanel, onSwitch }: ToolsPanelProps) {
  const configs = usePanelStore((s) => s.panelConfigs);

  return (
    <nav className="rv-tools-panel">
      {configs.map((config) => (
        <button
          key={config.id}
          className={`rv-tool-btn ${currentPanel === config.id ? 'active' : ''}`}
          onClick={() => onSwitch(config.id)}
          title={config.name}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '24px' }}>
            {config.icon}
          </span>
        </button>
      ))}
    </nav>
  );
}
