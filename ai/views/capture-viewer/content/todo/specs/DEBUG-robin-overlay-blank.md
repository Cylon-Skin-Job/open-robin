# DEBUG: Robin System Panel Overlay — blank content after SPEC-18 class prefix migration

## Your Mission

Use Playwright to diagnose why the Robin system panel overlay darkens the screen but displays no content. **You are diagnosing, not fixing.** When you find the root cause, STOP and report it. Do not write a fix unless explicitly asked.

**Model recommendation: Opus 4.6** — needs careful hypothesis testing.

---

## How the user will run this

The user will spawn Playwright in a loop to interact with the app. Playwright will:
1. Connect to `http://localhost:3001`
2. Click the raven icon (top-right corner of the header) to open the Robin overlay
3. Capture: DOM snapshot of `.rv-robin-overlay` and its descendants, computed styles on key elements, console errors, Network tab WS messages
4. Report the findings back so you can test hypotheses against real data

You do NOT need to run Playwright yourself unless the user explicitly asks. Your job is to consume the Playwright output and identify the root cause.

---

## Server log — read this FIRST for every iteration

**Location:** `/Users/rccurtrightjr./projects/open-robin/open-robin-server/server-live.log`

Every `console.log` from the server gets timestamped and written here, including forwarded client logs (anything the browser logs via `client_log` messages gets prefixed with `[CLIENT ...]`). This file often captures stuff that was meant for the frontend console but got routed server-side.

**On every debug iteration:**
1. Read the last ~200 lines of `server-live.log` with `tail -200`
2. Look for `[CLIENT ERROR]`, `[CLIENT WARN]`, or any stack traces
3. Look for WS messages involving `robin:tabs`, `robin:items`, `robin:wiki`, `robin:theme-data`
4. Cross-reference timestamps with when the user clicked the raven icon

The log file is already ~4.5 MB. Read only the tail unless you need history.

---

## What the user observes

1. Click the raven icon (top-right button) → dark overlay covers the entire screen
2. The overlay IS visible (screen goes dark — this proves `.rv-robin-overlay` is rendering with its `background: var(--bg-solid, #0a0a0a)`)
3. No other content is visible: no "Open Robin" header text, no chat messages on the left, no settings tabs on the right
4. Closing the overlay (Escape key or clicking where the X button should be) returns to the normal app

---

## What worked immediately before SPEC-18

Before SPEC-18, the Robin panel rendered correctly with:
- Header with "Open Robin" title + raven icon + "System Panel" subtitle + close button
- Left column with 5 placeholder chat messages (from `CHAT_MESSAGES` constant — hardcoded, not from server)
- Right column with settings tabs loaded from the server via WebSocket (`robin:tabs` message)

SPEC-02 (sub-component extraction: WikiDetail, ConfigDetail, CLIDetail, ThemeDetail) was verified working by the user before SPEC-18 ran.

---

## What SPEC-18 did

SPEC-18 prefixed all CSS class names with `.rv-` across 15 CSS files in `open-robin-client/src/` and updated all JSX/TSX className references to match. robin.css had 161 class definitions renamed from `.robin-*` to `.rv-robin-*`.

SPEC-18 session notes mentioned these non-trivial fixes:
- `WikiDetail.tsx:9` querySelector updated to `.rv-robin-wiki-link-btn`
- `App.tsx:122/148` `robin-icon-btn` → `rv-robin-icon-btn` (flagged as "missed in robin.css task")
- `App.tsx:169` dynamic layout template literal
- `src/index.css` modal classes renamed to `.rv-confirm-modal-*` to avoid collision with `modal.css` → `Sidebar.tsx:363-373` updated

SPEC-18 did NOT touch any file outside `open-robin-client/src/`.

---

## Already verified by prior session

These facts are established. Do not re-verify unless a new signal contradicts them.

1. **Server state**: Port 3001 was killed, `dist/` deleted, `node_modules/.vite` cache deleted, fresh `npm run build` succeeded (384 modules, no errors), fresh server start responds with HTTP 200. Hard refresh done. Problem persists.

2. **Built CSS has only prefixed classes**: `grep -oE '(^|[^-a-z])\.robin-[a-z-]+' dist/assets/*.css` returns zero unprefixed matches.

