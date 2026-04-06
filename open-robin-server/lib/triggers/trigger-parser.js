/**
 * Trigger Parser — parses TRIGGERS.md files containing multiple YAML blocks.
 *
 * Each block is delimited by --- markers (same as frontmatter).
 * A single TRIGGERS.md can contain many trigger definitions.
 */

const fs = require('fs');
const { parseFrontmatter } = require('../watcher/filter-loader');

/**
 * Parse a TRIGGERS.md file into an array of trigger definitions.
 *
 * The file contains multiple YAML blocks separated by --- markers:
 *
 *   ---
 *   name: source-file-change
 *   type: file-change
 *   ...
 *   ---
 *
 *   ---
 *   name: daily-freshness
 *   type: cron
 *   ...
 *   ---
 *
 * @param {string} filePath - Absolute path to TRIGGERS.md
 * @returns {Array<Object>} Array of parsed trigger definitions
 */
function parseTriggerBlocks(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.error(`[TriggerParser] Failed to read ${filePath}: ${err.message}`);
    return [];
  }

  const blocks = [];

  // Split on --- boundaries. Each block is a complete frontmatter section.
  // We look for lines that are exactly "---" and extract content between pairs.
  const lines = content.split('\n');
  let inBlock = false;
  let blockLines = [];

  for (const line of lines) {
    if (line.trim() === '---') {
      if (inBlock) {
        // End of block — parse it
        const yaml = blockLines.join('\n');
        const wrapped = `---\n${yaml}\n---\n`;
        const { frontmatter } = parseFrontmatter(wrapped);
        if (frontmatter && Object.keys(frontmatter).length > 0) {
          blocks.push(frontmatter);
        }
        blockLines = [];
        inBlock = false;
      } else {
        // Start of block
        inBlock = true;
        blockLines = [];
      }
    } else if (inBlock) {
      blockLines.push(line);
    }
  }

  return blocks;
}

module.exports = { parseTriggerBlocks };
