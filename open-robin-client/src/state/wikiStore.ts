/**
 * @module wikiStore
 * @role State management for the wiki-viewer workspace
 * @reads topics.json, {collection}/{topic}/PAGE.md, {collection}/{topic}/LOG.md
 */

import { create } from 'zustand';

export interface CollectionMeta {
  id: string;
  label: string;
  rank: number;
  sort: string;
  frozen: boolean;
}

export interface TopicMeta {
  slug: string;
  collection: string;
  collectionLabel: string;
  collectionRank: number;
  rank: number;
  frozen: boolean;
  edges_out: string[];
  edges_in: string[];
}

export interface WikiState {
  // Index
  topics: Record<string, TopicMeta>;
  collections: CollectionMeta[];
  indexLoaded: boolean;

  // Navigation
  activeTopic: string | null;
  navigationHistory: string[];
  historyIndex: number;

  // Page content
  pageContent: string;
  pageLoading: boolean;
  activeTab: 'page' | 'log' | 'runs';

  // Edges for active topic
  edgesIn: string[];
  edgesOut: string[];

  // Log
  logContent: string;

  // Error
  error: string | null;

  // Actions
  setIndex: (topics: Record<string, TopicMeta>, collections: CollectionMeta[]) => void;
  setActiveTopic: (topicId: string) => void;
  navigateToTopic: (slug: string) => void;
  goBack: () => void;
  goForward: () => void;
  setPageContent: (content: string) => void;
  setPageLoading: (loading: boolean) => void;
  setLogContent: (content: string) => void;
  setActiveTab: (tab: 'page' | 'log' | 'runs') => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

function findTopicBySlug(topics: Record<string, TopicMeta>, slug: string): string | null {
  // Direct match on topic ID
  if (topics[slug]) return slug;
  // Match on slug field (e.g., "Secrets" → "secrets")
  for (const [id, meta] of Object.entries(topics)) {
    if (meta.slug === slug) return id;
  }
  // Case-insensitive fallback
  const lower = slug.toLowerCase();
  for (const [id, meta] of Object.entries(topics)) {
    if (id.toLowerCase() === lower || meta.slug.toLowerCase() === lower) return id;
  }
  return null;
}

export const useWikiStore = create<WikiState>((set, get) => ({
  topics: {},
  collections: [],
  indexLoaded: false,
  activeTopic: null,
  navigationHistory: [],
  historyIndex: -1,
  pageContent: '',
  pageLoading: false,
  activeTab: 'page',
  edgesIn: [],
  edgesOut: [],
  logContent: '',
  error: null,

  setIndex: (topics, collections) => set({ topics, collections, indexLoaded: true }),

  setActiveTopic: (topicId) => {
    const { topics } = get();
    const meta = topics[topicId];
    set({
      activeTopic: topicId,
      edgesIn: meta?.edges_in || [],
      edgesOut: meta?.edges_out || [],
      activeTab: 'page',
      pageContent: '',
      logContent: '',
      error: null,
    });
  },

  navigateToTopic: (slug) => {
    const { topics, navigationHistory, historyIndex } = get();
    const topicId = findTopicBySlug(topics, slug);
    if (!topicId) return;

    // Trim forward history and push new entry
    const newHistory = navigationHistory.slice(0, historyIndex + 1);
    newHistory.push(topicId);

    const meta = topics[topicId];
    set({
      activeTopic: topicId,
      navigationHistory: newHistory,
      historyIndex: newHistory.length - 1,
      edgesIn: meta?.edges_in || [],
      edgesOut: meta?.edges_out || [],
      activeTab: 'page',
      pageContent: '',
      logContent: '',
      error: null,
    });
  },

  goBack: () => {
    const { navigationHistory, historyIndex, topics } = get();
    if (historyIndex <= 0) return;
    const newIndex = historyIndex - 1;
    const topicId = navigationHistory[newIndex];
    const meta = topics[topicId];
    set({
      activeTopic: topicId,
      historyIndex: newIndex,
      edgesIn: meta?.edges_in || [],
      edgesOut: meta?.edges_out || [],
      activeTab: 'page',
      pageContent: '',
      logContent: '',
    });
  },

  goForward: () => {
    const { navigationHistory, historyIndex, topics } = get();
    if (historyIndex >= navigationHistory.length - 1) return;
    const newIndex = historyIndex + 1;
    const topicId = navigationHistory[newIndex];
    const meta = topics[topicId];
    set({
      activeTopic: topicId,
      historyIndex: newIndex,
      edgesIn: meta?.edges_in || [],
      edgesOut: meta?.edges_out || [],
      activeTab: 'page',
      pageContent: '',
      logContent: '',
    });
  },

  setPageContent: (content) => set({ pageContent: content, pageLoading: false }),
  setPageLoading: (loading) => set({ pageLoading: loading }),
  setLogContent: (content) => set({ logContent: content }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setError: (error) => set({ error }),

  reset: () => set({
    topics: {},
    collections: [],
    indexLoaded: false,
    activeTopic: null,
    navigationHistory: [],
    historyIndex: -1,
    pageContent: '',
    pageLoading: false,
    activeTab: 'page',
    edgesIn: [],
    edgesOut: [],
    logContent: '',
    error: null,
  }),
}));
