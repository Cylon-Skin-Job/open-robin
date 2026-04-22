import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { usePanelStore } from '../state/panelStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { applyPanelTheme } from '../lib/panels';
import { useWebSocket } from '../hooks/useWebSocket';
import { useSharedWorkspaceStyles } from '../hooks/useSharedWorkspaceStyles';
import { ToolsPanel } from './ToolsPanel';
import { Sidebar } from './Sidebar';
import { ChatArea } from './ChatArea';
import { ContentArea } from './ContentArea';
import { LeftSidebarResize, LeftChatResize } from './ResizeHandle';
import { Toast } from './Toast';
import { ModalOverlay } from './Modal/ModalOverlay';
import { RobinOverlay } from './Robin/RobinOverlay';
import { SecondaryChat, SecondaryChatSticky } from './SecondaryChat';
import { SecondaryDockButton } from './SecondaryDockButton';
import { EmptyStateView } from './EmptyStateView';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { WorkspaceAddModal } from './WorkspaceAddModal';
import './App.css';

// SPEC-26c-2: defaults for the 3-column layout
const DEFAULT_WIDTHS = { leftSidebar: 220, leftChat: 320 };
const DEFAULT_COLLAPSED = { leftSidebar: false, leftChat: false };
// TINTS_SPEC §8c: all-off fallback when viewState hasn't loaded yet.
const DEFAULT_TINTS = {
  leftPanel:  false,
  rightPanel: false,
  cards:      false,
  borders: { threads: false, chat: false },
};

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
  secondarySticky: boolean;
}
const PanelContent = memo(function PanelContent({ panel, hasChat, collapsedSidebar, collapsedChat, secondarySticky }: PanelContentProps) {
  if (!hasChat) {
    return <ContentArea panel={panel} />;
  }
  // SPEC-26c-2: [project sidebar][handle][project chat][handle][content]
  // SECONDARY_CHAT_SPEC §7c: when secondary is sticky-right, it overlays
  // the view's right column via absolute positioning + z-index. Grid stays
  // at 5 tracks; sticky chat sits on top of the existing content.
  return (
    <>
      <Sidebar panel={panel} scope="project" collapsed={collapsedSidebar} />
      <LeftSidebarResize panel={panel} />
      <ChatArea panel={panel} scope="project" collapsed={collapsedChat} sidebarCollapsed={collapsedSidebar} />
      <LeftChatResize panel={panel} />
      <ContentArea panel={panel} />
      {secondarySticky && <SecondaryChatSticky />}
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
  const secondaryMode = usePanelStore((s) => s.secondary?.mode ?? null);
  const widths = viewState?.widths ?? DEFAULT_WIDTHS;
  const collapsed = viewState?.collapsed ?? DEFAULT_COLLAPSED;
  const tints = viewState?.tints ?? DEFAULT_TINTS;

  // Only the active panel renders the sticky secondary (one grid track
  // at a time; the popup persists state across panel switches but the
  // column is painted in whichever panel is currently active).
  const secondarySticky = isActive && secondaryMode === 'sticky-right';
  // When sticky chat is docked, the shared --right-col-w follows the chat
  // width so the file tree visually matches. When undocked, it reverts to
  // the view's own right-column width (widths.rightCol), so the file tree
  // is never stuck at the chat's docked width after the user hits green.
  const rightColWidth = secondarySticky
    ? (widths.rightSecondary ?? 300)
    : (widths.rightCol ?? 220);

  const gridStyle: CSSProperties = hasChat ? {
    '--left-sidebar-w':   `${collapsed.leftSidebar ? 0 : widths.leftSidebar}px`,
    '--left-chat-w':      `${collapsed.leftChat    ? 40 : widths.leftChat   }px`,
    '--right-col-w':      `${rightColWidth}px`,
  } as CSSProperties : {};

  const panelClasses = [
    'rv-panel',
    layoutClass,
    isActive ? 'active' : '',
    secondarySticky ? 'rv-panel--secondary-sticky' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      data-panel={panelId}
      data-secondary-sticky={secondarySticky ? 'true' : undefined}
      data-tint-left={tints.leftPanel ? 'true' : undefined}
      data-tint-right={tints.rightPanel ? 'true' : undefined}
      data-tint-cards={tints.cards ? 'true' : undefined}
      data-tint-border-threads={tints.borders.threads ? 'true' : undefined}
      data-tint-border-chat={tints.borders.chat ? 'true' : undefined}
      className={panelClasses}
      style={gridStyle}
    >
      <PanelContent
        panel={panelId}
        hasChat={hasChat}
        collapsedSidebar={collapsed.leftSidebar}
        collapsedChat={collapsed.leftChat}
        secondarySticky={secondarySticky}
      />
    </div>
  );
}

function App() {
  // WebSocket connection — must run BEFORE the loading gate
  // so discovery can complete and populate configs
  useWebSocket();
  // Load themes + components + views CSS from the active workspace at runtime
  useSharedWorkspaceStyles();

  const currentPanel = usePanelStore((state) => state.currentPanel);
  const setCurrentPanel = usePanelStore((state) => state.setCurrentPanel);
  const ws = usePanelStore((state) => state.ws);
  const configs = usePanelStore((state) => state.panelConfigs);
  const getConfig = usePanelStore((state) => state.getPanelConfig);
  const isConnected = ws?.readyState === WebSocket.OPEN;
  const containerRef = useRef<HTMLDivElement>(null);

  const [robinOpen, setRobinOpen] = useState(false);

  const hasReceivedWorkspaceInit = useWorkspaceStore((s) => s.hasReceivedInit);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  const toggleSwitcher = useCallback(() => {
    const s = useWorkspaceStore.getState();
    if (s.isSwitcherOpen) s.closeSwitcher();
    else s.openSwitcher();
  }, []);

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

  // Waiting for workspace:init from server. Brief flash on first connect.
  if (isConnected && !hasReceivedWorkspaceInit) {
    return null;
  }

  // No active workspace — render the empty-state tile, but keep the
  // switcher and add-modal mounted so the user can add one.
  if (hasReceivedWorkspaceInit && activeWorkspaceId === null) {
    return (
      <div ref={containerRef} className="rv-app-container">
        <header className="rv-header">
          <div className="rv-header-left">
            <button className="rv-menu-btn" onClick={toggleSwitcher}>
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
        <EmptyStateView />
        <WorkspaceSwitcher />
        <WorkspaceAddModal />
        <ModalOverlay />
      </div>
    );
  }

  if (loading) {
    return (
      <div ref={containerRef} className="rv-app-container">
        <header className="rv-header">
          <div className="rv-header-left">
            <button className="rv-menu-btn" onClick={toggleSwitcher}>
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
        <WorkspaceSwitcher />
        <WorkspaceAddModal />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="rv-app-container">
      {/* Header */}
      <header className="rv-header">
        <div className="rv-header-left">
          <button className="rv-menu-btn" onClick={toggleSwitcher}>
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
      <SecondaryChat />
      <SecondaryDockButton />
      <WorkspaceSwitcher />
      <WorkspaceAddModal />
    </div>
  );
}

export default App;
