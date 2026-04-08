export interface Tab {
  id: string;
  label: string;
  icon: string;
  description: string;
  sort_order: number;
}

export interface WikiPage {
  slug: string;
  title: string;
  content: string;
  context?: string;
  description?: string;
  tab?: string;
}

export interface ConfigItem {
  key: string;
  value: string;
  tab: string;
  section: string;
  icon: string;
  description: string;
  wiki_slug?: string;
  sort_order: number;
  parent?: string;
}

export interface CliItem {
  id: string;
  name: string;
  author: string;
  description: string;
  version?: string;
  pricing_url?: string;
  docs_url?: string;
  installed: number;
  active: number;
  sort_order: number;
}

export interface SystemTheme {
  preset: string;
  primary_color: string;
  primary_rgb: string;
  theme_css: string;
}

export interface WorkspaceItem {
  id: string;
  label: string;
  icon: string;
  description: string;
  themeState: 'inherited' | 'individual' | 'override';
  primary_color: string;
}

export const COLOR_SWATCHES = [
  { name: 'Sky',      hex: '#4fc3f7' },
  { name: 'Teal',     hex: '#4dd0c7' },
  { name: 'Lavender', hex: '#9fa8da' },
  { name: 'Sage',     hex: '#81c784' },
  { name: 'Peach',    hex: '#f0a07a' },
  { name: 'Steel',    hex: '#90a4ae' },
  { name: 'Lilac',    hex: '#b39ddb' },
  { name: 'Ice',      hex: '#80deea' },
];
