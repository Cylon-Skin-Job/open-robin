# Code Standards

Modularity expectations, file structure rules, and architecture principles. Reference this page during planning phases before writing or modifying code.

---

## File Size Guidance

One job per file, not a line count.

| Size | Action |
|------|--------|
| Under 200 lines | Don't think about it |
| 200-400 lines | Check if it's still one job |
| Over 400 lines | Almost certainly doing too much — split it |

A 350-line SSE controller handling parsing, buffering, and recovery = fine (one job).
A 250-line file rendering UI + calling APIs + managing state = not fine (three jobs).

**The test:** Can you describe what this file does in one sentence without "and"? If not, split it.

---

## Modularity Rules

1. **One job per file.** Not one function — one responsibility. A file can have many functions if they all serve the same job.
2. **No God files.** If a file is the only place where X, Y, and Z happen, it's doing too much.
3. **Imports tell the story.** If a file imports from 5+ unrelated modules, it's probably orchestrating too many concerns.
4. **Extract when the second consumer appears.** Don't pre-extract. Three similar lines of code is better than a premature abstraction. Extract when a second file needs the same thing.
5. **Delete, don't deprecate.** No `_unused` prefixes, no `// removed` comments, no backwards-compatibility shims for one-time operations. If it's dead, delete it.

---

## Architecture Layers

Data flows down. Events flow up. Nothing skips a layer.

```
VIEW (Presentation)
  ├── Pure presentation, renders state, emits user events
  ├── NEVER calls services or APIs directly
  └── NEVER imports controllers or services

CONTROLLER (Orchestration)
  ├── Handles events, orchestrates services, emits results
  ├── NEVER touches DOM directly
  └── NEVER imports view modules

SERVICE (Data Access)
  ├── Pure data access, returns data only
  ├── Called by controllers only
  └── NEVER emits events or touches DOM

STATE (Single Source of Truth)
  ├── Read-only from View, written only by controllers
  └── Emits state.changed on writes
```

**However:** "Layer as little code as possible." Don't build an event bus, controller layer, and service layer if the feature is simple. The layers exist for when complexity demands them, not as mandatory ceremony. A direct function call is fine when the data flow is obvious.

---

## Dependency Rules

```
VIEW may import:     state (read-only), components
VIEW must NOT:       controllers, services, API calls, write state

CONTROLLER may:      state (read/write), services, event bus
CONTROLLER must NOT: views, components, DOM

SERVICE may:         API clients, network
SERVICE must NOT:    event bus, state, controllers, views, DOM

COMPONENT may:       create DOM, accept config/callbacks, use CSS variables
COMPONENT must NOT:  controllers, services, state, network
```

---

## Component Portability

Components are reusable across projects. They must be self-contained.

1. **All styles use CSS variables with fallbacks:** `var(--token, fallback)`
2. **All class names prefixed:** `.rv-toast`, `.rv-modal` (no collisions)
3. **Pure functions:** input (config object) → output (DOM element)
4. **Styles inject once** via flag (prevent duplicate `<style>` tags)
5. **No imports** of controllers, services, app-state, or network
6. **No knowledge** of what project they're in

---

## CSS Rules

1. **NEVER hardcode** colors, spacing, or z-index
2. **NEVER put** component styles in global CSS files — styles live in the component
3. **EVERY value** traces back to CSS variables
4. **Theme switching** only swaps variable values

### Core Token Categories

```css
--palette-*          /* Color palette */
--bg-*               /* Backgrounds */
--text-*             /* Text colors */
--space-xs|sm|md|lg  /* Spacing */
--z-*                /* Z-index layers */
--shadow-*           /* Shadows */
--transition-*       /* Animation durations */
```

---

## Naming Conventions

```
Files:     feature-view.js, feature-controller.js, feature-service.js
           feature.styles.js, feature.template.js

Events:    domain:action          (chat:turn_end, ticket:claimed, agent:run_completed)
           Colon-separated.       Matches wire protocol convention (thread:create, thread:open).

CSS vars:  --palette-name, --bg-name, --text-name
           --space-xs|sm|md|lg, --z-layer, --shadow-weight

Classes:   .rv-component, .rv-component-part
```

---

## Anti-Patterns

