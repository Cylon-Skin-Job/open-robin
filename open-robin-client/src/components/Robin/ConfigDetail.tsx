import type { ConfigItem } from './robin-types';

export function ConfigDetail({ item, tabLabel }: { item: ConfigItem; tabLabel: string }) {
  const displayName = item.key.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const isBoolean = item.value === 'true' || item.value === 'false';

  return (
    <>
      <div className="rv-robin-detail-header">
        <div className="rv-robin-detail-breadcrumb">
          <span>{tabLabel}</span> / <span>{item.section}</span> / {displayName}
        </div>

        <div className="rv-robin-detail-title">
          <span className="material-symbols-outlined">{item.icon}</span>
          {displayName}
        </div>

        <div className="rv-robin-detail-subtitle">
          {item.description}
        </div>

        <div className="rv-robin-detail-meta">
          <div className="rv-robin-detail-meta-item">
            <span className="rv-robin-detail-meta-label">Status</span>
            <span className={`rv-robin-detail-meta-value ${isBoolean && item.value === 'true' ? 'highlight' : ''}`}>
              {isBoolean ? (item.value === 'true' ? 'Active' : 'Inactive') : item.value}
            </span>
          </div>
          <div className="rv-robin-detail-meta-item">
            <span className="rv-robin-detail-meta-label">Section</span>
            <span className="rv-robin-detail-meta-value">{item.section}</span>
          </div>
          <div className="rv-robin-detail-meta-item">
            <span className="rv-robin-detail-meta-label">Source</span>
            <span className="rv-robin-detail-meta-value"><code>robin.db</code></span>
          </div>
        </div>

        {isBoolean && (
          <div className="rv-robin-detail-toggle-row">
            <div>
              <div className="rv-robin-detail-toggle-label">{displayName}</div>
              <div className="rv-robin-detail-toggle-desc">Toggle this setting on or off</div>
            </div>
            <div className={`rv-robin-toggle ${item.value === 'true' ? 'on' : ''}`} />
          </div>
        )}
      </div>
    </>
  );
}
