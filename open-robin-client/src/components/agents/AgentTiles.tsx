/**
 * @module AgentTiles
 * @role Full-width tile grid for the agents panel
 * @reads agentStore: agents, loaded, expandedAgent
 *
 * Displays agent cards in a responsive grid. Clicking a card opens
 * an overlay with chat on the left and agent details on the right.
 */

import { useCallback, useEffect, useState } from 'react';
import { usePanelData } from '../../hooks/usePanelData';
import { usePanelStore } from '../../state/panelStore';
import { useAgentStore, AGENT_CONFIG_FILES, type Agent } from '../../state/agentStore';
import { PromptCardView } from './PromptCardView';
import { copyResourcePath } from '../../lib/resource-path';
import './agents.css';

/** Strip YAML frontmatter, return just the markdown body */
function stripFrontmatter(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
  return match ? match[1].trim() : content.trim();
}

function formatId(id: string): string {
  return id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function AgentCard({ agent }: { agent: Agent }) {
  const setExpanded = useAgentStore((s) => s.setExpandedAgent);

  return (
    <div
      className="agent-tile"
      style={{ '--tile-color': agent.color } as React.CSSProperties}
      onClick={() => setExpanded(agent.id)}
    >
      <div className="agent-tile-top">
        <div className="agent-tile-icon">
          <span className="material-symbols-outlined">{agent.icon}</span>
        </div>
        <div className="agent-tile-info">
          <div className="agent-tile-name">{formatId(agent.id)}</div>
          <div className="agent-tile-desc">{agent.description}</div>
        </div>
      </div>
      <div className="agent-tile-footer">
        <div className="agent-tile-meta">
          <span className="agent-tile-bot">{agent.bot_name}</span>
          {agent.schedule && (
            <span title={agent.schedule}>
              <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>schedule</span>
              {agent.schedule_label || agent.schedule}
            </span>
          )}
          {agent.pending_tickets > 0 && (
            <span>{agent.pending_tickets} pending</span>
          )}
        </div>
        <span className={`agent-tile-status ${agent.status}`}>
          {agent.status}
        </span>
      </div>
    </div>
  );
}

/** Icon map for sidebar card files */
const FILE_ICONS: Record<string, string> = {
  'PROMPT.md': 'badge',
  'MEMORY.md': 'psychology',
  'LESSONS.md': 'school',
  'SESSION.md': 'settings',
  'TRIGGERS.md': 'bolt',
};

function AgentDetail({ agent, request }: { agent: Agent; request: (path: string) => void }) {
  const setExpanded = useAgentStore((s) => s.setExpandedAgent);
  const configFiles = useAgentStore((s) => s.configFiles);
  const workflows = useAgentStore((s) => s.workflows);
  const ws = usePanelStore((s) => s.ws);

  const [activeTab, setActiveTab] = useState<'workflows' | 'runs' | 'settings'>('workflows');
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [fileCache, setFileCache] = useState<Record<string, string>>({});

  // Discover config files + workflows on mount
  useEffect(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    let active = true;

    const handleMessage = (event: MessageEvent) => {
      if (!active) return;
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'file_tree_response' && msg.panel === 'agents-viewer' && msg.path === `System/${agent.id}`) {
          const files = (msg.nodes || [])
            .filter((n: any) => n.type === 'file' && AGENT_CONFIG_FILES.includes(n.name))
            .map((n: any) => n.name)
            .sort((a: string, b: string) => AGENT_CONFIG_FILES.indexOf(a) - AGENT_CONFIG_FILES.indexOf(b));
          useAgentStore.getState().setConfigFiles(files);
        }
        if (msg.type === 'file_tree_response' && msg.panel === 'agents-viewer' && msg.path === `System/${agent.id}/workflows`) {
          const folders = (msg.nodes || [])
            .filter((n: any) => n.type === 'folder')
            .map((n: any) => n.name)
            .sort();
          useAgentStore.getState().setWorkflows(folders);
        }
        if (msg.type === 'file_content_response' && msg.panel === 'agents-viewer' && msg.success) {
          // Key by workflow folder name if it's a WORKFLOW.md, otherwise by filename
          const parts = msg.path.split('/');
          const fileName = parts[parts.length - 1];
          if (fileName === 'WORKFLOW.md' && parts.length >= 2) {
            // Key by workflow folder name
            const folderName = parts[parts.length - 2];
            setFileCache(prev => ({ ...prev, [folderName]: stripFrontmatter(msg.content) }));
          } else {
            setFileCache(prev => ({ ...prev, [fileName]: stripFrontmatter(msg.content) }));
          }
        }
      } catch {}
    };

    ws.addEventListener('message', handleMessage);
    ws.send(JSON.stringify({ type: 'file_tree_request', panel: 'agents-viewer', path: `System/${agent.id}` }));
    ws.send(JSON.stringify({ type: 'file_tree_request', panel: 'agents-viewer', path: `System/${agent.id}/workflows` }));

    return () => { active = false; ws.removeEventListener('message', handleMessage); };
  }, [agent.id, ws]);

  // Load all files once discovered
  useEffect(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    for (const f of configFiles) {
      if (!fileCache[f]) request(`System/${agent.id}/${f}`);
    }
  }, [configFiles, ws, agent.id]);

  useEffect(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    for (const wf of workflows) {
      if (!fileCache[wf]) request(`System/${agent.id}/workflows/${wf}/WORKFLOW.md`);
    }
  }, [workflows, ws, agent.id]);

  // Auto-select first item when switching tabs
  useEffect(() => {
    if (activeTab === 'workflows') {
      if (workflows.length > 0 && !workflows.includes(activeFile || '')) setActiveFile(workflows[0]);
    } else if (activeTab === 'settings') {
      if (configFiles.length > 0 && !configFiles.includes(activeFile || '')) setActiveFile(configFiles[0]);
    }
  }, [activeTab, configFiles, workflows]);

  // Sidebar cards based on active tab
  let sidebarItems: { name: string; displayName: string; icon: string }[] = [];
  if (activeTab === 'workflows') {
    sidebarItems = workflows.map(f => ({ name: f, displayName: f, icon: 'account_tree' }));
  } else if (activeTab === 'settings') {
    sidebarItems = configFiles.map(f => ({ name: f, displayName: f.replace('.md', ''), icon: FILE_ICONS[f] || 'description' }));
  }

  // Content for the selected file
  const selectedContent = activeFile ? fileCache[activeFile] || null : null;
  const isWorkflow = activeFile ? workflows.includes(activeFile) : false;

  return (
    <div className="agent-detail-fullscreen" style={{ '--tile-color': agent.color } as React.CSSProperties}>
      {/* Header: bot name + exit */}
      <div className="agent-detail-header">
        <span className="material-symbols-outlined agent-detail-header-icon">{agent.icon}</span>
        <span className="agent-detail-header-name">{formatId(agent.id)}</span>
        <span className={`agent-tile-status ${agent.status}`}>{agent.status}</span>
        <button
          className="file-page-action"
          onClick={() => copyResourcePath('agents-viewer', `System/${agent.id}/`)}
          title="Copy agent path"
        >
          <span className="material-symbols-outlined">link_2</span>
        </button>
        <button className="agent-detail-exit" onClick={() => setExpanded(null)}>
          <span className="material-symbols-outlined" style={{ fontSize: '24px' }}>close</span>
        </button>
      </div>

      {/* Pill tabs */}
      <div className="agent-detail-pill-bar">
        {(['workflows', 'runs', 'settings'] as const).map(tab => (
          <button
            key={tab}
            className={`agent-detail-pill${activeTab === tab ? ' active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Card container: sidebar + content + chat */}
      <div className="agent-detail-card">
        <div className="agent-detail-content">

        {/* Left: Sidebar + Content */}
        <div className="agent-detail-main">

          {/* Sidebar + Content split */}
          <div className="agent-detail-split">
            {/* Sidebar: cards with name + description */}
            <div className="agent-detail-card-sidebar">
              {sidebarItems.map((item) => {
                const content = fileCache[item.name];
                const desc = content ? content.split('\n').filter(l => l.trim() && !l.startsWith('#')).slice(0, 3).join(' ').slice(0, 200) : '';
                return (
                  <div
                    key={item.name}
                    className={`agent-detail-card-item${item.name === activeFile ? ' active' : ''}`}
                    onClick={() => setActiveFile(item.name)}
                  >
                    <div className="agent-card-item-icon">
                      <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>{item.icon}</span>
                    </div>
                    <div className="agent-card-item-text">
                      <div className="agent-card-item-name">{item.displayName}</div>
                      {desc && <div className="agent-card-item-desc">{desc}{desc.length >= 100 ? '...' : ''}</div>}
                    </div>
                  </div>
                );
              })}
              {activeTab === 'runs' && (
                <div className="agent-detail-runs-empty">No runs yet</div>
              )}
              {activeTab === 'settings' && (
                <div className="agent-detail-runs-empty">Settings coming soon</div>
              )}
            </div>

            {/* Content area */}
            <div className="agent-detail-viewer">
              {selectedContent ? (
                <PromptCardView
                  content={selectedContent}
                  fileName={isWorkflow ? (activeFile || '') : ''}
                  agentColor={agent.color}
                />
              ) : (
                <div style={{ color: 'var(--text-dim)', fontSize: '0.8125rem', fontStyle: 'italic', padding: '20px' }}>
                  {activeTab === 'runs' ? 'Select a run to view' :
                   activeTab === 'settings' ? '' :
                   'Select an item to view'}
                </div>
              )}
            </div>
          </div>
        </div>

          {/* Right: Chat */}
          <div className="agent-detail-chat">
            <div className="agent-detail-chat-inner">
              <div className="agent-detail-chat-messages">
                <div className="agent-detail-chat-empty">
                  Send a message to interact with this bot
                </div>
              </div>
              <div className="agent-detail-chat-input">
                <textarea
                  rows={2}
                  placeholder={`Message ${formatId(agent.id)}...`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                    }
                  }}
                />
              </div>
            </div>
          </div>

      </div>
      </div>
    </div>
  );
}

export function AgentTiles() {
  const onIndex = useCallback((content: string) => {
    try {
      const index = JSON.parse(content);
      useAgentStore.getState().setAgentsFromIndex(index.agents || {});
    } catch {
      useAgentStore.getState().setError('Failed to parse agents.json');
    }
  }, []);

  const onFileContent = useCallback((path: string, content: string) => {
    // Any .md file from an agent folder
    if (path.endsWith('.md')) {
      useAgentStore.getState().setFileContent(stripFrontmatter(content));
    }
  }, []);

  const onError = useCallback((error: string) => {
    useAgentStore.getState().setError(error);
  }, []);

  const { request } = usePanelData({
    panel: 'agents-viewer',
    indexPath: 'agents.json',
    onIndex,
    onFileContent,
    onError,
  });

  // File loading is now handled inside AgentDetail

  const agents = useAgentStore((s) => s.agents);
  const loaded = useAgentStore((s) => s.loaded);
  const expandedId = useAgentStore((s) => s.expandedAgent);

  if (!loaded) {
    return (
      <div className="agent-tiles-loading">
        <span>Loading agents...</span>
      </div>
    );
  }

  const expandedAgent = expandedId ? agents.find((a) => a.id === expandedId) || null : null;

  if (expandedAgent) {
    return <AgentDetail agent={expandedAgent} request={request} />;
  }

  return (
    <div className="agent-tiles">
      {agents.map((agent) => (
        <AgentCard key={agent.id} agent={agent} />
      ))}
    </div>
  );
}
