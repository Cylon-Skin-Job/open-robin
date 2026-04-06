/**
 * Theme CSS generator — produces CSS custom property blocks from a preset + accent color.
 *
 * Used by migrations (seed data), handlers (runtime updates), and state detection (diff).
 * Must be deterministic: same inputs always produce identical output strings.
 */

const PRESETS = {
  dark: {
    bgVoid: '#0a0a0a',
    bgInset: '#0d0d0d',
    bgBase: '#111111',
    bgCard: '#161616',
    bgHover: '#1c1c1c',
    borderSubtle: '#1e1e1e',
    borderDefault: '#282828',
    textPrimary: '#e0e0e0',
    textSecondary: '#aaaaaa',
    textDim: '#666666',
  },
  oled: {
    bgVoid: '#000000',
    bgInset: '#050505',
    bgBase: '#0a0a0a',
    bgCard: '#111111',
    bgHover: '#161616',
    borderSubtle: '#1a1a1a',
    borderDefault: '#222222',
    textPrimary: '#e0e0e0',
    textSecondary: '#aaaaaa',
    textDim: '#666666',
  },
  medium: {
    bgVoid: '#1a1a1a',
    bgInset: '#1e1e1e',
    bgBase: '#242424',
    bgCard: '#2a2a2a',
    bgHover: '#303030',
    borderSubtle: '#333333',
    borderDefault: '#3a3a3a',
    textPrimary: '#e0e0e0',
    textSecondary: '#bbbbbb',
    textDim: '#777777',
  },
  light: {
    bgVoid: '#f5f5f5',
    bgInset: '#eeeeee',
    bgBase: '#ffffff',
    bgCard: '#fafafa',
    bgHover: '#f0f0f0',
    borderSubtle: '#e0e0e0',
    borderDefault: '#d0d0d0',
    textPrimary: '#1a1a1a',
    textSecondary: '#555555',
    textDim: '#999999',
  },
};

/**
 * Convert a hex color string to an "R, G, B" string.
 * @param {string} hex - e.g. "#4fc3f7" or "4fc3f7"
 * @returns {string} e.g. "79, 195, 247"
 */
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

/**
 * Generate a full themes.css string from a preset name and accent color.
 * @param {string} preset - 'dark' | 'oled' | 'medium' | 'light'
 * @param {string} hexColor - e.g. "#4fc3f7"
 * @param {string} rgbStr - e.g. "79, 195, 247"
 * @returns {string} Complete CSS with :root custom properties
 */
function generateThemeCss(preset, hexColor, rgbStr) {
  const p = PRESETS[preset] || PRESETS.dark;

  return `:root {
  /* Accent color */
  --color-primary: ${hexColor};
  --color-primary-rgb: ${rgbStr};
  --color-primary-ghost: rgba(${rgbStr}, 0.05);
  --color-primary-fill: rgba(${rgbStr}, 0.08);
  --color-primary-dim: rgba(${rgbStr}, 0.12);
  --color-primary-border: rgba(${rgbStr}, 0.25);

  /* Background scale */
  --bg-void: ${p.bgVoid};
  --bg-inset: ${p.bgInset};
  --bg-base: ${p.bgBase};
  --bg-card: ${p.bgCard};
  --bg-hover: ${p.bgHover};

  /* Borders */
  --border-subtle: ${p.borderSubtle};
  --border-default: ${p.borderDefault};

  /* Text */
  --text-primary: ${p.textPrimary};
  --text-secondary: ${p.textSecondary};
  --text-dim: ${p.textDim};

  /* Scrollbar */
  --scrollbar-thumb: ${p.borderDefault};
  --scrollbar-thumb-hover: rgba(${rgbStr}, 0.33);

  /* Shadows */
  --shadow-soft: 0 2px 8px rgba(0, 0, 0, 0.3);
  --shadow-medium: 0 4px 16px rgba(0, 0, 0, 0.4);

  /* Transitions */
  --transition-fast: 150ms;

  /* Status */
  --status-on: #4caf50;
  --status-off: #666666;
  --status-error: #f44336;
  --status-warn: #ff9800;
}
`;
}

module.exports = { generateThemeCss, hexToRgb, PRESETS };
