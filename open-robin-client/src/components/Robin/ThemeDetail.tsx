import { useState, useEffect } from 'react';
import { COLOR_SWATCHES } from './robin-types';
import type { SystemTheme, WorkspaceItem } from './robin-types';

export function ColorPicker({ value, onChange, disabled }: { value: string; onChange: (hex: string) => void; disabled?: boolean }) {
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
    <div className={`rv-robin-color-picker ${disabled ? 'disabled' : ''}`}>
      <div className="rv-robin-color-picker-label">Primary Color</div>
      <div className="rv-robin-color-swatches">
        {COLOR_SWATCHES.map(s => (
          <div
            key={s.hex}
            className={`rv-robin-color-swatch ${value === s.hex ? 'active' : ''}`}
            style={{ background: s.hex }}
            title={s.name}
            onClick={() => onChange(s.hex)}
          />
        ))}
      </div>
      <div className="rv-robin-color-current">
        <div className="rv-robin-color-current-dot" style={{ background: value }} />
        <input
          className="rv-robin-color-hex-input"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onBlur={handleHexSubmit}
          onKeyDown={e => { if (e.key === 'Enter') handleHexSubmit(); }}
        />
      </div>
    </div>
  );
}

export function SystemThemeDetail({ theme, onUpdate }: {
  theme: SystemTheme | null;
  onUpdate: (preset: string, color: string) => void;
}) {
  if (!theme) return null;

  return (
    <>
      <div className="rv-robin-detail-header">
        <div className="rv-robin-detail-breadcrumb">
          <span>Customization</span> / System Theme
        </div>
        <div className="rv-robin-detail-title">
          <span className="material-symbols-outlined">palette</span>
          System Theme
        </div>
        <div className="rv-robin-detail-subtitle">
          The baseline look for all workspaces. Workspaces inherit this unless they have custom overrides.
        </div>

        <div className="rv-robin-detail-meta">
          <div className="rv-robin-detail-meta-item">
            <span className="rv-robin-detail-meta-label">Preset</span>
            <span className="rv-robin-detail-meta-value highlight">
              {theme.preset.charAt(0).toUpperCase() + theme.preset.slice(1)}
            </span>
          </div>
          <div className="rv-robin-detail-meta-item">
            <span className="rv-robin-detail-meta-label">Accent</span>
            <span className="rv-robin-detail-meta-value" style={{ color: theme.primary_color }}>
              {theme.primary_color}
            </span>
          </div>
        </div>
      </div>

      <div className="rv-robin-color-picker-label" style={{ marginTop: '24px' }}>Theme Preset</div>
      <div className="rv-robin-preset-selector">
        {['dark', 'oled', 'medium', 'light'].map(p => (
          <button
            key={p}
            className={`rv-robin-preset-btn ${theme.preset === p ? 'active' : ''}`}
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

export function WorkspaceThemeDetail({ workspace, onUpdateColor, onInherit, onApply }: {
  workspace: WorkspaceItem;
  onUpdateColor: (hex: string) => void;
  onInherit: () => void;
  onApply: () => void;
}) {
  if (!workspace) return null;

  return (
    <>
      <div className="rv-robin-detail-header">
        <div className="rv-robin-detail-breadcrumb">
          <span>Customization</span> / {workspace.label}
        </div>
        <div className="rv-robin-detail-title">
          <span className="material-symbols-outlined">{workspace.icon}</span>
          {workspace.label}
        </div>
        <div className="rv-robin-detail-subtitle">
          {workspace.themeState === 'inherited'
            ? 'This workspace uses the system theme.'
            : workspace.themeState === 'individual'
            ? 'This workspace has its own accent color.'
            : 'CSS has been edited directly outside the system panel.'}
        </div>
      </div>

      {workspace.themeState === 'override' ? (
        <div className="rv-robin-diverged-card">
          <div className="rv-robin-diverged-card-text">
            The CSS file has been edited directly and no longer matches what's saved here.
            Click Apply to absorb your changes into the system.
          </div>
          <button className="rv-robin-apply-btn" onClick={onApply}>
            <span className="material-symbols-outlined">sync</span>
            Apply Changes
          </button>
        </div>
      ) : (
        <div className="rv-robin-inherit-row">
          <div
            className={`rv-robin-toggle ${workspace.themeState === 'inherited' ? 'on' : ''}`}
            onClick={() => {
              if (workspace.themeState === 'inherited') {
                onUpdateColor(workspace.primary_color);
              } else {
                onInherit();
              }
            }}
          />
          <span className="rv-robin-inherit-label">Inherit system theme</span>
        </div>
      )}

      <ColorPicker
        value={workspace.primary_color}
        onChange={onUpdateColor}
        disabled={workspace.themeState === 'inherited'}
      />

      <div className="rv-robin-detail-body" style={{ marginTop: '16px' }}>
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
          to inherited.
        </p>
      </div>
    </>
  );
}
