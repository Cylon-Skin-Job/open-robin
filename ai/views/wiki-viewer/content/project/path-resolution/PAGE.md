# Path Resolution

How the server resolves workspace file paths, and the security constraints that affect symlinks and special workspaces.

## getWorkspacePath

`kimi-ide-server/server.js` — the single function that maps workspace IDs to filesystem paths.

```
getWorkspacePath(workspace, ws)
  'coding-agent'    → getSessionRoot(ws, workspace)   // project root
  '__workspaces__'  → ai/workspaces/                  // discovery pseudo-workspace
  everything else   → ai/workspaces/{workspace}/      // standard path
```

Three behaviors, three edge cases.

### coding-agent is special

`coding-agent` maps to the **project root**, not `ai/workspaces/coding-agent/`. This is intentional — the file explorer needs to browse the whole project. But it means `fetchWorkspaceFile(ws, 'coding-agent', 'workspace.json')` looks for `workspace.json` in the project root, not in the workspace folder.

**Lesson learned (2026-03-26):** Dynamic workspace discovery broke because `loadWorkspaceConfig` initially used the workspace ID directly. Fix: use `__workspaces__` pseudo-workspace so all config loads resolve to `ai/workspaces/{id}/workspace.json` regardless of `getWorkspacePath` overrides.

### __workspaces__ pseudo-workspace

Added for dynamic discovery. Resolves to `ai/workspaces/` itself. Used by:
- `discoverWorkspaces()` — lists folders
- `loadWorkspaceConfig()` — loads `{id}/workspace.json`
- `hasUiFolder` check — probes `{id}/ui/module.js`

Not a real workspace. Never appears in the tab bar.

## Security Check — Path Traversal

`server.js:321`:
```js
const basePath = path.resolve(workspacePath);
const targetPath = path.join(basePath, requestPath);
if (!path.resolve(targetPath).startsWith(basePath)) {
  // reject — path traversal attempt
}
```

This prevents `../../etc/passwd` attacks. But it has a symlink interaction:

### Symlink Risk

`path.resolve()` follows symlinks and returns the **real** (canonical) path. If a workspace folder contains a symlink:

```
ai/workspaces/background-agents/sessions → /Users/you/.kimi/sessions/
```

Then:
- `basePath` = `/Users/you/projects/kimi-claude/ai/workspaces/background-agents`
- `targetPath` for `sessions/2026-03-26.json` resolves to `/Users/you/.kimi/sessions/2026-03-26.json`
- `path.resolve(targetPath).startsWith(basePath)` = **false**
- Request **rejected** as path traversal

This means **symlinks pointing outside the workspace folder will be blocked by the security check**.

### Solutions (for future symlink work)

1. **Resolve basePath through symlinks too** — `fs.realpathSync(workspacePath)` instead of `path.resolve(workspacePath)`. Risk: widens the allowed path scope.
2. **Allowlist specific symlink targets** — Check if the target is a known safe path before rejecting. More surgical.
3. **Don't use symlinks** — Copy or mount instead. Simpler but loses live updates.
4. **Add a `getWorkspacePath` override for agents** — Similar to `coding-agent`'s special case. Map `background-agents/sessions` to the real path explicitly.

The right choice depends on the threat model. For a local-only IDE (pre-Electron), option 1 or 4 is fine. For a networked deployment, option 2 is safer.

## Client-Side Architecture Layers

The frontend follows a downward dependency flow:

```
components/  →  hooks/  →  lib/  →  state/
   (UI)        (React)    (logic)   (store)
```

- `lib/` should have no knowledge of React, hooks, or components
- `hooks/` may import from `lib/` and `state/`
- `components/` may import from anything

**Current exception:** `lib/ws-client.ts` imports `loadRootTree` from `hooks/useFileTree` and `showToast` from `components/Toast`. These are effectively standalone utilities that happen to live in the wrong layer. If they ever import back from `lib/`, the circular dependency will break the build.

**Lesson learned (2026-03-26):** The WebSocket client was originally a React hook (`useWebSocket`). This coupled socket lifecycle to React rendering, causing a deadlock where discovery couldn't complete because the component that ran discovery couldn't mount until discovery completed. Extracting to a plain module (`lib/ws-client.ts`) fixed the deadlock and the stale closure bug where messages always routed to the initial workspace.

## Related

- [[Workspaces]] — workspace ownership and domain separation
- [[Workspace-Agent-Model]] — agent folder structure and session lifecycle
- [[Session-Scoping]] — SESSION.md depth model and thread management
- [[Workspace-Index]] — index.json and workspace.json conventions
