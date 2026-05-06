# Wave 0 — Locked Decisions

**Purpose:** Lock the §10 open questions from `docs/CLIPBOARD_KEYCHAIN_REDESIGN.md` that block Wave 1 dispatch. Read this once before reading any Wave 1 brief.

**Status:** Locked 2026-05-05.

---

## D1. Module location

**Decision:** Move `open-robin-server/lib/clipboard/` → `open-robin-server/lib/secrets/clipboard/`.

**Why:** The redesign reuses the Secrets Manager's storage primitive (keychain + SQLite metadata index + read contract). Mirroring the api-keys layout (`lib/secrets/api-keys/{backend,handlers,index-table,fingerprint}.js`) makes the architectural relationship explicit and lets the two submodules share helpers cleanly (e.g., the existing `lib/secrets/api-keys/fingerprint.js`).

**Implication for Wave 1 briefs:** Every new file lands under `open-robin-server/lib/secrets/clipboard/`. No file lands under `open-robin-server/lib/clipboard/`. The old `lib/clipboard/queries.js` and `lib/clipboard/ws-handlers.js` are deleted in Wave 2 (the spine session) — Wave 1 sessions do not touch them.

---

## D2. Secret-pattern regex set (resolves §10 #1)

**Decision:** v1 detector matches the prefixes and shapes below. Each match sets `type='secret'`. Order matters — first match wins (cheapest checks first).

### Prefix matches (case-sensitive)

| Pattern | Source |
|--------|--------|
| `^sk_test_` | Stripe (test) |
| `^sk_live_` | Stripe (live) |
| `^rk_test_` / `^rk_live_` | Stripe (restricted) |
| `^pk_test_` / `^pk_live_` | Stripe (publishable, still treat as secret in clipboard context) |
| `^ghp_` / `^gho_` / `^ghu_` / `^ghs_` / `^ghr_` | GitHub PAT / OAuth / user-to-server / server-to-server / refresh |
| `^github_pat_` | GitHub fine-grained PAT |
| `^xoxb-` / `^xoxp-` / `^xoxa-` / `^xoxr-` / `^xoxe\.` | Slack bot / user / app / refresh / refresh-token-prefix |
| `^sk-ant-` | Anthropic |
| `^sk-` (length ≥ 32) | OpenAI (loose; the `sk-` prefix alone is too noisy, gate on length) |
| `^AIza` (length 35–45) | Google API key |
| `^ya29\.` | Google OAuth access token |
| `^AKIA[0-9A-Z]{16}$` | AWS access key id |
| `^ASIA[0-9A-Z]{16}$` | AWS session access key id |
| `^Bearer ` | HTTP Authorization header |
| `^eyJ` (length ≥ 60) | JWT (`eyJ` is the URL-safe-base64 encoding of `{"`) |
| `^npm_` | npm token |
| `^glpat-` | GitLab PAT |
| `^dop_v1_` / `^dor_v1_` / `^doo_v1_` | DigitalOcean |

### Shape matches (run only if no prefix matched)

| Shape | Threshold |
|-------|-----------|
| Hex string, no spaces | length ≥ 32 |
| Base64url string, no spaces | length ≥ 40 |
| Alphanumeric token with safe punctuation (`. _ - + =`), length ≥ 64 | catches generic opaque tokens; deliberately excludes `/` and `:` |

### Non-matches (explicit allow-list — do NOT mark as secret)

- Strings containing whitespace beyond a single trailing newline (paragraphs, code).
- Strings containing `://` (URLs).
- Strings containing `/` or `\` (file paths, URL paths, glob patterns).
- Strings ending in a known file extension per `open-robin-server/lib/file-extensions.js` (bare filenames).
- Strings with markdown markers (`**`, `## `, `\`\`\``).
- Strings shorter than 16 characters (too short to be useful credentials; preview-truncation already handles them).

**Note 2026-05-06:** the opaque shape rule and the `/` + extension allow-list rules were tightened after a screenshot-path false-positive surfaced in v1. Earlier wording was "no whitespace and no `://`, length ≥ 64" which fingerprinted any 64+ char path. The current charset (`A-Za-z0-9._\-+=`) is the correct narrowing.

**Why this list:** Covers the providers most likely to appear in this user's clipboard (Stripe, GitHub, Anthropic, OpenAI, Google, AWS, Slack, GitLab, npm, DigitalOcean) plus the universal JWT and Bearer-header shapes. Prefix matches are O(1); shape matches are bounded regex. False positives on the shape rules are acceptable — fingerprinting a non-secret hash is a UX nit, not a leak.

