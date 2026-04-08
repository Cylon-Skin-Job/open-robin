# SPEC-22: App.tsx Import Reduction

## Issue
`App.tsx` has 12 imports from unrelated modules, suggesting it orchestrates too many concerns.

## File
`open-robin-client/src/components/App.tsx`

## Current Imports
1. React hooks
2. `usePanelStore` — state store
3. `useWebSocket` — WS connection hook
4. Multiple panel components (Robin, Chat, Wiki, Tickets, FileExplorer, etc.)
5. Layout components
6. CSS

## Assessment
**This is a root-level App component.** In React, the top-level App component is *expected* to:
- Import and compose all major UI panels
- Subscribe to top-level state (which panel is active)
- Set up WebSocket connection
- Route to the correct panel view

The 12 imports are not 12 unrelated concerns — they are the components that make up the app shell. This is the React equivalent of an HTML page importing its sections.

## Recommendation
**Deprioritize.** App.tsx is the orchestrator by definition. The import count is proportional to the number of panels in the app. As long as App.tsx doesn't contain business logic (it shouldn't), the import count is a natural consequence of composition, not a code smell.

If the number grows significantly (20+), consider:
- A panel registry pattern where panels register themselves
- Lazy imports with React.lazy() for code splitting
- A route-based panel loader

## Dependencies
- None; deprioritized spec

## Gotchas
- App.tsx is the root orchestrator by definition in React. The 12 imports are the components that make up the app shell — this is composition, not a code smell.
- Reducing imports would require a panel registry or lazy loading, adding complexity for no real benefit at current scale.

## Silent Fail Risks
- None. This spec is deprioritized. Revisit only if import count exceeds 20+.