3. **Built JS has only prefixed class strings**: `grep -oE '(^|[^-])robin-[a-z-]+' dist/assets/*.js` returns zero standalone `robin-` matches.

4. **RobinOverlay.tsx and siblings use all prefixed classes**: 152 occurrences of `className=.*robin-` across the 5 Robin files, every one is `rv-robin-*`.

5. **robin.css has 161 class definitions, all `.rv-robin-*`**: `grep -c '^\.rv-robin-' robin.css` = 161. `grep -c '^\.robin-' robin.css` = 0.

6. **No compound selectors in robin.css use unprefixed `.robin-*`**: `grep '\.robin-[a-z]' robin.css` returns nothing.

7. **`--bg-solid` is defined** in `variables.css` as `#000000` (the source of the dark overlay background the user sees).

8. **External stylesheet exists**: `ai/views/settings/styles/views.css` has 165 unprefixed classes, loaded via `main.tsx` import. Not touched by SPEC-18. None of its selectors match `.robin-*` or `.rv-robin-*`.

---

## Files to inspect (with line counts)

| File | Lines | Purpose |
|------|-------|---------|
| `open-robin-client/src/components/Robin/RobinOverlay.tsx` | 426 | Main component |
| `open-robin-client/src/components/Robin/robin.css` | 1203 | All Robin panel styles |
| `open-robin-client/src/components/Robin/robin-types.ts` | 68 | Shared types |
| `open-robin-client/src/components/Robin/WikiDetail.tsx` | 52 | Wiki page renderer |
| `open-robin-client/src/components/Robin/ConfigDetail.tsx` | 52 | Config item detail |
| `open-robin-client/src/components/Robin/CLIDetail.tsx` | 89 | CLI detail + registry |
| `open-robin-client/src/components/Robin/ThemeDetail.tsx` | 191 | Theme editors |
| `open-robin-client/src/components/App.tsx` | ~500 | Renders `<RobinOverlay open={robinOpen} />` at line 178 |
| `open-robin-client/src/lib/ws-client.ts` | ~120 | Robin pub/sub coordinator |
| `open-robin-client/src/lib/ws/stream-handlers.ts` | new | Stream handlers |
| `open-robin-client/src/lib/ws/thread-handlers.ts` | new | Thread handlers |
| `open-robin-client/src/lib/ws/file-handlers.ts` | new | File handlers |
| `ai/views/settings/styles/views.css` | 165 classes | External stylesheet |
| `open-robin-server/server-live.log` | ~4.5 MB | Server log with forwarded client logs |

---

## Playwright diagnostic script — what the user will run

Something like this:

```js
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  // Capture console messages
  const consoleMessages = [];
  page.on('console', msg => {
    consoleMessages.push({ type: msg.type(), text: msg.text() });
  });

  // Capture page errors
  const pageErrors = [];
  page.on('pageerror', err => {
    pageErrors.push({ message: err.message, stack: err.stack });
  });

  // Capture WebSocket frames
  const wsFrames = [];
  page.on('websocket', ws => {
    ws.on('framesent', frame => wsFrames.push({ dir: 'out', payload: frame.payload }));
    ws.on('framereceived', frame => wsFrames.push({ dir: 'in', payload: frame.payload }));
  });

  await page.goto('http://localhost:3001');
  await page.waitForLoadState('networkidle');

  // Click the Robin raven icon in the header
  await page.locator('button:has(span:text("raven"))').click();
  await page.waitForTimeout(1000);

  // Snapshot the overlay DOM
  const overlayHTML = await page.locator('.rv-robin-overlay').innerHTML().catch(() => 'NOT FOUND');

  // Computed styles on key elements
  const computedStyles = await page.evaluate(() => {
    const overlay = document.querySelector('.rv-robin-overlay');
    if (!overlay) return { error: 'overlay not found' };
    const header = overlay.querySelector('.rv-robin-overlay-header');
    const body = overlay.querySelector('.rv-robin-overlay-body');
    const chat = overlay.querySelector('.rv-robin-chat');
    const settings = overlay.querySelector('.rv-robin-settings');

    const getStyles = (el) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        className: el.className,
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
        width: rect.width,
        height: rect.height,
        childCount: el.children.length
      };
    };

    return {
      overlay: getStyles(overlay),
      header: getStyles(header),
      body: getStyles(body),
      chat: getStyles(chat),
      settings: getStyles(settings),
      overlayChildrenClasses: Array.from(overlay.children).map(c => c.className)
    };
  });

  console.log('=== CONSOLE MESSAGES ===');
  consoleMessages.forEach(m => console.log(`[${m.type}] ${m.text}`));
  console.log('\n=== PAGE ERRORS ===');
  pageErrors.forEach(e => console.log(`${e.message}\n${e.stack}`));
  console.log('\n=== WS FRAMES (robin:* only) ===');
  wsFrames.filter(f => f.payload.includes('robin:')).forEach(f => console.log(`[${f.dir}] ${f.payload}`));
  console.log('\n=== COMPUTED STYLES ===');
  console.log(JSON.stringify(computedStyles, null, 2));
  console.log('\n=== OVERLAY HTML (first 2000 chars) ===');
  console.log(overlayHTML.slice(0, 2000));

  await browser.close();
})();
```

