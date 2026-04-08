import { markdownToHtml } from '../../lib/transforms/markdown';
import type { WikiPage } from './robin-types';

export function WikiToolbar({ page, showContext, onToggleContext }: { page: WikiPage; showContext: boolean; onToggleContext: () => void }) {
  const copyRef = () => {
    const ref = `robin.db → system_wiki → slug: ${page.slug}\nFields: content (user-facing), context (AI-facing)`;
    navigator.clipboard.writeText(ref);
    // Brief visual feedback
    const btn = document.querySelector('.rv-robin-wiki-link-btn') as HTMLElement;
    if (btn) { btn.classList.add('copied'); setTimeout(() => btn.classList.remove('copied'), 1200); }
  };

  return (
    <div className="rv-robin-wiki-toolbar">
      <button
        className="rv-robin-wiki-link-btn"
        onClick={copyRef}
        title="Copy reference path"
      >
        <span className="material-symbols-outlined">link_2</span>
      </button>
      {page.context && (
        <button
          className={`rv-robin-wiki-context-toggle ${showContext ? 'active' : ''}`}
          onClick={onToggleContext}
          title={showContext ? 'Show user guide' : 'Show agent system message'}
        >
          <span className="material-symbols-outlined">text_compare</span>
        </button>
      )}
    </div>
  );
}

export function WikiDetail({ page, showContext, onToggleContext }: { page: WikiPage; showContext: boolean; onToggleContext: () => void }) {
  return (
    <div className={`rv-robin-detail-body rv-robin-wiki-content ${showContext ? 'rv-robin-wiki-context-view' : ''}`}>
      <WikiToolbar page={page} showContext={showContext} onToggleContext={onToggleContext} />
      {showContext ? (
        <div className="rv-robin-wiki-context-content">
          <div className="rv-robin-wiki-context-label">
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
