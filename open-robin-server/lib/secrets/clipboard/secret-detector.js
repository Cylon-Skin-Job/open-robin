/**
 * Secret-pattern detector for clipboard items.
 *
 * Given a raw clipboard string, returns the metadata that should land in the
 * `clipboard_index` row:
 *   - For secret-shaped values: { type: 'secret', preview: fingerprint(value) }
 *   - Otherwise:                { type, preview }
 *     where `type` is inferred ('link' | 'code' | 'text') and `preview` is the
 *     first DISPLAY_PREVIEW_MAX_CHARS codepoints of the value.
 *
 * Pure module: no I/O, no logging, no top-level mutable state.
 *
 * Pattern set (prefix + shape rules) and non-match allow-list are enumerated
 * in CLIPBOARD_BRIEFS/WAVE-0-DECISIONS.md D2. Add new patterns to PREFIXES or
 * SHAPES below — both arrays are the only places to edit.
 */

'use strict';

const { compute: fingerprint } = require('../api-keys/fingerprint');
const { endsWithKnownExtension } = require('../../file-extensions');

const DISPLAY_PREVIEW_MAX_CHARS = 80;

// Prefix-match rules (case-sensitive, ordered cheapest-first). Some entries
// gate on minimum length to avoid noisy short tokens (e.g. `sk-` alone).
const PREFIXES = [
  { regex: /^sk_test_/ },
  { regex: /^sk_live_/ },
  { regex: /^rk_test_/ },
  { regex: /^rk_live_/ },
  { regex: /^pk_test_/ },                       // Stripe publishable; treated as secret in clipboard context (D2)
  { regex: /^pk_live_/ },
  { regex: /^ghp_/ },
  { regex: /^gho_/ },
  { regex: /^ghu_/ },
  { regex: /^ghs_/ },
  { regex: /^ghr_/ },
  { regex: /^github_pat_/ },
  { regex: /^xoxb-/ },
  { regex: /^xoxp-/ },
  { regex: /^xoxa-/ },
  { regex: /^xoxr-/ },
  { regex: /^xoxe\./ },
  { regex: /^sk-ant-/ },
  { regex: /^sk-/, minLength: 32 },             // OpenAI; loose, gate on length
  { regex: /^AIza/, minLength: 35 },            // Google API key
  { regex: /^ya29\./ },                         // Google OAuth access token
  { regex: /^AKIA[0-9A-Z]{16}$/ },              // AWS access key id
  { regex: /^ASIA[0-9A-Z]{16}$/ },              // AWS session access key id
  { regex: /^Bearer / },                        // HTTP Authorization header
  { regex: /^eyJ/, minLength: 60 },             // JWT
  { regex: /^npm_/ },
  { regex: /^glpat-/ },
  { regex: /^dop_v1_/ },
  { regex: /^dor_v1_/ },
  { regex: /^doo_v1_/ },
];

// Shape-match rules — fire only if no prefix matched and the allow-list didn't
// short-circuit. Character sets are deliberately tight so paths, URLs, and
// long natural strings don't get fingerprinted as secrets.
const SHAPES = [
  { regex: /^[0-9a-fA-F]+$/,        minLength: 32 }, // long hex
  { regex: /^[A-Za-z0-9_\-]+$/,     minLength: 40 }, // long base64url
  { regex: /^[A-Za-z0-9._\-+=]+$/,  minLength: 64 }, // long opaque token (alphanumerics + safe punctuation, no slash/colon)
];

function isAllowedNonSecret(s) {
  if (s.length < 16) return true;
  if (s.includes('://')) return true;
  if (s.includes('/') || s.includes('\\')) return true;        // file paths, URL paths, glob patterns
  if (endsWithKnownExtension(s)) return true;                  // bare filenames (no slash) — see lib/file-extensions.js
  if (/(\*\*|^## |```)/m.test(s)) return true;
  // Any whitespace beyond a single trailing newline.
  const stripped = s.endsWith('\n') ? s.slice(0, -1) : s;
  if (/\s/.test(stripped)) return true;
  return false;
}

function matchPrefix(value) {
  for (const p of PREFIXES) {
    if (p.regex.test(value) && (p.minLength === undefined || value.length >= p.minLength)) {
      return true;
    }
  }
  return false;
}

function matchShape(value) {
  for (const s of SHAPES) {
    if (value.length < s.minLength) continue;
    if (!s.regex.test(value)) continue;
    if (s.forbid && value.includes(s.forbid)) continue;
    return true;
  }
  return false;
}

function inferNonSecretType(value) {
  if (/^https?:\/\//.test(value)) return 'link';
  if (value.includes('`') || /^```/m.test(value)) return 'code';
  return 'text';
}

function truncatePreview(value) {
  const codepoints = Array.from(value);
  if (codepoints.length <= DISPLAY_PREVIEW_MAX_CHARS) return value;
  return codepoints.slice(0, DISPLAY_PREVIEW_MAX_CHARS).join('');
}

function detect(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return { type: 'text', preview: '' };
  }
  // Prefix check runs before the allow-list so `Bearer abc...` (which contains
  // whitespace) still classifies as secret on the strength of its prefix.
  if (matchPrefix(value)) {
    return { type: 'secret', preview: fingerprint(value) };
  }
  if (isAllowedNonSecret(value)) {
    return { type: inferNonSecretType(value), preview: truncatePreview(value) };
  }
  if (matchShape(value)) {
    return { type: 'secret', preview: fingerprint(value) };
  }
  return { type: inferNonSecretType(value), preview: truncatePreview(value) };
}

module.exports = { detect };
