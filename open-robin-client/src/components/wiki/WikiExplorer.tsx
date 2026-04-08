/**
 * @module WikiExplorer
 * @role Top-level wiki-viewer panel component — three-column layout
 * @reads wikiStore: indexLoaded
 *
 * Renders: TopicList (left) | PageViewer (center) | EdgePanel (right)
 * Sets up the wiki WebSocket listener on mount.
 */

import { useCallback, useEffect } from 'react';
import { usePanelData } from '../../hooks/usePanelData';
import { usePanelStore } from '../../state/panelStore';
import { useWikiStore } from '../../state/wikiStore';
import { TopicList } from './TopicList';
import { PageViewer } from './PageViewer';
import { EdgePanel } from './EdgePanel';
import { FloatingChat } from '../FloatingChat';
import './wiki.css';

export function WikiExplorer() {
  const activeTopic = useWikiStore((s) => s.activeTopic);
  const ws = usePanelStore((s) => s.ws);

  const onIndex = useCallback((content: string) => {
    try {
      const index = JSON.parse(content);
      useWikiStore.getState().setIndex(index.topics || {}, index.collections || []);
    } catch {
      useWikiStore.getState().setError('Failed to parse topics.json');
    }
  }, []);

  const onFileContent = useCallback((path: string, content: string) => {
    if (path.endsWith('/PAGE.md')) {
      useWikiStore.getState().setPageContent(content);
    } else if (path.endsWith('/LOG.md')) {
      useWikiStore.getState().setLogContent(content);
    }
  }, []);

  const onError = useCallback((error: string) => {
    useWikiStore.getState().setError(error);
    useWikiStore.getState().setPageLoading(false);
  }, []);

  const { request } = usePanelData({
    panel: 'wiki-viewer',
    indexPath: 'topics.json',
    onIndex,
    onFileContent,
    onError,
  });

  // Load PAGE.md when active topic changes
  useEffect(() => {
    if (!activeTopic || !ws || ws.readyState !== WebSocket.OPEN) return;
    useWikiStore.getState().setPageLoading(true);
    request(`${activeTopic}/PAGE.md`);
  }, [activeTopic, ws, request]);

  const indexLoaded = useWikiStore((s) => s.indexLoaded);

  if (!indexLoaded) {
    return (
      <div className="rv-wiki-explorer">
        <div className="rv-wiki-loading">
          <span style={{ color: 'var(--text-dim)' }}>Loading wiki...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rv-wiki-explorer">
      <TopicList />
      <PageViewer />
      <EdgePanel />
      <FloatingChat panel="rv-wiki-viewer" />
    </div>
  );
}