The user will adapt this and feed you the output. Your job is to interpret it against the theories below.

---

## Theories — ordered by most likely to least likely

For each theory: what signal confirms it, what signal rules it out, what the fix direction would be.

### Theory 1: React render error in a sub-component unmounts the whole overlay

**Confirms**:
- `pageErrors` array has a React error with a stack trace pointing into a Robin file
- `consoleMessages` has red errors referencing "Cannot read properties of undefined" or "is not a function"
- `overlay` snapshot returns `{ error: 'overlay not found' }` in computed styles output
- Server log has `[CLIENT ERROR]` entries matching the same timestamp

**Rules out**:
- No page errors
- Overlay IS found in DOM with children

**Fix direction**: Read the stack trace, find the offending line. Likely causes:
- An import path that wasn't updated after a rename
- A type that was exported from robin-types.ts but renamed
- A className template literal that became malformed

### Theory 2: Overlay DOM is complete but CSS is hiding children

**Confirms**:
- `overlay.childCount` > 0
- `header.display` is `none` OR `header.height` is 0 OR `header.visibility` is `hidden`
- OR `body.height` is 0 (flex collapse)

**Rules out**:
- Header and body both have non-zero dimensions and visible display

**Fix direction**:
- If header is hidden: check if `.rv-robin-overlay-header` selector exists in the built CSS (view source of `dist/assets/*.css` and grep)
- If body is 0 height: check `.rv-robin-overlay` flex layout — is the overlay itself 100vh? If not, `inset: 0` isn't taking effect
- Cross-reference className from DOM with class selectors in robin.css

### Theory 3: Class name in JSX doesn't match class definition in CSS

**Confirms**:
- Overlay has children with classes like `rv-robin-overlay-header`, but computed styles show NONE of the rules from `.rv-robin-overlay-header` applying
- The element has default/inherited styles only

**Rules out**:
- Rules from robin.css ARE applying to the DOM elements (matching class selectors)

**Fix direction**:
- Diff every className in RobinOverlay.tsx against every class definition in robin.css
- Run: `grep -oE 'className="[^"]*"' RobinOverlay.tsx | sort -u > /tmp/jsx-classes.txt`
- Run: `grep -oE '^\.rv-robin-[a-z-]+' robin.css | sort -u > /tmp/css-classes.txt`
- Find classes in jsx-classes.txt that don't appear in css-classes.txt

### Theory 4: A CSS variable is undefined and a critical layout rule is breaking

**Confirms**:
- Computed styles show `height: 0` or `width: 0` on a critical ancestor
- The element has a CSS property referencing a var() that doesn't resolve

**Rules out**:
- All elements have sensible dimensions

**Fix direction**:
- In devtools Styles panel, elements using `var(--foo)` will show the resolved value
- If a variable is undefined AND the rule has no fallback, the property becomes `initial`
- Check robin.css for any `var(--)` without a fallback

### Theory 5: `views.css` has a selector that's hitting Robin elements

**Confirms**:
- In devtools Styles panel, a rule sourced from `views.css` is applying to a Robin child element
- The rule sets `display`, `visibility`, `opacity`, `height`, or `width` in a way that hides the element