**Implication for Wave 1 briefs:** Brief A (`secret-detector`) implements exactly this list. Brief A's tests use one positive example per row plus a few non-match cases. The regex list lives in a single `PATTERNS` constant array in the detector module so additions go in one place.

---

## D3. Log-preview truncation length (resolves §10 #9)

**Decision:** **16 characters + `…`** for non-secret previews in logs. Hard-coded constant for v1; configurable later via System Settings if needed.

**Why:** 16 chars is enough to recognize URLs (`https://example.…`), file paths (`/Users/foo/proje…`), and common copy-paste strings (`function handleR…`) for debugging, while too short to leak a useful credential prefix. Aligns with the §3i guidance.

**Implication for Wave 1 briefs:** Brief B (`log-preview`) exports `LOG_PREVIEW_MAX_CHARS = 16` as a named constant alongside the formatter so other call sites can reference it. The ellipsis character is U+2026 (`…`), not three dots.

---

## D4. Existing-table-name correction

**Decision:** The legacy table is named **`clipboard_items`** (per migration 005), not `clipboard`. The redesign doc has been corrected.

**Implication for Wave 1 briefs:** The migration in Brief C drops `clipboard_items`. The new table stays `clipboard_index` per §3c.

---

## D5. Clipboard purge on secret save

**Decision:** Whenever any value is saved to the Secrets Manager (api-keys today, oauth/passwords/etc. tomorrow), the secrets backend computes `sha256(value)` and calls `clipboardBackend.deleteByContentHash(hash)`. Any clipboard row whose `content_hash` matches is purged (index row + keychain entry + `clipboard:deleted` UEB event).

**Why:** Common pattern is "user copies key from provider dashboard → pastes into secrets popover → hits save." The clipboard echo of the saved value is no longer needed and represents a small ongoing leak surface. One-way coupling at save time eliminates the echo without any user effort. Pairs with the trash-can affordance (which handles the manual case) for full coverage.

**Hook location:** At the shared keychain-write call site, so every current and future secrets submodule gets the behavior automatically. Specifically:
- If `open-robin-server/lib/secrets.js` exposes a shared `set(account, service, value)` helper used by every submodule, fold the purge into that function.
- If submodules call `security` directly without a shared wrapper, introduce `open-robin-server/lib/secrets/save-with-clipboard-purge.js` as a thin wrapper and migrate each backend's save path to call it.

The Wave 2 author confirms which shape applies during exploration and picks the option with the smaller diff.

**UI feedback:** Silent. The purge is a privacy hygiene, not a user-visible action. The `clipboard:deleted` UEB event already updates any open popup live, which is the right level of feedback. Toast notifications would over-emphasize a routine cleanup.

**Trigger semantics:** Save-only — never on keystroke, never on input focus. This falls out of the architecture: the hash can only be computed server-side after the value arrives over WS, and the input-field state never reaches the server before submit. No extra discipline required at the save site.

**Edge cases:**
- User edits the value in the input before saving → hashes differ → no purge. Correct.
- Hash uniqueness in `clipboard_index` (`UNIQUE(content_hash)`) means at most one row matches. Delete-by-hash is idempotent.
- WS payload of the secret-save itself: already redacted by the W1D logger map; not a leak.

**Implication for Wave 2:** Brief W2 must:
1. Add `deleteByContentHash(hash)` to the clipboard backend's public surface (returns `{ deleted: 0 | 1 }`).
2. Wire the purge call into the shared secrets-save path, decided after exploration.
3. Add a test: save an api-key whose value matches an existing clipboard row → row disappears, keychain entry gone, UEB event fired.

---

## Decisions deferred (NOT locked here, do not block Wave 1)

These remain open for the implementation spec author or for Wave 2/3:

- §10 #2 — pause-on-secrets-popover-open (§3j)
- §10 #3 — per-app clipboard policy
- §10 #4 — cap configurability (default: hard-code 30 for v1)
- §10 #5 — `clipboard:added` UEB event payload
- §10 #7 — trash-can confirm vs immediate-with-undo
- §10 #8 — click-to-insert latency LRU (default: measure first, build only if needed)

Wave 2 brief will lock #4, #5, #7, #8 since they affect backend + handler behavior.
