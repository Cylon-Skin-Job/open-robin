import type { CliItem } from './robin-types';

export function CLIDetail({ cli }: { cli: CliItem }) {
  return (
    <div className="rv-robin-detail-header">
      <div className="rv-robin-detail-title">
        <span className="material-symbols-outlined">terminal</span>
        {cli.name}
      </div>

      <div className="rv-robin-detail-subtitle">
        {cli.description}
      </div>

      <div className="rv-robin-detail-meta">
        <div className="rv-robin-detail-meta-item">
          <span className="rv-robin-detail-meta-label">Author</span>
          <span className="rv-robin-detail-meta-value">{cli.author}</span>
        </div>
        {cli.version && (
          <div className="rv-robin-detail-meta-item">
            <span className="rv-robin-detail-meta-label">Version</span>
            <span className="rv-robin-detail-meta-value">{cli.version}</span>
          </div>
        )}
        <div className="rv-robin-detail-meta-item">
          <span className="rv-robin-detail-meta-label">Status</span>
          <span className={`rv-robin-detail-meta-value ${cli.active ? 'highlight' : ''}`}>
            {cli.active ? 'Active' : 'Installed'}
          </span>
        </div>
      </div>

      {cli.pricing_url && (
        <div className="rv-robin-detail-meta-item" style={{ marginTop: '12px' }}>
          <span className="rv-robin-detail-meta-label">Pricing</span>
          <a href={cli.pricing_url} target="_blank" rel="noopener noreferrer" className="rv-robin-detail-meta-value highlight">
            View plans →
          </a>
        </div>
      )}

      {cli.docs_url && (
        <div className="rv-robin-detail-meta-item" style={{ marginTop: '4px' }}>
          <span className="rv-robin-detail-meta-label">Docs</span>
          <a href={cli.docs_url} target="_blank" rel="noopener noreferrer" className="rv-robin-detail-meta-value highlight">
            Documentation →
          </a>
        </div>
      )}
    </div>
  );
}

export function CLIRegistry({ items }: { items: CliItem[] }) {
  return (
    <div className="rv-robin-registry">
      <div className="rv-robin-detail-header">
        <div className="rv-robin-detail-title">
          <span className="material-symbols-outlined">add_circle</span>
          Add a CLI
        </div>
        <div className="rv-robin-detail-subtitle">
          Choose an AI assistant to connect to Open Robin. You'll need the CLI installed on your
          machine first — each one has its own setup instructions.
        </div>
      </div>

      <div className="rv-robin-registry-list">
        {items.map(cli => (
          <div key={cli.id} className="rv-robin-registry-item">
            <div className="rv-robin-registry-item-info">
              <div className="rv-robin-registry-item-top">
                <span className="rv-robin-registry-item-name">{cli.name}</span>
                {cli.version && <span className="rv-robin-registry-item-version">v{cli.version}</span>}
              </div>
              <div className="rv-robin-registry-item-by">by {cli.author}</div>
              <div className="rv-robin-registry-item-desc">{cli.description}</div>
            </div>
            <button className="rv-robin-registry-add-btn">
              <span className="material-symbols-outlined">download</span>
              Add
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
