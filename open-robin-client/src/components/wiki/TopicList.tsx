/**
 * @module TopicList
 * @role Left sidebar — lists wiki topics grouped by collection, highlights active
 * @reads wikiStore: topics, collections, activeTopic
 */

import { useWikiStore } from '../../state/wikiStore';
import type { TopicMeta } from '../../state/wikiStore';

export function TopicList() {
  const topics = useWikiStore((s) => s.topics);
  const collections = useWikiStore((s) => s.collections);
  const activeTopic = useWikiStore((s) => s.activeTopic);
  const navigateToTopic = useWikiStore((s) => s.navigateToTopic);

  // Group topics by collection, sorted by collection rank
  const grouped = collections.map((col) => {
    const colTopics = Object.entries(topics)
      .filter(([, meta]) => meta.collection === col.id)
      .sort((a, b) => {
        // Home always first within a collection
        if (a[0].endsWith('/home')) return -1;
        if (b[0].endsWith('/home')) return 1;
        return (a[1].rank ?? 10) - (b[1].rank ?? 10);
      });
    return { collection: col, topics: colTopics };
  });

  return (
    <div className="rv-wiki-topic-list">
      <div className="rv-wiki-topic-list-header">
        <span className="material-symbols-outlined" style={{ fontSize: '1rem' }}>full_coverage</span>
        <span>Topics</span>
      </div>
      <div className="rv-wiki-topic-list-items">
        {grouped.map(({ collection, topics: colTopics }) => (
          <div key={collection.id} className="rv-wiki-collection-group">
            <div className="rv-wiki-collection-header">
              {collection.label}
              {collection.frozen && (
                <span className="material-symbols-outlined rv-wiki-frozen-icon" style={{ fontSize: '0.75rem', marginLeft: '4px', opacity: 0.5 }}>lock</span>
              )}
            </div>
            {colTopics.map(([id, meta]: [string, TopicMeta]) => {
              const isActive = id === activeTopic;
              return (
                <button
                  key={id}
                  className={`rv-wiki-topic-item ${isActive ? 'active' : ''}`}
                  onClick={() => navigateToTopic(meta.slug)}
                >
                  <span className="rv-wiki-topic-indicator">{isActive ? '\u25C9' : '\u25CB'}</span>
                  <span className="rv-wiki-topic-name">{meta.slug}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
