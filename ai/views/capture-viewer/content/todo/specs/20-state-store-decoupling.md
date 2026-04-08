# SPEC-20: Component State Store Decoupling

## Issue
5+ components directly import Zustand state stores, making them non-portable and tightly coupled to app-level state management.

## Violations

### App.tsx (orchestrator — acceptable)
- Imports: `usePanelStore`
- Reads: currentPanel, panelConfigs, ws
- Writes: setCurrentPanel
- **Assessment**: App.tsx is the root orchestrator. Store access here is expected — this is the boundary between state and presentation.

### ToolsPanel.tsx
- Imports: `usePanelStore`
- Reads: panelConfigs
- **Assessment**: Could receive panelConfigs as a prop from App.tsx instead.

### TicketBoard.tsx
- Imports: `usePanelStore`, `useTicketStore`
- panelStore reads: ws
- ticketStore reads: tickets, loaded, activeTicket, error
- ticketStore writes: setActiveTicket, setTicketsFromIndex, setError
- **Assessment**: Heavy store coupling. Uses ws for WebSocket sends, uses ticketStore for all state.

### WikiExplorer.tsx
- Imports: `usePanelStore`, `useWikiStore`
- panelStore reads: ws
- wikiStore reads: activeTopic, indexLoaded, error
- wikiStore writes: setIndex, setPageContent, setLogContent, setError, setPageLoading
- **Assessment**: Heavy store coupling. 5 write operations to wikiStore.

### PageViewer.tsx
- Imports: `usePanelStore`, `useWikiStore`, `useActiveResourceStore`
- wikiStore reads: 10 properties
- wikiStore writes: 4 operations
- activeResourceStore writes: setActiveResource
- **Assessment**: Heaviest coupling. 3 stores, 10 reads, 5 writes.

## Analysis
The store coupling pattern in this codebase follows React/Zustand conventions where components subscribe to stores directly. This is a **deliberate architecture choice** in React apps using Zustand — stores replace prop drilling.

## Recommendation
**Deprioritize this spec.** In a Zustand-based React app, direct store imports in components is the standard pattern, not an anti-pattern. The code standards doc assumes a vanilla JS event-bus architecture, but the client uses React + Zustand which has different conventions.

The only actionable item is:
1. **ToolsPanel.tsx** — trivially receives panelConfigs as prop (it's rendered by App.tsx which already has it)
2. **ChatHarnessPicker** — see SPEC-19 for the fetch issue

TicketBoard, WikiExplorer, and PageViewer are deep-tree components that legitimately benefit from store subscriptions over prop drilling.

## Dependencies
- None; deprioritized spec

## Gotchas
- Zustand direct imports are the **standard pattern** in React/Zustand apps. The code standards doc assumes vanilla JS event-bus architecture, but the client uses React + Zustand which has different conventions.
- Forcing prop drilling on deep-tree components (TicketBoard, WikiExplorer, PageViewer) would create worse code — more props, more coupling to parent structure.

## Silent Fail Risks
- None. This spec is deprioritized. Only actionable item: ToolsPanel.tsx could trivially receive panelConfigs as a prop from App.tsx.
