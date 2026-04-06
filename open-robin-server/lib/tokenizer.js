/**
 * Token counting utility — shared across the project.
 *
 * Uses gpt-tokenizer (cl100k_base encoding, GPT-4 / Claude-approximate).
 * Pure JS, no native deps, no WASM.
 */

const { encode } = require('gpt-tokenizer');

/**
 * Count tokens in a string.
 *
 * @param {string} text
 * @returns {number}
 */
function countTokens(text) {
  if (!text) return 0;
  return encode(text).length;
}

/**
 * Count tokens in a file.
 *
 * @param {string} filePath - Absolute path
 * @returns {number}
 */
function countFileTokens(filePath) {
  const fs = require('fs');
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return countTokens(content);
  } catch {
    return 0;
  }
}

module.exports = { countTokens, countFileTokens };
