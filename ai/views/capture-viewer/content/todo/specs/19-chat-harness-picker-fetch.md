# SPEC-19: ChatHarnessPicker Direct Fetch Extraction

## Issue
`ChatHarnessPicker/index.tsx` makes a direct `fetch('/api/harnesses')` call inside the component. Components should not make API calls — they should receive data via props or emit events.

## File
`open-robin-client/src/components/ChatHarnessPicker/index.tsx`

## Current Behavior (lines 34-47)
```tsx
const fetchStatuses = useCallback(async () => {
  setIsLoading(true);
  try {
    const res = await fetch('/api/harnesses');
    if (!res.ok) return;
    const list: HarnessStatus[] = await res.json();
    const map = list.reduce((acc, s) => { acc[s.id] = s; return acc; }, {});
    setStatuses(map);
  } catch {
    // silent — show local config as fallback
  } finally {
    setIsLoading(false);
  }
}, []);
```

## Data Shape
```tsx
interface HarnessStatus {
  id: string;
  installed: boolean;
  builtIn: boolean;
  version: string | null;
  action: string | null;
  installCommand: string | null;
}
```

## How Data Is Used
- `isSelectable()` checks `statuses[id]?.installed`
- UI shows badges: "Recommended", "Built-in", "Installed", "Not installed"
- Shows install command if `action === 'install'`

## Proposed Fix
Two options:

### Option A: Lift fetch to parent
Parent component fetches harness statuses, passes as prop:
```tsx
<ChatHarnessPicker statuses={harnessStatuses} isLoading={loading} />
```

### Option B: WebSocket message
Request harness statuses via existing WS connection (consistent with how other data flows):
- Client sends `harness:list` message (already exists in server.js)
- Server responds with statuses
- Store or parent distributes to component

## Recommendation
**Option B** — the `harness:list` WS message already exists in server.js (lines 1526-1541). The REST endpoint at `/api/harnesses` is redundant with the WS message. The component should receive statuses via props from whatever parent manages the WS flow.

## Dependencies
- None; self-contained, can be done anytime

## Gotchas

### Silent error handling masks server issues
Lines 42-46: `catch { // silent — show local config as fallback }`. If `/api/harnesses` never responds, users see stale local config with no indication the server is down. This is intentional fallback behavior, but extraction should preserve the silent catch.

### useCallback + useEffect dependency — infinite loop risk
`fetchStatuses` is defined with `useCallback([], [])` (empty deps) and used in `useEffect([fetchStatuses])`. Currently stable — never changes, effect runs once. If extraction changes the useCallback deps (e.g., adds a dependency), the effect reruns infinitely — network spam, browser freeze.

### WS message `harness:list` already exists on server
server.js lines 1526-1541 already handle `harness:list` via WebSocket. The REST endpoint at `/api/harnesses` is redundant. Option B (WS-based) is the better path since it's consistent with how all other data flows.

## Silent Fail Risks

| Risk | What Breaks | Symptom |
|------|-------------|---------|
| useCallback deps wrong after extraction | Infinite fetch loop | Network spam, browser freeze |
| Error handling removed | Unhandled promise rejection | Console error, component may crash |
