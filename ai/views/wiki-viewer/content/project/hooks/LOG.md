# Hooks — Log

## 2026-03-21 — Created
- Defined on_create and on_edit lifecycle hooks for wiki pages
- on_create: rebuild index, evaluate edges against all existing topics, create LOG entry
- on_edit: update index timestamps, re-evaluate edges, append LOG entry
- Both hooks debounced at 500ms, both call idempotent rebuildIndex()
- Edge discovery: fast path (keyword matching) on every edit, deep path (agent ticket) on create
- Implementation target: kimi-ide-server/lib/wiki/hooks.js

## 2026-03-23 — Updated
