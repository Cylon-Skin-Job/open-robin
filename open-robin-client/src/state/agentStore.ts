/**
 * @module agentStore
 * @role State management for the agent-tiles workspace
 * @reads agents.json via file_content_request (same pattern as wikiStore, ticketStore)
 */

import { create } from 'zustand';

export interface Agent {
  id: string;
  bot_name: string;
  description: string;
  icon: string;
  color: string;
  status: string;
  last_run: string | null;
  pending_tickets: number;
  schedule: string | null;
  schedule_label: string | null;
}

/** Known agent config files in display order */
export const AGENT_CONFIG_FILES = [
  'PROMPT.md',
  'MEMORY.md',
  'LESSONS.md',
  'SESSION.md',
  'TRIGGERS.md',
];

export interface AgentState {
  agents: Agent[];
  loaded: boolean;
  expandedAgent: string | null;
  activeFile: string | null;
  fileContent: string | null;
  fileLoading: boolean;
  configFiles: string[];
  workflows: string[];
  activeSection: 'agent' | 'workflows' | 'runs';
  error: string | null;

  setAgentsFromIndex: (agents: Record<string, Omit<Agent, 'id'>>) => void;
  setExpandedAgent: (id: string | null) => void;
  setActiveFile: (file: string | null) => void;
  setFileContent: (content: string | null) => void;
  setFileLoading: (loading: boolean) => void;
  setConfigFiles: (files: string[]) => void;
  setWorkflows: (files: string[]) => void;
  setActiveSection: (section: 'agent' | 'workflows' | 'runs') => void;
  setError: (error: string | null) => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: [],
  loaded: false,
  expandedAgent: null,
  activeFile: null,
  fileContent: null,
  fileLoading: false,
  configFiles: [],
  workflows: [],
  activeSection: 'agent',
  error: null,

  setAgentsFromIndex: (agentMap) => {
    const agents = Object.entries(agentMap).map(([id, data]) => ({
      id,
      ...data,
    }));
    set({ agents, loaded: true });
  },
  setExpandedAgent: (id) => set({
    expandedAgent: id,
    activeFile: null,
    fileContent: null,
    fileLoading: false,
    configFiles: [],
    workflows: [],
    activeSection: 'agent',
  }),
  setActiveFile: (file) => set({ activeFile: file, fileContent: null, fileLoading: true }),
  setFileContent: (content) => set({ fileContent: content, fileLoading: false }),
  setFileLoading: (loading) => set({ fileLoading: loading }),
  setConfigFiles: (files) => set({ configFiles: files }),
  setWorkflows: (files) => set({ workflows: files }),
  setActiveSection: (section) => set({ activeSection: section }),
  setError: (error) => set({ error }),
}));
