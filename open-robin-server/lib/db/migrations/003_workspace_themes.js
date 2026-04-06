/**
 * Migration 003 — Workspace themes + customization tab
 *
 * Adds: system_theme, workspaces, workspace_themes tables
 * Seeds: default dark theme, 7 stub workspaces, customization tab + wiki page
 */

const { generateThemeCss } = require('../../robin/theme-css');

exports.up = async function (knex) {
  // --- New tables ---

  await knex.schema.createTable('system_theme', (t) => {
    t.text('id').primary().defaultTo('default');
    t.text('preset').defaultTo('dark');
    t.text('primary_color').defaultTo('#4fc3f7');
    t.text('primary_rgb').defaultTo('79, 195, 247');
    t.text('theme_css').notNullable();
    t.text('updated_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('workspaces', (t) => {
    t.text('id').primary();
    t.text('label').notNullable();
    t.text('icon').defaultTo('folder');
    t.text('description');
    t.text('repo_path');
    t.integer('sort_order').defaultTo(0);
    t.text('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('workspace_themes', (t) => {
    t.text('workspace_id').primary().references('id').inTable('workspaces');
    t.text('primary_color').defaultTo('#4fc3f7');
    t.text('primary_rgb').defaultTo('79, 195, 247');
    t.text('theme_css');
    t.text('updated_at').defaultTo(knex.fn.now());
  });

  // --- Seed: system_theme ---

  const defaultCss = generateThemeCss('dark', '#4fc3f7', '79, 195, 247');

  await knex('system_theme').insert({
    id: 'default',
    preset: 'dark',
    primary_color: '#4fc3f7',
    primary_rgb: '79, 195, 247',
    theme_css: defaultCss,
  });

  // --- Seed: workspaces ---

  await knex('workspaces').insert([
    { id: 'system',         label: 'System',          icon: 'settings',        description: 'System-level theme baseline',            sort_order: 0 },
    { id: 'chat',           label: 'Chat',            icon: 'chat',            description: 'Conversational workspace',                sort_order: 1 },
    { id: 'home-office',    label: 'Home Office',     icon: 'home',            description: 'Docs, sheets, email, calendar',           sort_order: 2 },
    { id: 'bookkeeping',    label: 'Bookkeeping App', icon: 'account_balance', description: 'Financial tracking and reporting',        sort_order: 3 },
    { id: 'media-center',   label: 'Media Center',    icon: 'play_circle',     description: 'Media library and playback',              sort_order: 4 },
    { id: 'code-editor',    label: 'Code Editor',     icon: 'code',            description: 'Development environment',                 sort_order: 5 },
    { id: 'research-vault', label: 'Research Vault',  icon: 'science',         description: 'Papers, books, and reference material',   sort_order: 6 },
  ]);

  // --- Seed: customization tab ---

  await knex('system_tabs').insert({
    id: 'customization',
    label: 'Customization',
    icon: 'palette',
    description: 'Set your system theme and customize workspace accent colors. Changes here flow to every workspace unless overridden.',
    sort_order: 5,
  });

  // --- Seed: customization wiki page ---

  await knex('system_wiki').insert({
    slug: 'customization',
    title: 'Customization',
    content: `## How theming works

Open Robin uses a simple approach: pick one accent color and one brightness level, and the entire interface updates to match. Every button, border, badge, and background derives from these two choices.

## System theme vs workspace themes

The system theme is the baseline. It applies to the Robin system panel itself and to every workspace that hasn't been customized. Think of it as the default look.

Each workspace can optionally override the system theme with its own accent color. When a workspace inherits the system theme, changing the system color changes that workspace too. When a workspace has a custom theme, it keeps its own color regardless of system changes.

## The color picker

Choose from eight curated accent colors, or type in any hex value. The system automatically generates all the subtle variations — hover states, active fills, borders — from your single choice.

## Editing CSS by hand

For advanced customization beyond the color picker, you can edit the CSS file directly:

\`ai/views/settings/themes.css\`

This gives you full control over every visual variable. After editing, come back to this panel and click Apply to save your changes. This ensures your edits are preserved in the system database and won't be lost if you switch themes later.

## What you can change

- **Accent color** — the primary highlight used for active states, links, and interactive elements
- **Theme preset** — Light, Medium, Dark, or OLED Black (controls all background and text values)
- **Per-workspace overrides** — give each workspace its own accent color while keeping the same brightness level

## Per-view overrides

Individual views within a workspace can have their own accent color too. Each view folder has three siblings — \`chat/\`, \`content/\`, and \`settings/\`. Drop a \`themes.css\` file into the view's settings folder:

\`ai/views/{viewer-name}/settings/themes.css\`

This overrides the workspace theme for just that view. You only need to include the variables you want to change — everything else flows down from the workspace, which flows down from the system.

The full cascade is: **System → Workspace → View**. Each level only overrides what it declares. Remove the file to go back to inheriting.

## What stays consistent

The Robin system panel always uses the system theme. It never inherits workspace colors. This keeps the "control room" visually stable regardless of which workspace you're in.`,
    context: 'Theme system: one accent color + one brightness preset = full visual identity. System theme stored in SQLite (system_theme table). Per-workspace overrides stored in workspace_themes table. Filesystem CSS at ai/views/settings/themes.css is a propagated copy, not source of truth. Three states per workspace: inheriting (matches system), custom (matches workspace_themes), diverged (hand-edited, matches neither). Apply button absorbs hand-edited CSS back into SQLite. Toggle preserves custom CSS in SQLite even when set to inherit.',
    tab: 'customization',
    description: 'Theme system, color picker, workspace overrides, and hand-editing CSS',
    surface_when: 'User asks about colors, themes, dark mode, customization, or visual appearance',
    category: 'customization',
    sort_order: 0,
    locked: 1,
    updated_at: Date.now(),
  });
};

exports.down = async function (knex) {
  await knex('system_wiki').where('slug', 'customization').del();
  await knex('system_tabs').where('id', 'customization').del();
  await knex.schema.dropTableIfExists('workspace_themes');
  await knex.schema.dropTableIfExists('workspaces');
  await knex.schema.dropTableIfExists('system_theme');
};
