/**
 * @module PageViewer
 * @role Center column — renders PAGE.md as formatted markdown
 * @reads wikiStore: pageContent, pageLoading, activeTopic, activeTab, logContent
 *
 * Intercepts wiki-internal links: hrefs matching known slugs navigate
 * within the wiki instead of opening a URL.
 */

import { useEffect, useRef, useCallback } from 'react';
import { markdownToHtml } from '../../lib/transforms';
import { useWikiStore } from '../../state/wikiStore';
import { usePanelStore } from '../../state/panelStore';
import { copyResourcePath } from '../../lib/resource-path';
import { useActiveResourceStore } from '../../state/activeResourceStore';

export function PageViewer() {
  const activeTopic = useWikiStore((s) => s.activeTopic);
  const pageContent = useWikiStore((s) => s.pageContent);
  const pageLoading = useWikiStore((s) => s.pageLoading);
  const activeTab = useWikiStore((s) => s.activeTab);
  const logContent = useWikiStore((s) => s.logContent);
  const setActiveTab = useWikiStore((s) => s.setActiveTab);
  const topics = useWikiStore((s) => s.topics);
  const navigateToTopic = useWikiStore((s) => s.navigateToTopic);
  const navigationHistory = useWikiStore((s) => s.navigationHistory);
  const historyIndex = useWikiStore((s) => s.historyIndex);
  const goBack = useWikiStore((s) => s.goBack);
  const goForward = useWikiStore((s) => s.goForward);
  const error = useWikiStore((s) => s.error);

  // Track active resource for live refresh
  const setActiveResource = useActiveResourceStore((s) => s.setActiveResource);
  useEffect(() => {
    if (activeTopic) setActiveResource('wiki-viewer', `${activeTopic}/${activeTab === 'log' ? 'LOG' : 'PAGE'}.md`);
  }, [activeTopic, activeTab]);

  // Build set of known slugs for link interception
  const knownSlugs = useRef(new Set<string>());
  useEffect(() => {
    const slugs = new Set<string>();
    for (const [id, meta] of Object.entries(topics)) {
      slugs.add(id);
      slugs.add(meta.slug);
      slugs.add(meta.slug.toLowerCase());
      slugs.add(id.toLowerCase());
    }
    knownSlugs.current = slugs;
  }, [topics]);

  // Intercept link clicks for wiki-internal navigation
  const handleContentClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest('a');
    if (!anchor) return;

    const href = anchor.getAttribute('href') || '';
    // Check if this is a wiki-internal link (no protocol, matches a known slug)
    if (!href.includes('://') && !href.startsWith('#') && !href.startsWith('/')) {
      // Normalize: "../topic-name/PAGE.md" → "topic-name", "topic-name" → "topic-name"
      let slug = href
        .replace(/\/PAGE\.md$/i, '')  // strip /PAGE.md
        .replace(/\.md$/i, '')         // strip .md
        .replace(/^\.\.\//g, '');      // strip leading ../

      // If slug doesn't contain a collection prefix, try resolving within current topic's collection
      if (!slug.includes('/') && activeTopic) {
        const currentCollection = activeTopic.split('/')[0];
        const fullId = `${currentCollection}/${slug}`;
        if (knownSlugs.current.has(fullId)) {
          slug = fullId;
        }
      }

      if (knownSlugs.current.has(slug) || knownSlugs.current.has(slug.toLowerCase())) {
        e.preventDefault();
        e.stopPropagation();
        navigateToTopic(slug);
      }
    }
  }, [navigateToTopic, activeTopic]);

  // Load log when switching to log tab
  const handleTabClick = (tab: 'page' | 'log' | 'runs') => {
    setActiveTab(tab);
    if (tab === 'log' && activeTopic && !logContent) {
      const ws = usePanelStore.getState().ws;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'file_content_request',
          panel: 'wiki-viewer',
          path: `${activeTopic}/LOG.md`,
        }));
      }
    }
  };

  if (!activeTopic) {
    return (
      <div className="rv-wiki-page-viewer">
        <div className="rv-wiki-page-empty">
          <span className="material-symbols-outlined" style={{ fontSize: '2rem', opacity: 0.3 }}>full_coverage</span>
          <p>Select a topic to view</p>
        </div>
      </div>
    );
  }

  const renderedPage = pageContent ? markdownToHtml(pageContent) : '';
  const renderedLog = logContent ? markdownToHtml(logContent) : '';

  return (
    <div className="rv-wiki-page-viewer" onClick={handleContentClick}>
      {/* Breadcrumb / Nav */}
      <div className="rv-wiki-page-nav">
        <button
          className="rv-wiki-nav-btn"
          onClick={goBack}
          disabled={historyIndex <= 0}
          title="Back"
        >
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <button
          className="rv-wiki-nav-btn"
          onClick={goForward}
          disabled={historyIndex >= navigationHistory.length - 1}
          title="Forward"
        >
          <span className="material-symbols-outlined">arrow_forward</span>
        </button>
        <span className="rv-wiki-breadcrumb">
          {topics[activeTopic]?.slug || activeTopic}
        </span>
        <div className="rv-wiki-nav-actions">
          <button
            className="rv-file-page-action"
            onClick={() => copyResourcePath('wiki-viewer', `${activeTopic}/${activeTab === 'log' ? 'LOG' : 'PAGE'}.md`)}
            title="Copy file path"
          >
            <span className="material-symbols-outlined">link_2</span>
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="rv-wiki-tab-bar">
        <button
          className={`rv-wiki-tab ${activeTab === 'page' ? 'active' : ''}`}
          onClick={() => handleTabClick('page')}
        >
          Page
        </button>
        <button
          className={`rv-wiki-tab ${activeTab === 'log' ? 'active' : ''}`}
          onClick={() => handleTabClick('log')}
        >
          Log
        </button>
        <button
          className={`rv-wiki-tab ${activeTab === 'runs' ? 'active' : ''}`}
          onClick={() => handleTabClick('runs')}
        >
          Runs
        </button>
      </div>

      {/* Content */}
      {error && (
        <div className="rv-wiki-page-error">
          <span className="material-symbols-outlined" style={{ fontSize: '1rem' }}>error</span>
          <span>{error}</span>
        </div>
      )}

      {pageLoading && (
        <div className="rv-wiki-page-loading">Loading...</div>
      )}

      {activeTab === 'page' && !pageLoading && (
        <div
          className="rv-wiki-page-content rv-document-surface"
          dangerouslySetInnerHTML={{ __html: renderedPage as string }}
        />
      )}

      {activeTab === 'log' && (
        <div
          className="rv-wiki-page-content rv-document-surface"
          dangerouslySetInnerHTML={{ __html: renderedLog as string }}
        />
      )}

      {activeTab === 'runs' && (
        <div className="rv-wiki-page-content rv-document-surface">
          <p style={{ color: 'var(--text-dim)' }}>Run history — coming soon</p>
        </div>
      )}
    </div>
  );
}
