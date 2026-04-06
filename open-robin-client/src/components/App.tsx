import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { usePanelStore } from '../state/panelStore';
import { applyPanelTheme } from '../lib/panels';
import { useWebSocket } from '../hooks/useWebSocket';
import { ToolsPanel } from './ToolsPanel';
import { Sidebar } from './Sidebar';
import { ChatArea } from './ChatArea';
import { ContentArea } from './ContentArea';
import { Toast } from './Toast';
import { ModalOverlay } from './Modal/ModalOverlay';
import { RobinOverlay } from './Robin/RobinOverlay';
import './App.css';

/**
 * Memoized panel content — only re-renders when its own panel prop changes,
 * NOT when currentPanel changes in the parent. This prevents all 7 panels
 * from re-rendering on every panel switch.
 */
const PanelContent = memo(function PanelContent({ panel, layout }: { panel: string; layout: string }) {
  if (layout === 'full') {
    return <ContentArea panel={panel} />;
  }
  if (layout === 'chat-content') {
    return (
      <>
        <ChatArea panel={panel} />
        <ContentArea panel={panel} />
      </>
    );
  }
  return (
    <>
      <Sidebar panel={panel} />
      <ChatArea panel={panel} />
      <ContentArea panel={panel} />
    </>
  );
});

function App() {
  // WebSocket connection — must run BEFORE the loading gate
  // so discovery can complete and populate configs
  useWebSocket();

  const currentPanel = usePanelStore((state) => state.currentPanel);
  const setCurrentPanel = usePanelStore((state) => state.setCurrentPanel);
  const ws = usePanelStore((state) => state.ws);
  const configs = usePanelStore((state) => state.panelConfigs);
  const getConfig = usePanelStore((state) => state.getPanelConfig);
  const isConnected = ws?.readyState === WebSocket.OPEN;
  const containerRef = useRef<HTMLDivElement>(null);

  const [robinOpen, setRobinOpen] = useState(false);

  const loading = configs.length === 0;

  // Apply panel theme as CSS custom properties
  useEffect(() => {
    const config = getConfig(currentPanel);
    if (config && containerRef.current) {
      applyPanelTheme(containerRef.current, config.theme);
      containerRef.current.style.setProperty('--theme-primary', config.theme.primary);
      const hex = config.theme.primary;
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      containerRef.current.style.setProperty('--theme-primary-rgb', `${r}, ${g}, ${b}`);
      containerRef.current.style.setProperty('--theme-border', `rgba(${r}, ${g}, ${b}, 0.38)`);
      containerRef.current.style.setProperty('--theme-border-glow', `rgba(${r}, ${g}, ${b}, 0.68)`);
    }
  }, [currentPanel, getConfig, configs]);

  // Once discovery completes, set currentPanel to first available if current isn't valid
  useEffect(() => {
    if (configs.length > 0 && !configs.find((c) => c.id === currentPanel)) {
      setCurrentPanel(configs[0].id);
    }
  }, [configs, currentPanel, setCurrentPanel]);

  // Keyboard: Escape defocuses content, Option+Up/Down cycles panels
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      (document.activeElement as HTMLElement)?.blur();
      return;
    }

    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;

    // Skip when typing in an input
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;

    e.preventDefault();
    const ids = configs.map((c) => c.id);
    const idx = ids.indexOf(currentPanel);
    if (idx < 0) return;

    const next = e.key === 'ArrowDown'
      ? ids[(idx + 1) % ids.length]
      : ids[(idx - 1 + ids.length) % ids.length];
    setCurrentPanel(next);
  }, [configs, currentPanel, setCurrentPanel]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (loading) {
    return (
      <div ref={containerRef} className="app-container">
        <header className="header">
          <div className="header-left">
            <button className="menu-btn">
              <span className="material-symbols-outlined">menu</span>
            </button>
            <div className={`connection-status ${isConnected ? 'connected' : ''}`}>
              {isConnected ? 'Connected' : 'Connecting...'}
            </div>
          </div>
          <div className="header-right">
            <button className="robin-icon-btn" onClick={() => setRobinOpen(true)}>
              <span className="material-symbols-outlined">raven</span>
            </button>
          </div>
        </header>
        <div className="panel-container" style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-dim, #555)',
          fontSize: '0.875rem',
        }}>
          Discovering panels...
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="app-container">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <button className="menu-btn">
            <span className="material-symbols-outlined">menu</span>
          </button>
          <div className={`connection-status ${isConnected ? 'connected' : ''}`}>
            {isConnected ? 'Connected' : 'Disconnected'}
          </div>
        </div>

        <div className="header-right">
          <button className="robin-icon-btn" onClick={() => setRobinOpen(true)}>
            <span className="material-symbols-outlined">raven</span>
          </button>
        </div>
      </header>

      {/* Tools Panel */}
      <ToolsPanel
        currentPanel={currentPanel}
        onSwitch={setCurrentPanel}
      />

      {/* Panel Container */}
      <div className="panel-container">
        {configs.map((config) => {
          const layout = config.layout || (config.hasChat ? 'sidebar-chat-content' : 'full');

          return (
            <div
              key={config.id}
              data-panel={config.id}
              className={`panel layout-${layout} ${currentPanel === config.id ? 'active' : ''}`}
            >
              <PanelContent panel={config.id} layout={layout} />
            </div>
          );
        })}
      </div>
      <Toast />
      <ModalOverlay />
      <RobinOverlay open={robinOpen} onClose={() => setRobinOpen(false)} />
    </div>
  );
}

export default App;
