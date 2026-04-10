import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { usePanelStore } from '../state/panelStore';
import { applyPanelTheme } from '../lib/panels';
import { useWebSocket } from '../hooks/useWebSocket';
import { ToolsPanel } from './ToolsPanel';
import { Sidebar } from './Sidebar';
import { ChatArea } from './ChatArea';
import { ContentArea } from './ContentArea';
import { ResizeHandle } from './ResizeHandle';
import { Toast } from './Toast';
import { ModalOverlay } from './Modal/ModalOverlay';
import { RobinOverlay } from './Robin/RobinOverlay';
import { FloatingChat } from './FloatingChat';
import './App.css';

// SPEC-26c-2: defaults for the 3-column layout
const DEFAULT_WIDTHS = { leftSidebar: 220, leftChat: 320 };
const DEFAULT_COLLAPSED = { leftSidebar: false, leftChat: false };

/**
 * Memoized panel content — only re-renders when its own panel prop changes,
 * NOT when currentPanel changes in the parent. This prevents all 7 panels
 * from re-rendering on every panel switch.
 *
 * SPEC-26c-2: right-side view chat removed (SPEC-26d will re-expose it as
 * a floating popup). Layout is now 3 content columns + 2 resize handles.
 */
interface PanelContentProps {
  panel: string;
  hasChat: boolean;
  collapsedSidebar: boolean;
  collapsedChat: boolean;
}
const PanelContent = memo(function PanelContent({ panel, hasChat, collapsedSidebar, collapsedChat }: PanelContentProps) {
  if (!hasChat) {
    return <ContentArea panel={panel} />;
  }
  // SPEC-26c-2: [project sidebar][handle][project chat][handle][content]
  return (
    <>
      <Sidebar panel={panel} scope="project" collapsed={collapsedSidebar} />
      <ResizeHandle panel={panel} pane="leftSidebar" />
      <ChatArea panel={panel} scope="project" collapsed={collapsedChat} />
      <ResizeHandle panel={panel} pane="leftChat" />
      <ContentArea panel={panel} />
    </>
  );
});

/**
 * SPEC-26c-2: PanelWrapper reads viewStates from the store to compute
 * inline CSS variables for the grid and pass collapsed props to children.
 * Extracted so each panel reads only its own slice.
 */
function PanelWrapper({ panelId, hasChat, layoutClass, isActive }: {
  panelId: string;
  hasChat: boolean;
  layoutClass: string;
  isActive: boolean;
}) {
  const viewState = usePanelStore((s) => s.viewStates[panelId]);
  const widths = viewState?.widths ?? DEFAULT_WIDTHS;
  const collapsed = viewState?.collapsed ?? DEFAULT_COLLAPSED;

  const gridStyle: CSSProperties = hasChat ? {
    '--left-sidebar-w': `${collapsed.leftSidebar ? 40 : widths.leftSidebar}px`,
    '--left-chat-w':    `${collapsed.leftChat    ? 40 : widths.leftChat   }px`,
  } as CSSProperties : {};

  return (
    <div
      data-panel={panelId}
      className={`rv-panel ${layoutClass} ${isActive ? 'active' : ''}`}
      style={gridStyle}
    >
      <PanelContent
        panel={panelId}
        hasChat={hasChat}
        collapsedSidebar={collapsed.leftSidebar}
        collapsedChat={collapsed.leftChat}
      />
    </div>
  );
}

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
      <div ref={containerRef} className="rv-app-container">
        <header className="rv-header">
          <div className="rv-header-left">
            <button className="rv-menu-btn">
              <span className="material-symbols-outlined">menu</span>
            </button>
            <div className={`rv-connection-status ${isConnected ? 'connected' : ''}`}>
              {isConnected ? 'Connected' : 'Connecting...'}
            </div>
          </div>
          <div className="rv-header-right">
            <button className="rv-robin-icon-btn" onClick={() => setRobinOpen(true)}>
              <span className="material-symbols-outlined">raven</span>
            </button>
          </div>
        </header>
        <div className="rv-panel-container rv-panel-container--loading">
          Discovering panels...
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="rv-app-container">
      {/* Header */}
      <header className="rv-header">
        <div className="rv-header-left">
          <button className="rv-menu-btn">
            <span className="material-symbols-outlined">menu</span>
          </button>
          <div className={`rv-connection-status ${isConnected ? 'connected' : ''}`}>
            {isConnected ? 'Connected' : 'Disconnected'}
          </div>
        </div>

        <div className="rv-header-right">
          <button className="rv-robin-icon-btn" onClick={() => setRobinOpen(true)}>
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
      <div className="rv-panel-container">
        {configs.map((config) => {
          const hasChat = !!config.hasChat;
          const layoutClass = hasChat ? 'rv-layout-dual-chat' : 'rv-layout-full';

          return (
            <PanelWrapper
              key={config.id}
              panelId={config.id}
              hasChat={hasChat}
              layoutClass={layoutClass}
              isActive={currentPanel === config.id}
            />
          );
        })}
      </div>
      <Toast />
      <ModalOverlay />
      <RobinOverlay open={robinOpen} onClose={() => setRobinOpen(false)} />
      <FloatingChat />
    </div>
  );
}

export default App;
