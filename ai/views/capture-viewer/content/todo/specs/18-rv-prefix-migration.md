# SPEC-18: .rv- CSS Class Prefix Migration

## SCOPE BOUNDARY — READ THIS FIRST

This spec adds the `.rv-` prefix to all CSS class names across the codebase. This is a mechanical find-and-replace task. For each CSS file, prefix all class definitions, then update every JSX/TSX file that references those classes.

**You are NOT refactoring components, changing behavior, or improving CSS.** You are adding a prefix. That's it.

**Do this sequentially, one CSS file at a time.** Build-check after each file to catch errors early. Do NOT batch all 15 files and build at the end — one broken rename in a template literal will be impossible to find.

**Model recommendation: Opus 4.6** — the volume is high (395 classes across 15 files) and template literal classNames need careful pattern matching.

---

## Already Done

`src/components/Modal/modal.css` — already uses `.rv-` prefix. **Skip this file entirely.**

---

## One Known querySelector — MUST UPDATE

`src/components/Robin/WikiDetail.tsx` line 9:
```ts
const btn = document.querySelector('.robin-wiki-link-btn') as HTMLElement;
```
When robin.css classes are prefixed, this must become `.rv-robin-wiki-link-btn`.

---

## Method For Each CSS File

For every CSS file listed below, do these steps in order:

### Step 1: Prefix all class definitions in the CSS file
Every `.classname` becomes `.rv-classname`. This includes:
- Standalone selectors: `.header` → `.rv-header`
- Compound selectors: `.header .menu-btn` → `.rv-header .rv-menu-btn`
- State selectors: `.tool-btn.active` → `.rv-tool-btn.rv-active` — **WAIT**: only prefix the component class, not generic state classes like `.active`, `.open`, `.selected`, `.disabled`, `.on`, `.off`. These are toggled via JS and are contextual modifiers, not standalone classes.

**Exception for state classes:** When `.active`, `.open`, `.selected`, `.disabled`, `.on`, `.off`, `.highlight`, `.locked`, `.copied` appear as modifiers attached to a component class (e.g., `.tool-btn.active`, `.robin-settings-tab.active`), leave the modifier unprefixed. Only the component class gets `.rv-`:
```css
/* Old: */ .tool-btn.active
/* New: */ .rv-tool-btn.active

/* Old: */ .robin-settings-tab.active
/* New: */ .rv-robin-settings-tab.active
```

### Step 2: Find all JSX/TSX files that reference these class names
```bash
grep -rn "classname-pattern" src/ --include="*.tsx" --include="*.ts"
```

### Step 3: Update className references
Handle all patterns:
- Static strings: `className="header"` → `className="rv-header"`
- Template literals: `` className={`tool-btn ${active ? 'active' : ''}`} `` → `` className={`rv-tool-btn ${active ? 'active' : ''}`} ``
- Note: state modifiers like `active` stay unprefixed in template literals too

### Step 4: Update any querySelector references
Only one known: WikiDetail.tsx line 9. But check after each CSS file.

### Step 5: Build check
```bash
npx tsc --noEmit
```
Fix any errors before moving to the next file.

---

## Files In Order (largest first)

### 1. robin.css (161 classes) → Components: RobinOverlay.tsx, WikiDetail.tsx, ConfigDetail.tsx, CLIDetail.tsx, ThemeDetail.tsx

**Prefix pattern:** `.robin-*` → `.rv-robin-*`

All classes already start with `robin-`. This is straightforward — add `rv-` before `robin-`.

**querySelector:** WikiDetail.tsx `.robin-wiki-link-btn` → `.rv-robin-wiki-link-btn`

**Also check:** robin-types.ts (no classes expected, but verify)

---

### 2. document.css (69 classes) → Components: check which TSX files reference these

**Prefix pattern:** `.code-*`, `.file-*`, `.document-*`, `.binary-*`, `.text-renderer`, `.wiki-page-content` → add `rv-` to each

---

### 3. App.css (57 classes) → Component: App.tsx

**Prefix pattern:** `.app-container`, `.header`, `.header-left`, `.header-right`, `.menu-btn`, `.project-name`, `.connection-status`, `.tools-panel`, `.tool-btn`, `.panel-container`, `.panel`, `.content-area`, `.layout-*`, `.chat-*`, `.send-*`, `.context-usage-*`, `.chat-footer-*` → add `rv-` to each

**These are the highest-risk generic names.** `.header`, `.panel`, `.content-area` are the ones most likely to collide with external CSS.

---

### 4. agents.css (50 classes) → Components: AgentTiles.tsx, others in agents/

**Prefix pattern:** `.agent-*` → `.rv-agent-*`

---