**Rules out**:
- No rules from `views.css` are matching any `.rv-robin-*` element

**Fix direction**:
- Identify the offending selector in `views.css`
- Do NOT modify `views.css` — report the selector and let the user decide

### Theory 6: WebSocket data isn't arriving and conditional renders are collapsing

**Confirms**:
- `wsFrames` shows `robin:tabs` going out but no response coming back (or an error response)
- DOM has overlay + header + chat but no settings tabs bar
- Server log has no `robin:tabs` handler invocation

**Rules out**:
- User reports ALL content missing including the hardcoded chat messages — those render regardless of WS data, so this theory doesn't explain the full symptom

**Fix direction**: Only pursue if the Playwright output contradicts the user's report and the chat IS visible.

### Theory 7: An overlay from another component is covering Robin

**Confirms**:
- DOM has `.rv-robin-overlay` with children, dimensions are correct, styles look right
- ANOTHER element with high z-index is above it in the stacking order
- devtools "computed" view shows the Robin children have `pointer-events: none` or are behind another `position: fixed` element

**Rules out**:
- Robin elements are at the top of the stacking context

**Fix direction**:
- Identify the covering element from the DOM
- Check its z-index against `--z-panel` (600)

---

## Diagnostic commands you may run yourself

These don't require Playwright — you can run them directly as part of investigation.

```bash
# Check server log for recent client errors
tail -200 /Users/rccurtrightjr./projects/open-robin/open-robin-server/server-live.log | grep -E 'CLIENT|robin:|error|ERROR'

# Find all robin classnames in JSX
grep -rn 'className.*robin-' /Users/rccurtrightjr./projects/open-robin/open-robin-client/src/components/Robin/ | grep -oE '"[^"]*robin-[^"]*"' | sort -u

# Find all robin class definitions in CSS
grep -oE '^\.rv-robin-[a-z-]+' /Users/rccurtrightjr./projects/open-robin/open-robin-client/src/components/Robin/robin.css | sort -u

# Look for classes referenced but not defined
comm -23 \
  <(grep -rn 'className' /Users/rccurtrightjr./projects/open-robin/open-robin-client/src/components/Robin/ | grep -oE 'rv-robin-[a-z-]+' | sort -u) \
  <(grep -oE '^\.rv-robin-[a-z-]+' /Users/rccurtrightjr./projects/open-robin/open-robin-client/src/components/Robin/robin.css | sed 's/^\.//' | sort -u)

# Check that App.tsx is passing open correctly
grep -n 'RobinOverlay\|robinOpen\|setRobinOpen' /Users/rccurtrightjr./projects/open-robin/open-robin-client/src/components/App.tsx

# Verify the built CSS contains the key rules
grep -oE '\.rv-robin-overlay[^{]*\{[^}]*\}' /Users/rccurtrightjr./projects/open-robin/open-robin-client/dist/assets/*.css | head -5

# Check for any @import or url() in CSS that might have broken
grep -n '@import\|url(' /Users/rccurtrightjr./projects/open-robin/open-robin-client/src/components/Robin/robin.css
```

---

## What NOT to Do

- **Do not write any code fix.** Diagnose only.
- **Do not run SPEC-18 again or "re-prefix" anything.**
- **Do not rewrite RobinOverlay.tsx.**
- **Do not touch `ai/views/settings/styles/views.css`.**
- **Do not modify the server-side robin handlers.**
- **Do not revert SPEC-18.**
- **Do not add error boundaries as a workaround.**
- **Do not guess.** If Playwright data is inconclusive, request a more specific capture instead of speculating.

---

## Report format

When you identify the root cause (or after exhausting all reasonable hypotheses), report:

### Root cause
One or two sentences. What specific thing is broken.

### Evidence
The Playwright output, server log excerpt, or grep result that proves the theory. Quote it verbatim.

### Proposed fix
File path + line number + before/after. Minimum viable change only. **Do not write the fix unless explicitly asked.**

### Theories ruled out
List every theory from above that the evidence contradicted, with one line on why.

### Still suspect
If unresolved, list what you still think might be wrong and what specific Playwright capture or diagnostic would confirm it.
