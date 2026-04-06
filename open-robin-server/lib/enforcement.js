/**
 * Hardwired tool enforcement — settings/ folders are write-locked for AI.
 *
 * Any folder named "settings" (case-insensitive, with or without dot prefix)
 * is permanently off-limits for write operations. This is not configurable,
 * not trigger-driven, and not in TRIGGERS.md. Hardcoded.
 *
 * AI can READ from settings/ folders. AI can NEVER WRITE to them.
 */

const path = require('path');

const SETTINGS_PATTERN = /^\.?settings$/i;

const WRITE_TOOLS = new Set(['write_file', 'edit_file']);

const PATH_ARG_MAP = {
  write_file: 'file_path',
  edit_file: 'file_path',
};

/**
 * Check if a tool call should be bounced due to settings/ enforcement.
 *
 * @param {string} toolName - Name of the tool being called
 * @param {Object} parsedArgs - Parsed arguments from the tool call
 * @returns {null | { message: string }} null if allowed, or bounce object
 */
function checkSettingsBounce(toolName, parsedArgs) {
  if (!WRITE_TOOLS.has(toolName)) return null;

  const argName = PATH_ARG_MAP[toolName];
  const filePath = argName ? parsedArgs[argName] : null;
  if (!filePath) return null;

  const segments = filePath.split(/[/\\]/);
  const hasSettings = segments.some(seg => SETTINGS_PATTERN.test(seg));

  if (hasSettings) {
    return {
      message: '[RESTRICTED] Cannot write to settings/ folders. Settings are human-managed only. Drop the file in the parent folder instead.',
    };
  }

  return null;
}

module.exports = { checkSettingsBounce };