### 5. HarnessSelector.css (40 classes) → Component: HarnessSelector/index.tsx

**Prefix pattern:** `.harness-*` → `.rv-harness-*`

---

### 6. wiki.css (35 classes) → Components: WikiExplorer.tsx, PageViewer.tsx

**Prefix pattern:** `.wiki-*` → `.rv-wiki-*`

---

### 7. HoverIconModal.css (33 classes) → Components: HoverIconModalParts.tsx

**Prefix pattern:** `.hover-icon-*` → `.rv-hover-icon-*`

---

### 8. ChatHarnessPicker.css (31 classes) → Component: ChatHarnessPicker/index.tsx

**Prefix pattern:** `.chp-*`, `.chat-harness-picker` → `.rv-chp-*`, `.rv-chat-harness-picker`

---

### 9. VoiceRecorder.css (29 classes) → Component: VoiceRecorder.tsx (via useAudioCapture)

**Prefix pattern:** `.voice-recorder*` → `.rv-voice-recorder*`

---

### 10. tickets.css (29 classes) → Component: TicketBoard.tsx

**Prefix pattern:** `.ticket-*` → `.rv-ticket-*`

---

### 11. tile-row.css (27 classes) → Components: TileRow.tsx, DocumentTile.tsx, etc.

**Prefix pattern:** Check existing names and prefix

---

### 12. prompt-cards.css (26 classes) → Component: PromptCardView.tsx

**Prefix pattern:** Check existing names and prefix

---

### 13. capture.css (23 classes) → Components: capture/*.tsx

**Prefix pattern:** Check existing names and prefix

---

### 14. index.css (11 classes) → Various components

**Prefix pattern:** `.modal-overlay`, others → `.rv-modal-overlay`, etc.

**Note:** `.modal-overlay` in index.css is separate from `.rv-modal-overlay` in modal.css. They may be different elements. Check what uses `.modal-overlay` from index.css.

---

### 15. ConnectingOverlay.css (3 classes) → Component: ConnectingOverlay.tsx

**Prefix pattern:** `.connecting-overlay`, `.co-*` → `.rv-connecting-overlay`, `.rv-co-*`

---

## Gotchas

### State modifier classes stay unprefixed
`.active`, `.open`, `.selected`, `.disabled`, `.on`, `.off`, `.highlight`, `.locked`, `.copied`, `.value` — these are toggled in JS via template literals. They are contextual modifiers, not standalone component classes. Do NOT prefix them.

### Template literals need careful matching
```tsx
className={`robin-setting-item ${selectedItemId === item.key ? 'active' : ''}`}
```
Only `robin-setting-item` gets prefixed. `active` stays.

### dangerouslySetInnerHTML content has class names
Some components inject HTML with class names (e.g., markdown rendering). These classes come from the markdown transform pipeline, not from our CSS files. Do NOT try to prefix classes inside rendered markdown content.

### animations.css classes
`animations.css` has `.blur-sphere`, `.orb-wrapper`, `.orb-icon`. These were added by SPEC-21. Prefix them too.

### CSS selectors that target HTML elements
Selectors like `h2`, `p`, `a`, `code`, `pre` inside component CSS — leave these alone. Only prefix class selectors.

### CSS selectors that reference `.material-symbols-outlined`
This is a Google Fonts class. Do NOT prefix it.

---

## What NOT to Do

- Do not prefix `.material-symbols-outlined` or any third-party class
- Do not prefix state modifier classes (`.active`, `.open`, etc.)
- Do not change any CSS property values
- Do not reorder or reorganize CSS rules
- Do not change component behavior
- Do not prefix classes inside markdown/HTML content strings
- Do not create new CSS files or move rules between files
- Do not batch all files — build-check after EACH file

---

## Verification

After ALL files are done:
1. `npm run build` passes
2. App loads and all panels render correctly
3. Robin panel — tabs, wiki, customization, CLIs all styled
4. Chat — messages, tool calls, orb animation styled
5. File explorer — tree, content, code highlighting styled
6. Hover modals — emoji, clipboard, screenshots styled
7. Voice recorder — all states styled
8. Harness selector — cards styled
9. Copy reference button in wiki still works (querySelector updated)

---

## Silent Fail Risks

| Risk | What Breaks | Symptom |
|------|-------------|---------|
| Class missed in JSX | CSS defined but not applied | Component renders unstyled |
| Template literal class missed | Same | Conditional styling broken |
| querySelector not updated | Interactive element broken | Button click does nothing |
| State modifier prefixed | JS toggles `active` but CSS expects `rv-active` | Active states don't highlight |
| Third-party class prefixed | External CSS doesn't match | Icons or fonts broken |
