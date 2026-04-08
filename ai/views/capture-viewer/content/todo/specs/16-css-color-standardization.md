# SPEC-16: Delete Vite Boilerplate Files

## Context for Executing Session

This is a dead code deletion task. Two files left over from `create-vite` are unused and should be removed.

**Model recommendation: Sonnet 4.6** — verification + deletion, no judgment calls.

---

## Problem

`src/App.tsx` and `src/App.css` are the original Vite template files. They are never imported by the real app. `main.tsx` imports `./components/App`, not `./App`.

The dead `App.css` contains `#root { max-width: 1280px; padding: 2rem; text-align: center; }` which would break the real app layout if it were ever accidentally imported.

---

## Files to Delete

### 1. `src/App.css` — dead Vite boilerplate CSS

Contains `.logo`, `.logo.react`, `@keyframes logo-spin`, `.card`, `.read-the-docs`, and a `#root` override. None of these classes are used by the real app.

### 2. `src/App.tsx` — dead Vite counter demo

Contains the "Vite + React" counter demo with logo spin animation. Imports `src/App.css`. Never imported by `main.tsx`.

---

## Verification Steps BEFORE Deleting

1. Confirm `main.tsx` imports from `./components/App`, NOT `./App`:
   ```
   grep "from.*App" src/main.tsx
   ```
   Expected: `import App from './components/App';`

2. Confirm no other file imports `src/App.tsx`:
   ```
   grep -r "from ['\"]\.\/App['\"]" src/ --include="*.tsx" --include="*.ts"
   ```
   Expected: only `src/App.tsx` importing itself (its own CSS), nothing else.

3. Confirm no other file imports `src/App.css`:
   ```
   grep -r "App\.css" src/ --include="*.tsx" --include="*.ts"
   ```
   Expected: `src/App.tsx` (dead) and `src/components/App.tsx` (imports `./App.css` which resolves to `src/components/App.css`, a DIFFERENT file).

4. Confirm `src/components/App.css` EXISTS and is the real app layout CSS:
   ```
   head -5 src/components/App.css
   ```
   Expected: `/* Main App Layout */` with `.app-container` grid definition.

---

## Steps

1. Run all 4 verification checks above
2. Delete `src/App.css`
3. Delete `src/App.tsx`
4. Check if `src/assets/react.svg` is only used by the dead `App.tsx` — if so, delete it too
5. Check if `/public/vite.svg` is only used by the dead `App.tsx` — if so, delete it too
6. Build the client to confirm no import resolution errors: `cd open-robin-client && npm run build`

---

## What NOT to Do

- Do not touch `src/components/App.css` — that is the REAL app layout CSS
- Do not touch `src/components/App.tsx` — that is the REAL app component
- Do not touch `src/main.tsx`
- Do not touch `src/index.css` (it also has `#root` styles, but those are the active ones)

---

## Verification After Deletion

- `npm run build` succeeds with no errors
- No "Module not found" errors referencing App.css or App.tsx
- App loads and renders normally (visual check if server is running)

---

## Silent Fail Risks

| Risk | What Breaks | Symptom |
|------|-------------|---------|
| Wrong App.css deleted (components/ instead of src/) | Real app layout gone | App renders as unstyled column |
| Wrong App.tsx deleted (components/ instead of src/) | Real app component gone | Build fails — main.tsx can't import |
| react.svg or vite.svg used elsewhere | Missing asset | Build warning or broken image |