| Don't | Do |
|-------|----|
| Hidden div in HTML that JS toggles visible | JS creates element on demand |
| View calls `authenticatedFetch()` | Emit event to controller |
| Controller does `document.getElementById()` | Emit event to view |
| Hardcoded color `#FF6B35` | Use `var(--palette-accent, #FF6B35)` |
| Component importing app-state | Accept config object instead |
| One giant app.js | Split into view + controller + service |
| Inline styles on elements | Component injects scoped `<style>` once |
| Add features beyond what was asked | Do what was asked, nothing more |
| Add error handling for impossible scenarios | Trust internal code and framework guarantees |
| Create helpers for one-time operations | Inline it |

---

## Planning Phase Checklist

Before writing code, verify the plan against these standards:

- [ ] Each new file has one job (describable in one sentence without "and")
- [ ] No file will exceed 400 lines
- [ ] Imports don't cross layer boundaries
- [ ] CSS values use variables with fallbacks
- [ ] Components are portable (no app-state, no services, no network)
- [ ] No premature abstractions (is there actually a second consumer?)
- [ ] No scope creep (does this change do more than what was asked?)

---

## Compliance Migration — Audit Specs

Full audit completed 2026-04-06. 22 specs with dependencies, gotchas, and silent fail risks.

**Spec index:** `ai/views/capture-viewer/content/todo/specs/00-INDEX.md`

### CSS / Style Layer (target: settings system, not variables.css)

- [ ] **Z-index hierarchy** — 2 active collision bugs, 10 hardcoded values
  `ai/views/capture-viewer/content/todo/specs/15-css-zindex-standardization.md`

- [ ] **Spacing & font variables** — 38 hardcoded values, no scale exists
  `ai/views/capture-viewer/content/todo/specs/17-css-spacing-standardization.md`

- [ ] **Inline styles extraction** — 6+ components, blocked by spacing variables
  `ai/views/capture-viewer/content/todo/specs/21-inline-styles-extraction.md`

- [ ] **.rv- class prefix** — 0/395 classes namespaced, querySelector gotcha
  `ai/views/capture-viewer/content/todo/specs/18-rv-prefix-migration.md`

- [ ] **Delete Vite boilerplate** — 3 dead color rules in App.css
  `ai/views/capture-viewer/content/todo/specs/16-css-color-standardization.md`

### Server Module Extraction

- [ ] **ThreadManager split** — session manager + auto-rename (do first, no deps)
  `ai/views/capture-viewer/content/todo/specs/04-thread-manager-split.md`

- [ ] **ThreadWebSocketHandler split** — CRUD + messages (after ThreadManager)
  `ai/views/capture-viewer/content/todo/specs/03-thread-ws-handler-split.md`

- [ ] **compat.js split** — legacy/parallel paths may be deletable
  `ai/views/capture-viewer/content/todo/specs/11-compat-js-split.md`

- [ ] **Qwen + Gemini shared extraction** — 95% identical, 5% subtle differences
  `ai/views/capture-viewer/content/todo/specs/10-qwen-harness-split.md`
  `ai/views/capture-viewer/content/todo/specs/14-gemini-harness-split.md`

- [ ] **server.js decomposition** — 1752-line God file, do LAST
  `ai/views/capture-viewer/content/todo/specs/01-server-js-decomposition.md`

### Client Component Extraction

- [ ] **ws-client.ts split** — turn lifecycle fragile, past bugs documented
  `ai/views/capture-viewer/content/todo/specs/05-ws-client-split.md`

- [ ] **RobinOverlay split** — 4 sub-components, after spacing tokens
  `ai/views/capture-viewer/content/todo/specs/02-robin-overlay-split.md`

- [ ] **HoverIconModal split** — hook + UI, module-level state gotcha
  `ai/views/capture-viewer/content/todo/specs/08-hover-icon-modal-split.md`

- [ ] **VoiceRecorder split** — audio hook + viz, cleanup order matters
  `ai/views/capture-viewer/content/todo/specs/06-voice-recorder-split.md`

### No Action Required

- **catalog-visual.ts** — one job, acceptable size → `specs/07-catalog-visual-split.md`
- **base-cli-harness.js** — one job, acceptable size → `specs/09-base-cli-harness-split.md`
- **LiveSegmentRenderer.tsx** — DO NOT SPLIT, breaks completion → `specs/13-live-segment-renderer-split.md`
- **State store decoupling** — Zustand pattern is standard → `specs/20-state-store-decoupling.md`
- **App.tsx imports** — root orchestrator, expected → `specs/22-app-tsx-import-reduction.md`
