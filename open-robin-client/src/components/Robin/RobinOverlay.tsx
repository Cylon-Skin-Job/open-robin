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
import { markdownToHtml } from '../../lib/transforms/markdown';
import './robin.css';

// --- Types ---

interface RobinOverlayProps {
  open: boolean;
  onClose: () => void;
}

interface Tab {
  id: string;
  label: string;
  icon: string;
  description: string;
  sort_order: number;
}

interface WikiPage {
  slug: string;
  title: string;
  content: string;
  context?: string;
  description?: string;
  tab?: string;
}

interface ConfigItem {
  key: string;
  value: string;
  tab: string;
  section: string;
  icon: string;
  description: string;
  wiki_slug?: string;
  sort_order: number;
}

interface CliItem {
  id: string;
  name: string;
  author: string;
  description: string;
  version?: string;
  pricing_url?: string;
  docs_url?: string;
  installed: number;
  active: number;
  sort_order: number;
}

interface SystemTheme {
  preset: string;
  primary_color: string;
  primary_rgb: string;
  theme_css: string;
}

interface WorkspaceItem {
  id: string;
  label: string;
  icon: string;
  description: string;
  themeState: 'inheriting' | 'custom' | 'diverged';
  primary_color: string;
}

const COLOR_SWATCHES = [
  { name: 'Sky',      hex: '#4fc3f7' },
  { name: 'Teal',     hex: '#4dd0c7' },
  { name: 'Lavender', hex: '#9fa8da' },
  { name: 'Sage',     hex: '#81c784' },
  { name: 'Peach',    hex: '#f0a07a' },
  { name: 'Steel',    hex: '#90a4ae' },
  { name: 'Lilac',    hex: '#b39ddb' },
  { name: 'Ice',      hex: '#80deea' },
];

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
    <div className="robin-overlay">
      {/* Header */}
      <div className="robin-overlay-header">
        <div className="robin-overlay-header-left">
          <span className="material-symbols-outlined robin-overlay-header-icon">raven</span>
          <span className="robin-overlay-header-name">Open Robin</span>
          <span className="robin-overlay-header-subtitle">System Panel</span>
        </div>
        <button className="robin-exit-btn" onClick={onClose}>
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>

      {/* Body: Chat | Settings */}
      <div className="robin-overlay-body">

        {/* LEFT: Chat */}
        <div className="robin-chat">
          <div className="robin-chat-messages">
            {CHAT_MESSAGES.map((msg, i) => {
              if (msg.type === 'system') {
                return <div key={i} className="robin-msg-system">{msg.text}</div>;
              }
              if (msg.type === 'user') {
                return (
                  <div key={i} className="robin-msg-user">
                    <div className="robin-msg-bubble" dangerouslySetInnerHTML={{ __html: msg.text }} />
                  </div>
                );
              }
              return (
                <div key={i} className="robin-msg-robin">
                  <div className="robin-msg-avatar">
                    <span className="material-symbols-outlined">raven</span>
                  </div>
                  <div className="robin-msg-bubble" dangerouslySetInnerHTML={{ __html: msg.text }} />
                </div>
              );
            })}
          </div>
          <div className="robin-chat-input">
            <textarea rows={2} placeholder="Ask Open Robin anything..." />
          </div>
        </div>

        {/* RIGHT: Settings */}
        <div className="robin-settings">

          {/* Tab header */}
          {currentTab && (
            <div className="robin-settings-header">
              <div className="robin-settings-header-info">
                <div className="robin-settings-header-title">
                  <span className="material-symbols-outlined">{currentTab.icon}</span>
                  {currentTab.label}
                </div>
                <div className="robin-settings-header-desc">
                  {currentTab.description}
                </div>
              </div>
            </div>
          )}

          {/* Tab bar */}
          <div className="robin-settings-tabs">
            {tabs.map(tab => (
              <button
                key={tab.id}
                className={`robin-settings-tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => switchTab(tab.id)}
              >
                <span className="material-symbols-outlined">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Split: list + detail */}
          <div className="robin-settings-split">

            {/* Settings list */}
            <div className="robin-settings-list">

              {/* Guide link — always at top, returns right panel to wiki */}
              <div
                className={`robin-guide-link ${!selectedItemId && !selectedWorkspaceId && !showRegistry ? 'active' : ''}`}
                onClick={() => { setSelectedItemId(''); setSelectedWorkspaceId(''); setShowRegistry(false); }}
              >
                <span className="material-symbols-outlined">menu_book</span>
                {currentTab?.label} Guide
              </div>

              <div className="robin-list-separator" />

              {activeTab === 'customization' ? (
                // Customization tab: system theme + workspace list
                <>
                  <div className="robin-settings-section-divider">System</div>
                  <div
                    className={`robin-setting-item ${selectedWorkspaceId === 'system' ? 'active' : ''}`}
                    onClick={() => { setSelectedWorkspaceId('system'); setSelectedItemId(''); }}
                  >
                    <div className="robin-setting-item-icon">
                      <span className="material-symbols-outlined">settings</span>
                    </div>
                    <div className="robin-setting-item-text">
                      <div className="robin-setting-item-name">System Theme</div>
                      <div className="robin-setting-item-desc">Baseline for all workspaces</div>
                    </div>
                    {systemTheme && (
                      <div className="robin-workspace-dot" style={{ background: systemTheme.primary_color }} />
                    )}
                  </div>

                  <div className="robin-settings-section-divider">Workspaces</div>
                  {workspacesList.filter(w => w.id !== 'system').map(ws => (
                    <div
                      key={ws.id}
                      className={`robin-setting-item ${selectedWorkspaceId === ws.id ? 'active' : ''}`}
                      onClick={() => { setSelectedWorkspaceId(ws.id); setSelectedItemId(''); }}
                    >
                      <div className="robin-setting-item-icon">
                        <span className="material-symbols-outlined">{ws.icon}</span>
                      </div>
                      <div className="robin-setting-item-text">
                        <div className="robin-setting-item-name">{ws.label}</div>
                        <div className="robin-setting-item-desc">{ws.description}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div className="robin-workspace-dot" style={{ background: ws.primary_color }} />
                        <span className={`robin-setting-item-badge ${ws.themeState === 'diverged' ? 'value' : 'off'}`}>
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
                      className={`robin-setting-item ${selectedItemId === cli.id && !showRegistry ? 'active' : ''}`}
                      onClick={() => selectItem(cli.id)}
                    >
                      <div className="robin-setting-item-icon">
                        <span className="material-symbols-outlined">terminal</span>
                      </div>
                      <div className="robin-setting-item-text">
                        <div className="robin-setting-item-name">{cli.name}</div>
                        <div className="robin-setting-item-desc">{cli.description}</div>
                      </div>
                      <span className={`robin-setting-item-badge ${cli.active ? 'on' : 'off'}`}>
                        {cli.active ? 'active' : 'installed'}
                      </span>
                    </div>
                  ))}
                </>
              ) : (
                // Other tabs: group by section
                sectionNames.map(section => (
                  <div key={section}>
                    <div className="robin-settings-section-divider">{section}</div>
                    {configItems.filter(s => s.section === section).map(item => (
                      <div
                        key={item.key}
                        className={`robin-setting-item ${selectedItemId === item.key && !showRegistry ? 'active' : ''}`}
                        onClick={() => selectItem(item.key)}
                      >
                        <div className="robin-setting-item-icon">
                          <span className="material-symbols-outlined">{item.icon}</span>
                        </div>
                        <div className="robin-setting-item-text">
                          <div className="robin-setting-item-name">{item.key.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</div>
                          <div className="robin-setting-item-desc">{item.description}</div>
                        </div>
                        <span className={`robin-setting-item-badge ${item.value === 'true' ? 'on' : 'value'}`}>
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
                  className={`robin-add-btn ${showRegistry ? 'active' : ''}`}
                  onClick={openRegistry}
                >
                  <span className="material-symbols-outlined">add</span>
                  Add CLI
                </button>
              )}
              {activeTab === 'llm-providers' && (
                <button
                  className={`robin-add-btn ${showRegistry ? 'active' : ''}`}
                  onClick={openRegistry}
                >
                  <span className="material-symbols-outlined">add</span>
                  Add Provider
                </button>
              )}
            </div>

            {/* Right panel: wiki, item detail, registry, or customization */}
            <div className="robin-detail">
              {/* Context toggle — positioned in robin-detail, not inside scroll */}
              {wikiPage?.context && !selectedItem && !showRegistry && !(activeTab === 'customization' && selectedWorkspaceId) && (
                <WikiContextToggle
                  active={showContext}
                  onClick={() => setShowContext(!showContext)}
                />
              )}
              <div className="robin-detail-scroll">
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
                ) : selectedItem ? (
                  activeTab === 'clis' ? (
                    <CLIDetail cli={selectedItem as CliItem} />
                  ) : (
                    <ConfigDetail item={selectedItem as ConfigItem} tabLabel={currentTab?.label || ''} />
                  )
                ) : wikiPage ? (
                  <WikiDetail page={wikiPage} showContext={showContext} />
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Wiki context toggle (positioned in robin-detail, outside scroll) ---

function WikiContextToggle({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      className={`robin-wiki-context-toggle ${active ? 'active' : ''}`}
      onClick={onClick}
      title={active ? 'Show user guide' : 'Show agent system message'}
    >
      <span className="material-symbols-outlined">text_compare</span>
    </button>
  );
}

// --- Wiki detail (default right panel) ---

function WikiDetail({ page, showContext }: { page: WikiPage; showContext: boolean }) {
  return (
    <div className={`robin-detail-body robin-wiki-content ${showContext ? 'robin-wiki-context-view' : ''}`}>
      {showContext ? (
        <div className="robin-wiki-context-content">
          <div className="robin-wiki-context-label">
            <span className="material-symbols-outlined">smart_toy</span>
            Agent System Message
          </div>
          <div dangerouslySetInnerHTML={{ __html: markdownToHtml(page.context || '') }} />
        </div>
      ) : (
        <div dangerouslySetInnerHTML={{ __html: markdownToHtml(page.content) }} />
      )}
    </div>
  );
}

// --- Config item detail (non-CLI tabs) ---

function ConfigDetail({ item, tabLabel }: { item: ConfigItem; tabLabel: string }) {
  const displayName = item.key.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const isBoolean = item.value === 'true' || item.value === 'false';

  return (
    <>
      <div className="robin-detail-header">
        <div className="robin-detail-breadcrumb">
          <span>{tabLabel}</span> / <span>{item.section}</span> / {displayName}
        </div>

        <div className="robin-detail-title">
          <span className="material-symbols-outlined">{item.icon}</span>
          {displayName}
        </div>

        <div className="robin-detail-subtitle">
          {item.description}
        </div>

        <div className="robin-detail-meta">
          <div className="robin-detail-meta-item">
            <span className="robin-detail-meta-label">Status</span>
            <span className={`robin-detail-meta-value ${isBoolean && item.value === 'true' ? 'highlight' : ''}`}>
              {isBoolean ? (item.value === 'true' ? 'Active' : 'Inactive') : item.value}
            </span>
          </div>
          <div className="robin-detail-meta-item">
            <span className="robin-detail-meta-label">Section</span>
            <span className="robin-detail-meta-value">{item.section}</span>
          </div>
          <div className="robin-detail-meta-item">
            <span className="robin-detail-meta-label">Source</span>
            <span className="robin-detail-meta-value"><code>robin.db</code></span>
          </div>
        </div>

        {isBoolean && (
          <div className="robin-detail-toggle-row">
            <div>
              <div className="robin-detail-toggle-label">{displayName}</div>
              <div className="robin-detail-toggle-desc">Toggle this setting on or off</div>
            </div>
            <div className={`robin-toggle ${item.value === 'true' ? 'on' : ''}`} />
          </div>
        )}
      </div>
    </>
  );
}

// --- CLI detail (when a CLI is selected from the list) ---

function CLIDetail({ cli }: { cli: CliItem }) {
  return (
    <div className="robin-detail-header">
      <div className="robin-detail-title">
        <span className="material-symbols-outlined">terminal</span>
        {cli.name}
      </div>

      <div className="robin-detail-subtitle">
        {cli.description}
      </div>

      <div className="robin-detail-meta">
        <div className="robin-detail-meta-item">
          <span className="robin-detail-meta-label">Author</span>
          <span className="robin-detail-meta-value">{cli.author}</span>
        </div>
        {cli.version && (
          <div className="robin-detail-meta-item">
            <span className="robin-detail-meta-label">Version</span>
            <span className="robin-detail-meta-value">{cli.version}</span>
          </div>
        )}
        <div className="robin-detail-meta-item">
          <span className="robin-detail-meta-label">Status</span>
          <span className={`robin-detail-meta-value ${cli.active ? 'highlight' : ''}`}>
            {cli.active ? 'Active' : 'Installed'}
          </span>
        </div>
      </div>

      {cli.pricing_url && (
        <div className="robin-detail-meta-item" style={{ marginTop: '12px' }}>
          <span className="robin-detail-meta-label">Pricing</span>
          <a href={cli.pricing_url} target="_blank" rel="noopener noreferrer" className="robin-detail-meta-value highlight">
            View plans →
          </a>
        </div>
      )}

      {cli.docs_url && (
        <div className="robin-detail-meta-item" style={{ marginTop: '4px' }}>
          <span className="robin-detail-meta-label">Docs</span>
          <a href={cli.docs_url} target="_blank" rel="noopener noreferrer" className="robin-detail-meta-value highlight">
            Documentation →
          </a>
        </div>
      )}
    </div>
  );
}

// --- CLI registry (available CLIs to add) ---

// --- Color picker (reusable) ---

function ColorPicker({ value, onChange, disabled }: { value: string; onChange: (hex: string) => void; disabled?: boolean }) {
  const [inputValue, setInputValue] = useState(value);

  useEffect(() => { setInputValue(value); }, [value]);

  function handleHexSubmit() {
    const cleaned = inputValue.replace('#', '').trim();
    if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
      onChange(`#${cleaned}`);
    } else {
      setInputValue(value);
    }
  }

  return (
    <div className={`robin-color-picker ${disabled ? 'disabled' : ''}`}>
      <div className="robin-color-picker-label">Primary Color</div>
      <div className="robin-color-swatches">
        {COLOR_SWATCHES.map(s => (
          <div
            key={s.hex}
            className={`robin-color-swatch ${value === s.hex ? 'active' : ''}`}
            style={{ background: s.hex }}
            title={s.name}
            onClick={() => onChange(s.hex)}
          />
        ))}
      </div>
      <div className="robin-color-current">
        <div className="robin-color-current-dot" style={{ background: value }} />
        <input
          className="robin-color-hex-input"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onBlur={handleHexSubmit}
          onKeyDown={e => { if (e.key === 'Enter') handleHexSubmit(); }}
        />
      </div>
    </div>
  );
}

// --- System theme detail ---

function SystemThemeDetail({ theme, onUpdate }: {
  theme: SystemTheme | null;
  onUpdate: (preset: string, color: string) => void;
}) {
  if (!theme) return null;

  return (
    <>
      <div className="robin-detail-header">
        <div className="robin-detail-breadcrumb">
          <span>Customization</span> / System Theme
        </div>
        <div className="robin-detail-title">
          <span className="material-symbols-outlined">palette</span>
          System Theme
        </div>
        <div className="robin-detail-subtitle">
          The baseline look for all workspaces. Workspaces inherit this unless they have custom overrides.
        </div>

        <div className="robin-detail-meta">
          <div className="robin-detail-meta-item">
            <span className="robin-detail-meta-label">Preset</span>
            <span className="robin-detail-meta-value highlight">
              {theme.preset.charAt(0).toUpperCase() + theme.preset.slice(1)}
            </span>
          </div>
          <div className="robin-detail-meta-item">
            <span className="robin-detail-meta-label">Accent</span>
            <span className="robin-detail-meta-value" style={{ color: theme.primary_color }}>
              {theme.primary_color}
            </span>
          </div>
        </div>
      </div>

      <div className="robin-color-picker-label" style={{ marginTop: '24px' }}>Theme Preset</div>
      <div className="robin-preset-selector">
        {['dark', 'oled', 'medium', 'light'].map(p => (
          <button
            key={p}
            className={`robin-preset-btn ${theme.preset === p ? 'active' : ''}`}
            onClick={() => onUpdate(p, theme.primary_color)}
          >
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </button>
        ))}
      </div>

      <ColorPicker
        value={theme.primary_color}
        onChange={(hex) => onUpdate(theme.preset, hex)}
      />
    </>
  );
}

// --- Workspace theme detail ---

function WorkspaceThemeDetail({ workspace, onUpdateColor, onInherit, onApply }: {
  workspace: WorkspaceItem;
  onUpdateColor: (hex: string) => void;
  onInherit: () => void;
  onApply: () => void;
}) {
  if (!workspace) return null;

  return (
    <>
      <div className="robin-detail-header">
        <div className="robin-detail-breadcrumb">
          <span>Customization</span> / {workspace.label}
        </div>
        <div className="robin-detail-title">
          <span className="material-symbols-outlined">{workspace.icon}</span>
          {workspace.label}
        </div>
        <div className="robin-detail-subtitle">
          {workspace.themeState === 'inheriting'
            ? 'This workspace uses the system theme.'
            : workspace.themeState === 'custom'
            ? 'This workspace has a custom accent color.'
            : 'CSS has been modified outside the system panel.'}
        </div>
      </div>

      {workspace.themeState === 'diverged' ? (
        <div className="robin-diverged-card">
          <div className="robin-diverged-card-text">
            The CSS file has been edited directly and no longer matches what's saved here.
            Click Apply to absorb your changes into the system.
          </div>
          <button className="robin-apply-btn" onClick={onApply}>
            <span className="material-symbols-outlined">sync</span>
            Apply Changes
          </button>
        </div>
      ) : (
        <div className="robin-inherit-row">
          <div
            className={`robin-toggle ${workspace.themeState === 'inheriting' ? 'on' : ''}`}
            onClick={() => {
              if (workspace.themeState === 'inheriting') {
                onUpdateColor(workspace.primary_color);
              } else {
                onInherit();
              }
            }}
          />
          <span className="robin-inherit-label">Inherit system theme</span>
        </div>
      )}

      <ColorPicker
        value={workspace.primary_color}
        onChange={onUpdateColor}
        disabled={workspace.themeState === 'inheriting'}
      />

      <div className="robin-detail-body" style={{ marginTop: '16px' }}>
        <h2>Customizing by hand</h2>
        <p>
          You can edit the workspace CSS directly at: <code>ai/views/settings/themes.css</code>
        </p>
        <p>
          After editing, come back here and click Apply to save your changes to the system.
          This ensures your edits are preserved and won't be lost if you switch themes later.
        </p>
        <h2>Per-view overrides</h2>
        <p>
          To give a single view its own accent color, add a <code>themes.css</code> to
          that view's settings folder:
        </p>
        <p>
          <code>ai/views/&#123;viewer-name&#125;/settings/themes.css</code>
        </p>
        <p>
          Each view folder has three siblings: <code>chat/</code>, <code>content/</code>,
          and <code>settings/</code>. The theme override goes in <code>settings/</code>.
          Only include the variables you want to change — everything else flows down
          from the workspace, which flows from the system. Remove the file to go back
          to inheriting.
        </p>
      </div>
    </>
  );
}

// --- CLI registry (available CLIs to add) ---

function CLIRegistry({ items }: { items: CliItem[] }) {
  return (
    <div className="robin-registry">
      <div className="robin-detail-header">
        <div className="robin-detail-title">
          <span className="material-symbols-outlined">add_circle</span>
          Add a CLI
        </div>
        <div className="robin-detail-subtitle">
          Choose an AI assistant to connect to Open Robin. You'll need the CLI installed on your
          machine first — each one has its own setup instructions.
        </div>
      </div>

      <div className="robin-registry-list">
        {items.map(cli => (
          <div key={cli.id} className="robin-registry-item">
            <div className="robin-registry-item-info">
              <div className="robin-registry-item-top">
                <span className="robin-registry-item-name">{cli.name}</span>
                {cli.version && <span className="robin-registry-item-version">v{cli.version}</span>}
              </div>
              <div className="robin-registry-item-by">by {cli.author}</div>
              <div className="robin-registry-item-desc">{cli.description}</div>
            </div>
            <button className="robin-registry-add-btn">
              <span className="material-symbols-outlined">download</span>
              Add
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
