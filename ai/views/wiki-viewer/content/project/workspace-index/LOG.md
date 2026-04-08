# Workspace Index — Log

## 2026-03-21 — Created
- Established `index.json` as universal workspace loading convention
- Decision driven by issues workspace bug: multi-step file_tree_request + individual file loads caused race conditions and put parsing logic on the client
- Wiki already used this pattern (index.json → topics). Issues now follows the same pattern (index.json → tickets)
- Rule: one request, one response, one pattern for all workspaces
