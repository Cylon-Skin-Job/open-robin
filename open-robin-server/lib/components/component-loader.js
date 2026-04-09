/**
 * Component Loader — scans ai/components/ for declarative UI definitions.
 *
 * Currently handles modals. Each modal subtype lives in its own folder:
 *   ai/components/modals/{subtype}/settings/config.md + styles.css
 *
 * The config.md uses YAML frontmatter (same conventions as SESSION.md).
 * The styles.css is sent to the client for scoped injection.
 *
 * Generic enough to serve future component types beyond modals.
 */

const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('../frontmatter');

const cache = {
  modals: new Map(),
};

/**
 * Scan ai/components/ and cache all discovered component definitions.
 *
 * @param {string} componentsDir - Absolute path to ai/components/
 */
function loadComponents(componentsDir) {
  cache.modals.clear();

  const modalsDir = path.join(componentsDir, 'modals');
  if (!fs.existsSync(modalsDir)) {
    console.log(`[ComponentLoader] No modals directory at ${modalsDir}`);
    return;
  }

  const entries = fs.readdirSync(modalsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;

    const subtype = entry.name;
    const subtypeDir = path.join(modalsDir, subtype);
    const definition = loadModalSubtype(subtype, subtypeDir);
    if (definition) {
      cache.modals.set(subtype, definition);
      console.log(`[ComponentLoader] Modal loaded: ${subtype}`);
    }
  }

  console.log(`[ComponentLoader] ${cache.modals.size} modal type(s) loaded`);
}

/**
 * Load a single modal subtype from its folder.
 *
 * @param {string} subtype - e.g. 'drag_file', 'alert'
 * @param {string} subtypeDir - Absolute path to the subtype folder
 * @returns {{ config: Object, styles: string } | null}
 */
function loadModalSubtype(subtype, subtypeDir) {
  const configPath = path.join(subtypeDir, 'settings', 'config.md');
  const stylesPath = path.join(subtypeDir, 'settings', 'styles.css');

  if (!fs.existsSync(configPath)) {
    console.warn(`[ComponentLoader] ${subtype}: missing settings/config.md, skipping`);
    return null;
  }

  const configContent = fs.readFileSync(configPath, 'utf8');
  const { frontmatter } = parseFrontmatter(configContent, 'component');
  if (!frontmatter) {
    console.warn(`[ComponentLoader] ${subtype}: config.md has no frontmatter, skipping`);
    return null;
  }

  let styles = '';
  if (fs.existsSync(stylesPath)) {
    styles = fs.readFileSync(stylesPath, 'utf8');
  }

  return { config: frontmatter, styles };
}

/**
 * Get a modal definition by subtype name.
 *
 * @param {string} subtype - e.g. 'drag_file', 'alert', 'toast'
 * @returns {{ config: Object, styles: string } | null}
 */
function getModalDefinition(subtype) {
  return cache.modals.get(subtype) || null;
}

module.exports = { loadComponents, getModalDefinition };
