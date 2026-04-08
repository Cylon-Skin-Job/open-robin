/**
 * @module RobinOverlay
 * @role Full-screen system panel overlay
 *
 * Open Robin sits above workspaces as the system supervisor.
 * Chat on the left, tabbed settings with list/detail split on the right.
 *
 * All data (tabs, items, wiki content, CLI registry) comes from robin.db
 * via WebSocket. Nothing is hardcoded — add a tab to the database and it
 * appears here automatically.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { sendRobinMessage, onRobinMessage } from '../../lib/ws-client';
import { WikiDetail } from './WikiDetail';
import { ConfigDetail } from './ConfigDetail';
import { CLIDetail, CLIRegistry } from './CLIDetail';
import { SystemThemeDetail, WorkspaceThemeDetail } from './ThemeDetail';
import type { Tab, WikiPage, ConfigItem, CliItem, SystemTheme, WorkspaceItem } from './robin-types';
import './robin.css';

// --- Types ---

interface RobinOverlayProps {
  open: boolean;
  onClose: () => void;
}

// --- Chat messages (placeholder until Robin's wire is connected) ---

const CHAT_MESSAGES = [
  { type: 'system' as const, text: 'Session started' },
  { type: 'robin' as const, text: 'Hey! Everything\u2019s running smoothly. Two conversations are open and your agents are idle. What can I help with?' },
  { type: 'user' as const, text: 'How do the safety settings work?' },
  { type: 'robin' as const, text: 'Great question. Your AI assistants can\u2019t change their own settings \u2014 only you can. When an AI wants to suggest new configuration, it creates a draft and you get a visual approval screen. You drag the file to accept, or just close it to reject. I\u2019ve pulled up the details for you \u2192' },
  { type: 'system' as const, text: 'Viewing: Settings Protection' },
];

// --- Main component ---

export function RobinOverlay({ open, onClose }: RobinOverlayProps) {
  // Data from robin.db
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [items, setItems] = useState<(ConfigItem | CliItem)[]>([]);
  const [wikiPage, setWikiPage] = useState<WikiPage | null>(null);
  const [registryItems, setRegistryItems] = useState<CliItem[]>([]);

  // UI state
  const [activeTab, setActiveTab] = useState('');
  const [selectedItemId, setSelectedItemId] = useState('');
  const [showRegistry, setShowRegistry] = useState(false);
  const initializedRef = useRef(false);

  // Customization state
  const [systemTheme, setSystemTheme] = useState<SystemTheme | null>(null);
  const [workspacesList, setWorkspacesList] = useState<WorkspaceItem[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');

  // Wiki context toggle
  const [showContext, setShowContext] = useState(false);

  // Escape key
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [open, handleKeyDown]);

  // Subscribe to robin: messages
  useEffect(() => {
    const unsubs = [
      onRobinMessage('robin:tabs', (msg: any) => {
        setTabs(msg.tabs || []);
        // On first load, activate the first tab
        if (!initializedRef.current && msg.tabs?.length > 0) {
          initializedRef.current = true;
          const firstTab = msg.tabs[0].id;
          setActiveTab(firstTab);
          sendRobinMessage({ type: 'robin:tab-items', tab: firstTab });
          sendRobinMessage({ type: 'robin:wiki-page', slug: firstTab });
        }
      }),
      onRobinMessage('robin:items', (msg: any) => {
        setItems(msg.items || []);
        // For CLIs tab, separate installed from registry
        if (msg.tab === 'clis') {
          const installed = (msg.items || []).filter((i: CliItem) => i.installed);
          const notInstalled = (msg.items || []).filter((i: CliItem) => !i.installed);
          setItems(installed);
          setRegistryItems(notInstalled);
        }
      }),
      onRobinMessage('robin:wiki', (msg: any) => {
        if (!msg.error) {
          setWikiPage(msg as WikiPage);
        }
      }),
      onRobinMessage('robin:theme-data', (msg: any) => {
        if (!msg.error) {
          setSystemTheme(msg.systemTheme || null);
          setWorkspacesList(msg.workspaces || []);
        }
      }),
    ];
    return () => unsubs.forEach(fn => fn());
  }, []);

  // Fetch tabs when panel opens
  useEffect(() => {
    if (open) {
      initializedRef.current = false;
      sendRobinMessage({ type: 'robin:tabs' });
    }
  }, [open]);

  if (!open) return null;

  // Derive sections from config items (non-CLI tabs)
  const configItems = items as ConfigItem[];
  const sectionNames = [...new Set(configItems.map(s => s.section).filter(Boolean))];

  const currentTab = tabs.find(t => t.id === activeTab);

  // Determine right panel content
  const selectedItem = items.find((s: any) => (s.key || s.id) === selectedItemId);

  function switchTab(tabId: string) {
    setActiveTab(tabId);
    setSelectedItemId('');
    setSelectedWorkspaceId('');
    setShowRegistry(false);
    setShowContext(false);
    setWikiPage(null);
    setItems([]);
    if (tabId === 'customization') {
      sendRobinMessage({ type: 'robin:theme-load' });
      sendRobinMessage({ type: 'robin:wiki-page', slug: tabId });
    } else {
      sendRobinMessage({ type: 'robin:tab-items', tab: tabId });
      sendRobinMessage({ type: 'robin:wiki-page', slug: tabId });
    }
    sendRobinMessage({ type: 'robin:context', tab: tabId, item: null });
  }

  function selectItem(id: string) {
    setSelectedItemId(id);
    setShowRegistry(false);
    setShowContext(false);
    sendRobinMessage({ type: 'robin:context', tab: activeTab, item: id });
  }

  function openRegistry() {
    setShowRegistry(true);
    setSelectedItemId('');
  }

  return (
    <div className="rv-robin-overlay">
      {/* Header */}
      <div className="rv-robin-overlay-header">
        <div className="rv-robin-overlay-header-left">
          <span className="material-symbols-outlined rv-robin-overlay-header-icon">raven</span>
          <span className="rv-robin-overlay-header-name">Open Robin</span>
          <span className="rv-robin-overlay-header-subtitle">System Panel</span>
        </div>
        <button className="rv-robin-exit-btn" onClick={onClose}>
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>

      {/* Body: Chat | Settings */}
      <div className="rv-robin-overlay-body">

        {/* LEFT: Chat */}
        <div className="rv-robin-chat">
          <div className="rv-robin-chat-messages">
            {CHAT_MESSAGES.map((msg, i) => {
              if (msg.type === 'system') {
                return <div key={i} className="rv-robin-msg-system">{msg.text}</div>;
              }
              if (msg.type === 'user') {
                return (
                  <div key={i} className="rv-robin-msg-user">
                    <div className="rv-robin-msg-bubble" dangerouslySetInnerHTML={{ __html: msg.text }} />
                  </div>
                );
              }
              return (
                <div key={i} className="rv-robin-msg-robin">
                  <div className="rv-robin-msg-avatar">
                    <span className="material-symbols-outlined">raven</span>
                  </div>
                  <div className="rv-robin-msg-bubble" dangerouslySetInnerHTML={{ __html: msg.text }} />
                </div>
              );
            })}
          </div>
          <div className="rv-robin-chat-input">
            <textarea rows={2} placeholder="Ask Open Robin anything..." />
          </div>
        </div>

        {/* RIGHT: Settings */}
        <div className="rv-robin-settings">

          {/* Tab header */}
          {currentTab && (
            <div className="rv-robin-settings-header">
              <div className="rv-robin-settings-header-info">
                <div className="rv-robin-settings-header-title">
                  <span className="material-symbols-outlined">{currentTab.icon}</span>
                  {currentTab.label}
                </div>
                <div className="rv-robin-settings-header-desc">
                  {currentTab.description}
                </div>
              </div>
            </div>
          )}

          {/* Tab bar */}
          <div className="rv-robin-settings-tabs">
            {tabs.map(tab => (
              <button
                key={tab.id}
                className={`rv-robin-settings-tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => switchTab(tab.id)}
              >
                <span className="material-symbols-outlined">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Split: list + detail */}
          <div className="rv-robin-settings-split">

            {/* Settings list */}
            <div className="rv-robin-settings-list">

              {/* Guide link — always at top, returns right panel to wiki */}
              <div
                className={`rv-robin-guide-link ${!selectedItemId && !selectedWorkspaceId && !showRegistry ? 'active' : ''}`}
                onClick={() => { setSelectedItemId(''); setSelectedWorkspaceId(''); setShowRegistry(false); }}
              >
                <span className="material-symbols-outlined">menu_book</span>
                {currentTab?.label} Guide
              </div>

              <div className="rv-robin-list-separator" />

              {activeTab === 'customization' ? (
                // Customization tab: system theme + workspace list
                <>
                  <div className="rv-robin-settings-section-divider">System</div>
                  <div
                    className={`rv-robin-setting-item ${selectedWorkspaceId === 'system' ? 'active' : ''}`}
                    onClick={() => { setSelectedWorkspaceId('system'); setSelectedItemId(''); }}
                  >
                    <div className="rv-robin-setting-item-icon">
                      <span className="material-symbols-outlined">settings</span>
                    </div>
                    <div className="rv-robin-setting-item-text">
                      <div className="rv-robin-setting-item-name">System Theme</div>
                      <div className="rv-robin-setting-item-desc">Baseline for all workspaces</div>
                    </div>
                    {systemTheme && (
                      <div className="rv-robin-workspace-dot" style={{ background: systemTheme.primary_color }} />
                    )}
                  </div>

                  <div className="rv-robin-settings-section-divider">Workspaces</div>
                  {workspacesList.filter(w => w.id !== 'system').map(ws => (
                    <div
                      key={ws.id}
                      className={`rv-robin-setting-item ${selectedWorkspaceId === ws.id ? 'active' : ''}`}
                      onClick={() => { setSelectedWorkspaceId(ws.id); setSelectedItemId(''); }}
                    >
                      <div className="rv-robin-setting-item-icon">
                        <span className="material-symbols-outlined">{ws.icon}</span>
                      </div>
                      <div className="rv-robin-setting-item-text">
                        <div className="rv-robin-setting-item-name">{ws.label}</div>
                        <div className="rv-robin-setting-item-desc">{ws.description}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div className="rv-robin-workspace-dot" style={{ background: ws.primary_color }} />
                        <span className={`rv-robin-setting-item-badge ${ws.themeState === 'override' ? 'value' : 'off'}`}>
                          {ws.themeState}
                        </span>
                      </div>
                    </div>
                  ))}
                </>
              ) : activeTab === 'clis' ? (
                // CLIs tab: show installed CLIs as flat list
                <>
                  {(items as CliItem[]).map(cli => (
                    <div
                      key={cli.id}
                      className={`rv-robin-setting-item ${selectedItemId === cli.id && !showRegistry ? 'active' : ''}`}
                      onClick={() => selectItem(cli.id)}
                    >
                      <div className="rv-robin-setting-item-icon">
                        <span className="material-symbols-outlined">terminal</span>
                      </div>
                      <div className="rv-robin-setting-item-text">
                        <div className="rv-robin-setting-item-name">{cli.name}</div>
                        <div className="rv-robin-setting-item-desc">{cli.description}</div>
                      </div>
                      <span className={`rv-robin-setting-item-badge ${cli.active ? 'on' : 'off'}`}>
                        {cli.active ? 'active' : 'installed'}
                      </span>
                    </div>
                  ))}
                </>
              ) : activeTab === 'system-wiki' ? (
                // System wiki: simple index links
                <div className="rv-robin-wiki-index">
                  {configItems.map(item => (
                    <div
                      key={item.key}
                      className={`rv-robin-wiki-index-item ${selectedItemId === item.key ? 'active' : ''}`}
                      onClick={() => {
                        setSelectedItemId(item.key);
                        setShowContext(false);
                        if (item.wiki_slug) {
                          sendRobinMessage({ type: 'robin:wiki-page', slug: item.wiki_slug });
                        }
                        sendRobinMessage({ type: 'robin:context', tab: activeTab, item: item.key });
                      }}
                    >
                      <span className="rv-robin-wiki-index-title">{item.key.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).replace(/\bCli\b/g, 'CLI').replace(/\bAi\b/g, 'AI').replace(/\bApi\b/g, 'API').replace(/\bLlm\b/g, 'LLM')}</span>
                      <span className="rv-robin-wiki-index-desc">{item.description}</span>
                    </div>
                  ))}
                </div>
              ) : (
                // Other tabs: group by section
                sectionNames.map(section => (
                  <div key={section}>
                    <div className="rv-robin-settings-section-divider">{section}</div>
                    {configItems.filter(s => s.section === section).map(item => (
                      <div
                        key={item.key}
                        className={`rv-robin-setting-item ${selectedItemId === item.key && !showRegistry ? 'active' : ''}`}
                        onClick={() => selectItem(item.key)}
                      >
                        <div className="rv-robin-setting-item-icon">
                          <span className="material-symbols-outlined">{item.icon}</span>
                        </div>
                        <div className="rv-robin-setting-item-text">
                          <div className="rv-robin-setting-item-name">{item.key.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</div>
                          <div className="rv-robin-setting-item-desc">{item.description}</div>
                        </div>
                        <span className={`rv-robin-setting-item-badge ${item.value === 'true' ? 'on' : 'value'}`}>
                          {item.value === 'true' ? 'on' : item.value}
                        </span>
                      </div>
                    ))}
                  </div>
                ))
              )}

              {/* Add button — CLIs and LLM Providers tabs */}
              {activeTab === 'clis' && (
                <button
                  className={`rv-robin-add-btn ${showRegistry ? 'active' : ''}`}
                  onClick={openRegistry}
                >
                  <span className="material-symbols-outlined">add</span>
                  Add CLI
                </button>
              )}
              {activeTab === 'llm-providers' && (
                <button
                  className={`rv-robin-add-btn ${showRegistry ? 'active' : ''}`}
                  onClick={openRegistry}
                >
                  <span className="material-symbols-outlined">add</span>
                  Add Provider
                </button>
              )}
            </div>

            {/* Right panel: wiki, item detail, registry, or customization */}
            <div className="rv-robin-detail">
              <div className="rv-robin-detail-scroll">
                {activeTab === 'customization' && selectedWorkspaceId ? (
                  selectedWorkspaceId === 'system' ? (
                    <SystemThemeDetail
                      theme={systemTheme}
                      onUpdate={(preset, color) => sendRobinMessage({ type: 'robin:theme-update-system', preset, primary_color: color })}
                    />
                  ) : (
                    <WorkspaceThemeDetail
                      workspace={workspacesList.find(w => w.id === selectedWorkspaceId)!}
                      onUpdateColor={(color) => sendRobinMessage({ type: 'robin:theme-update-workspace', workspace_id: selectedWorkspaceId, primary_color: color })}
                      onInherit={() => sendRobinMessage({ type: 'robin:theme-inherit', workspace_id: selectedWorkspaceId })}
                      onApply={() => sendRobinMessage({ type: 'robin:theme-apply-diverged', workspace_id: selectedWorkspaceId })}
                    />
                  )
                ) : showRegistry && activeTab === 'clis' ? (
                  <CLIRegistry items={registryItems} />
                ) : selectedItem && activeTab !== 'system-wiki' ? (
                  activeTab === 'clis' ? (
                    <CLIDetail cli={selectedItem as CliItem} />
                  ) : (
                    <ConfigDetail item={selectedItem as ConfigItem} tabLabel={currentTab?.label || ''} />
                  )
                ) : wikiPage ? (
                  <WikiDetail page={wikiPage} showContext={showContext} onToggleContext={() => setShowContext(!showContext)} />
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
