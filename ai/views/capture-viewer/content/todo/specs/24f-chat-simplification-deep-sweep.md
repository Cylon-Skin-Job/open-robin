# SPEC-24f — Chat Simplification: Deep Code Sweep (final 24x phase)

**Parent:** SPEC-24 (chat simplification)
**Position:** Phase 6 of 6. **Last phase in the 24x series.** Depends on 24a, 25, 24b, 24c, 24d, 24e all merged.
**Depends on:**
- 24a (timestamp thread IDs, orphan purge)
- 25 (frontmatter extraction + catalog)
- 24b (ChatFile immutable filenames + frontmatter)
- 24c (unified chat storage location)
- 24d (legacy strategies + auto-rename deleted)
- 24e (display fallback for null names)
**Model recommendation:** **Sonnet 4.6** is sufficient. Three small surgical edits, one JSON stopgap, zero architecture changes.
**Estimated blast radius:** **Low.** Pure deletion and one batch of JSON value changes. No wire protocol impact, no schema changes, no signature changes, no client-server coordination.

---

## Your mission

Three items, one commit.

**Item 1 — Layout config stopgap (the unblocker).**
Five chat-enabled views have `settings.layout` in their `index.json` set to a value that hides the thread sidebar (`full` or `chat-content`). Flip them all to `sidebar-chat-content` so the chat sidebar actually renders for those panels, matching the known-good `code-viewer` experience. **This is a stopgap** — a future spec (SPEC-26) replaces the three-layout switch with a collapsible drawer, at which point these JSON values get repurposed or deleted. For now, the flip is what lets the user interact with the SPEC-24a-24e chat work on any panel beyond `code-viewer`.

**Item 2 — Delete `thread:create:confirm` dead client handler in `Sidebar.tsx`.**
The `useEffect` at `Sidebar.tsx:153-190` registers a WebSocket listener that handles two message types:
- `thread:create:confirm` — shows a confirmation modal. **Dead.** The server never sends this message type anymore (SPEC-24a consolidated the thread verbs and removed the confirmation flow). Grep confirms zero senders.
- `thread:link` — copies a thread's file path to the clipboard. **Alive.** Still used by the "copy link" menu action.

Surgically remove the `thread:create:confirm` branch while preserving the `thread:link` branch. Also cascade-delete any state and render code that was only fed by the now-removed handler (the `confirmModal` state + its rendering block, if present).

**Item 3 — Delete persona-wire notify block in `lib/runner/index.js:115-135`.**
A try/catch inside the runner's `proc.on('exit')` callback reads `global.__agentWireSessions` to find a per-agent persona wire and send it a notification when a ticketed run completes. Since SPEC-24a deleted `lib/wire/agent-sessions.js` (which set `global.__agentWireSessions`), the global is now `undefined`, the guard at L118 always fails, the block never fires. 21 lines of unreachable code. Delete cleanly.

---

**After this phase:**
- All 9 chat-enabled views use `sidebar-chat-content` layout in their `index.json`.
- `Sidebar.tsx` has no `thread:create:confirm` handler, no `confirmModal` state, no modal render block.
- `lib/runner/index.js` has no persona-wire notify block.
- Smoke test still passes (47/0 or whatever 24e landed at — no test touches the deleted code).
- **Live validation on a non-code-viewer panel is finally possible.** Open issues-viewer, create a thread, see it appear in the sidebar.

**The 24x series is complete after this spec lands.**

**You are not touching:**
- `panels.ts:152-159` code-viewer special-case layout path — load-bearing prototype code, not dead
- `lib/panels.ts:178` layout.json fields loaded but ignored — SPEC-26 will consume them
- `ContentArea.tsx:21-27` `CONTENT_COMPONENTS` dispatch table — bigger "no-code panel architecture" refactor, separate spec
- `lib/resource-path.ts` panel-ID dispatch — same as above
- `hooks/useFileTree.ts` code-viewer gating — correct behavior
- `hooks/usePanelWorkspaceStyles.ts` code-viewer gating — correct behavior
- `state/panelStore.ts:100` `currentPanel: 'code-viewer'` default — cosmetic
- `ThreadManager.js` 430-line modularization — taste call
- SQLite `date` column on threads table — requires schema migration, separate concern
- Migration `001_initial.js:19` comment — migration files are frozen
- CSS architecture migration — separate spec, see note at the end
- `src/components/Sidebar.tsx` thread list rendering — SPEC-26 territory
- Any wire protocol changes
- Any client build/bundle changes
- `ai/views/agents-viewer/` or anything about agent prompts/workflows — saved feedback says don't audit

---

## Context before you touch code

Read these in order:

1. **`ai/views/wiki-viewer/content/enforcement/code-standards/PAGE.md`** — house rules.
2. **`ai/views/capture-viewer/content/todo/specs/24-chat-simplification.md`** — parent spec.
3. **`open-robin-client/src/components/Sidebar.tsx`** — focus on L140-200 (the useEffect region you're modifying) and wherever `confirmModal` state is declared + rendered. Grep the full file for `confirmModal` before editing.
4. **`open-robin-server/lib/runner/index.js`** — read L60-150 for context around the block you're deleting. Understand how the surrounding `proc.on('exit')` callback works so you delete only the notify section.
5. **`open-robin-client/src/components/App.tsx:19-38`** — the layout switch you're NOT touching, but whose three-string pattern you should understand to see why Item 1 is a stopgap.

### Line-number drift verification

```bash
cd /Users/rccurtrightjr./projects/open-robin

wc -l open-robin-client/src/components/Sidebar.tsx \
      open-robin-server/lib/runner/index.js

# Expected (±5 lines):
# - Sidebar.tsx ≈ 385
# - runner/index.js ≈ 220
```

Grep for every touchpoint:

```bash
grep -n "confirmModal\|thread:create:confirm" open-robin-client/src/components/Sidebar.tsx
grep -n "__agentWireSessions\|Notify active persona" open-robin-server/lib/runner/index.js
```

Expected hits:
- Sidebar.tsx: `confirmModal` state declaration (probably around L128-135), the `thread:create:confirm` handler at L160-171, possibly a `confirmModal` render block somewhere after the main return
- runner/index.js: L115 comment, L117-118 guard, L119 lookup, L129 stdin.write, L130 console.log, L133-134 catch

---

## Pre-flight: which views need the Item 1 fix

Run this audit to confirm the state of each chat-enabled view's layout:

```bash
for v in agents-viewer browser-viewer capture-viewer code-viewer docs-viewer email-viewer issues-viewer library-viewer wiki-viewer; do
  f=ai/views/$v/index.json
  c=ai/views/$v/content.json
  if [ -f "$f" ]; then
    layout=$(python3 -c "import json; d=json.load(open('$f')); print(d.get('settings',{}).get('layout','(none)'))")
    hasChat=$(python3 -c "import json; d=json.load(open('$c')); print('yes' if d.get('chat') else 'no')")
    printf "%-18s layout=%-22s chat=%s\n" "$v" "$layout" "$hasChat"
  fi
done
```

Expected output (this is the known state as of 24f drafting):

```
agents-viewer      layout=full                   chat=yes   ← FIX
browser-viewer     layout=full                   chat=yes   ← FIX
capture-viewer     layout=sidebar-chat-content   chat=yes   (OK)
code-viewer        layout=sidebar-chat-content   chat=yes   (OK)
docs-viewer        layout=sidebar-chat-content   chat=yes   (OK)
email-viewer       layout=sidebar-chat-content   chat=yes   (OK)
issues-viewer      layout=chat-content           chat=yes   ← FIX
library-viewer     layout=full                   chat=yes   ← FIX
wiki-viewer        layout=full                   chat=yes   ← FIX
```

**Five views need the flip:** `agents-viewer`, `browser-viewer`, `issues-viewer`, `library-viewer`, `wiki-viewer`.

If the actual output differs (e.g., a new view has been added, or a layout has changed since drafting), reconcile against the current state before editing. The rule is: **any chat-enabled view whose layout is not `sidebar-chat-content` gets flipped.**

---

## Changes — file by file

### Item 1 — Flip index.json layouts

For each of the five views listed in the pre-flight audit, edit `ai/views/<view>/index.json` and change the `settings.layout` field to `"sidebar-chat-content"`.

Example for `issues-viewer`:

Current (`ai/views/issues-viewer/index.json`):
```json
{
  ...
  "settings": {
    "layout": "chat-content",
    ...
  },
  ...
}
```

New:
```json
{
  ...
  "settings": {
    "layout": "sidebar-chat-content",
    ...
  },
  ...
}
```

**Edit this for all 5 views.** Do not touch any other field in `index.json` — only the `settings.layout` string changes.

Use the Edit tool with a unique anchor (like `"layout": "full"` or `"layout": "chat-content"`) for each file so the replacement is unambiguous.

**Important:** do NOT touch `code-viewer`, `docs-viewer`, `email-viewer`, `capture-viewer` — those already have `sidebar-chat-content` and must not be edited.

---

### Item 2 — Delete `thread:create:confirm` handler in Sidebar.tsx

This is a multi-step surgical split because the handler shares a `useEffect` with the live `thread:link` handler.

**2a. Trim the `useEffect` at L153-190.**

Current:
```tsx
  // Handle WebSocket messages for confirmation modal and copy link
  useEffect(() => {
    if (!ws) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'thread:create:confirm') {
          setConfirmModal({
            show: true,
            message: msg.message,
            onConfirm: () => {
              sendMessage({ type: 'thread:open-assistant', confirmed: true });
              setConfirmModal(prev => ({ ...prev, show: false }));
            },
            onCancel: () => {
              setConfirmModal(prev => ({ ...prev, show: false }));
            }
          });
        } else if (msg.type === 'thread:link') {
          // Copy the file path to clipboard
          if (msg.filePath) {
            navigator.clipboard.writeText(msg.filePath).then(() => {
              // Show a brief success indicator (could be enhanced with a toast)
              console.log('[Sidebar] Copied link to clipboard:', msg.filePath);
            }).catch(err => {
              console.error('[Sidebar] Failed to copy link:', err);
            });
          }
        }
      } catch (e) {
        // Ignore non-JSON messages
      }
    };

    ws.addEventListener('message', handleMessage);
    return () => ws.removeEventListener('message', handleMessage);
  }, [ws]);
```

New (only `thread:link` remains; the entire `thread:create:confirm` branch and its `setConfirmModal` calls are gone):
```tsx
  // Handle WebSocket messages for copy-link.
  useEffect(() => {
    if (!ws) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'thread:link') {
          // Copy the file path to clipboard
          if (msg.filePath) {
            navigator.clipboard.writeText(msg.filePath).then(() => {
              console.log('[Sidebar] Copied link to clipboard:', msg.filePath);
            }).catch(err => {
              console.error('[Sidebar] Failed to copy link:', err);
            });
          }
        }
      } catch (e) {
        // Ignore non-JSON messages
      }
    };

    ws.addEventListener('message', handleMessage);
    return () => ws.removeEventListener('message', handleMessage);
  }, [ws]);
```

Changes:
- Header comment updated: "confirmation modal and copy link" → "copy-link"
- The whole `if (msg.type === 'thread:create:confirm')` branch deleted
- The `else if` on the `thread:link` branch becomes a plain `if`
- The dropped inline comment about "could be enhanced with a toast" can stay or go — your call; it's harmless

**2b. Cascade-delete the `confirmModal` state and any render block.**

After removing the handler, `setConfirmModal` has zero writers, which means the `confirmModal` state is dead. Grep the file:

```bash
grep -n "confirmModal" open-robin-client/src/components/Sidebar.tsx
```

You should see:
- A `useState` declaration — delete it
- Zero remaining `setConfirmModal` references (if any remain, they're dead — delete their call sites)
- A render block that conditionally shows a modal when `confirmModal.show` is true — delete the entire block
- Possibly a `<ConfirmModal>` component import — if the component is only used here, delete the import. If it's used elsewhere, leave the import.

Verify:
```bash
grep -n "confirmModal\|ConfirmModal" open-robin-client/src/components/Sidebar.tsx
```

Expected after 2b: zero hits (if no other file uses `ConfirmModal`, also delete the import line).

**2c. Verify the file still compiles and the thread:link flow still works.**

After 2a + 2b, the file should have no dangling `confirmModal` references, and the `thread:link` handler should still be in place and functional.

---

### Item 3 — Delete persona-wire notify block in runner/index.js

Inside the `proc.on('exit')` callback, between the "Append one-liner to agent's HISTORY.md" block and the "Push completed state to GitLab" block, there's a 21-line try/catch that's been dead since SPEC-24a.

Current (`lib/runner/index.js:115-135`):
```js
      // Notify active persona wire session (if any)
      try {
        const agentWireSessions = global.__agentWireSessions;
        if (agentWireSessions && manifest?.bot_name) {
          const personaWire = agentWireSessions.get(manifest.bot_name);
          if (personaWire && !personaWire.killed) {
            const notifyMsg = JSON.stringify({
              jsonrpc: '2.0',
              method: 'prompt',
              id: `notify-${Date.now()}`,
              params: {
                user_input: `[System] Run completed: ${manifest.ticket_id} via ${manifest.prompt || 'PROMPT_01.md'}. Outcome: ${manifest.outcome || status}.`,
              },
            });
            personaWire.stdin.write(notifyMsg + '\n');
            console.log(`[Runner] Notified persona wire for ${manifest.bot_name}`);
          }
        }
      } catch (err) {
        console.error(`[Runner] Failed to notify persona: ${err.message}`);
      }

```

DELETE the entire block (comment + try/catch). The two blocks that sandwich it ("Append one-liner to agent's HISTORY.md" and "Push completed state to GitLab") must remain unchanged and adjacent.

After the edit, the `proc.on('exit')` callback should flow directly from the HISTORY.md append block to the GitLab push block with no intermediate code.

**Why this is safe:**
- `global.__agentWireSessions` was set only by `lib/wire/agent-sessions.js`, which was deleted in SPEC-24a.
- No other file sets that global.
- With the setter gone, the global is `undefined`, so `if (agentWireSessions && ...)` at L118 always evaluates false, so the inner block never runs.
- Deletion changes runtime behavior from "silently skip" to "not even present" — identical observable effect.

Verify with a grep after deletion:
```bash
grep -n "__agentWireSessions\|Notify active persona\|personaWire" open-robin-server/lib/runner/index.js
# Expected: zero hits
```

---

## Test plan

### Static checks

```bash
cd /Users/rccurtrightjr./projects/open-robin

# Item 1 verification — all 9 chat-enabled views should now have sidebar-chat-content
for v in agents-viewer browser-viewer capture-viewer code-viewer docs-viewer email-viewer issues-viewer library-viewer wiki-viewer; do
  layout=$(python3 -c "import json; print(json.load(open('ai/views/$v/index.json')).get('settings',{}).get('layout','(none)'))")
  [ "$layout" != "sidebar-chat-content" ] && echo "FAIL: $v has layout=$layout"
done
echo "Item 1 audit complete"
# Expected: only the "Item 1 audit complete" line with no FAIL rows

# Item 2 verification — zero confirmModal references in Sidebar.tsx
grep -c "confirmModal\|thread:create:confirm" open-robin-client/src/components/Sidebar.tsx
# Expected: 0

# Item 3 verification — zero persona-wire references in runner/index.js
grep -c "__agentWireSessions\|personaWire\|Notify active persona" open-robin-server/lib/runner/index.js
# Expected: 0

# Client typecheck
cd open-robin-client && npx tsc --noEmit
# Expected: no errors

# Server module loads
cd ../open-robin-server
node -e "require('./lib/runner')"
# Expected: no errors

# Smoke test
node test/smoke-spec03-spec15.js
# Expected: 47 passed, 0 failed (unchanged — no test touches the deleted code)
```

### Client rebuild

```bash
cd /Users/rccurtrightjr./projects/open-robin/open-robin-client && npm run build
# Expected: clean build, new bundle hash
```

### Live validation — the big win

1. **Restart the server.**
   ```bash
   cd /Users/rccurtrightjr./projects/open-robin/open-robin-server
   pkill -9 -f "node.*server.js" 2>/dev/null; sleep 1
   node server.js > /tmp/24f-boot.log 2>&1 &
   sleep 4
   curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3001/
   ```
   Expected: `HTTP 200`, no errors, 11+ triggers parsed, 7+ filters registered, no `[Runner]` or `[Sidebar]` errors in the boot log.

2. **Hard-refresh the browser** (`Cmd+Shift+R`) to pick up the new bundle.

3. **Open each chat-enabled panel** that was previously broken. For each:
   - **issues-viewer** — sidebar should NOW render (previously hidden due to `chat-content` layout). Create a thread, verify it appears in the sidebar.
   - **wiki-viewer** — sidebar should render. Create a thread, verify.
   - **library-viewer** — sidebar should render. (May or may not have full chat flow depending on its content; just verify the sidebar appears.)
   - **browser-viewer** — sidebar should render.
   - **agents-viewer** — sidebar should render. (Caveat: agents-viewer is a special view per the memory. Do NOT dive deep into it; just verify the sidebar appears.)

4. **Switch between panels** and verify the thread lists stay scoped correctly. Creating a thread in issues-viewer should only populate issues-viewer's sidebar. Switching to code-viewer should show code-viewer's threads, not issues-viewer's.

5. **Click the "copy link" menu action** on a thread in code-viewer's sidebar (or any panel). Verify it still copies the file path to the clipboard (this is the preserved `thread:link` handler from Item 2).

6. **Check the boot log** for errors:
   ```bash
   grep -iE "error|exception|cannot find|confirmModal|personaWire|__agentWireSessions" /tmp/24f-boot.log
   # Expected: zero hits
   ```

### What breaks if you get it wrong

| Failure | Root cause | Fix |
|---|---|---|
| Sidebar still missing on issues-viewer | Item 1 didn't touch `issues-viewer/index.json`, or the layout string didn't match `"sidebar-chat-content"` exactly | Re-edit the JSON, respecting exact string |
| `ReferenceError: setConfirmModal is not defined` | Partial delete — removed the handler but left some `setConfirmModal(...)` call | Grep the file, finish the cascade |
| `ReferenceError: confirmModal is not defined` | Left a render block that reads `confirmModal.show` | Delete the render block |
| TypeScript build error about `ConfirmModal` import | Imported but unused after deletion | Remove the import line |
| Server boot crash in runner | Deleted too much from `runner/index.js` — clipped into the HISTORY.md append or GitLab push blocks | Restore those blocks; only the try/catch from L115-135 should be removed |
| Thread copy-link stops working | Deleted the wrong branch of the `useEffect` | Preserve the `thread:link` branch |
| Smoke test fails | Should not happen — smoke test doesn't touch any of the deleted code. If it does, something unexpected broke; flag and stop. |

---

## Do not do

- **Do not** touch `code-viewer`, `docs-viewer`, `email-viewer`, or `capture-viewer` index.json — they already have the correct layout.
- **Do not** touch `calendar-viewer` or any view with `"chat": null` in its content.json — those legitimately don't have chat and should stay `full`.
- **Do not** modify any field in `index.json` other than `settings.layout`. No theme changes, no icon changes, no label changes.
- **Do not** delete the `thread:link` handler in `Sidebar.tsx` — it's alive and still used by the copy-link menu action.
- **Do not** delete the surrounding `useEffect` wrapper in `Sidebar.tsx` — trim the inside, keep the wrapper.
- **Do not** touch `panels.ts:152-159` code-viewer layout path special case — it's load-bearing prototype code for the per-view CSS architecture, not dead.
- **Do not** touch `panels.ts:178` layout.json field loading — SPEC-26 will consume those fields.
- **Do not** touch `ContentArea.tsx` `CONTENT_COMPONENTS` dispatch table — separate spec territory.
- **Do not** touch `lib/resource-path.ts` — same.
- **Do not** touch the SQLite `date` column or migration 001 — frozen.
- **Do not** touch anything in `lib/runner/` beyond the specific 21-line block in `index.js:115-135`. The rest of the runner is alive.
- **Do not** add any new functionality. This is pure deletion + JSON config stopgap.
- **Do not** rename any files or symbols. Keep every import/export stable.
- **Do not** commit. Orchestrator commits after verifying the diff + live validation.

---

## Commit message template

```
SPEC-24f: deep sweep — layout stopgap + dead code removal

Final phase of the 24x series. Three surgical items, one commit.

1. Layout config stopgap (5 views). Flipped settings.layout in
   agents-viewer, browser-viewer, issues-viewer, library-viewer,
   and wiki-viewer index.json from `full`/`chat-content` to
   `sidebar-chat-content` so the chat sidebar renders for those
   panels. This unblocks multi-panel testing of the 24a-24e chat
   work. Stopgap — SPEC-26 will replace the 3-layout switch with
   a collapsible drawer and these JSON values become meaningless
   or get repurposed.

2. Deleted thread:create:confirm dead client handler in
   Sidebar.tsx. The server never sends this message type (24a
   removed the confirmation flow). The handler shared a useEffect
   with the live thread:link copy-link handler — surgical split
   preserved thread:link while removing the confirmation branch.
   Cascade-deleted the confirmModal state, setConfirmModal calls,
   modal render block, and ConfirmModal import (all dead after
   the handler removal).

3. Deleted persona-wire notify block at lib/runner/index.js:115-135.
   The try/catch reads global.__agentWireSessions, which was set
   only by lib/wire/agent-sessions.js — deleted in SPEC-24a. The
   guard has always evaluated false since then; the block was
   21 lines of unreachable code. Removed cleanly.

Live-validated:
  - HTTP 200, trigger/filter loading unchanged
  - issues-viewer, wiki-viewer, library-viewer, browser-viewer,
    agents-viewer all render the chat sidebar (previously hidden)
  - Thread list scoping per panel still correct (SQLite panel_id
    filtering intact)
  - Copy-link thread:link handler still works
  - No runtime errors in boot log or browser console
  - Smoke test unchanged (deleted code has no test coverage)

The 24x series (chat simplification) is now complete. Remaining
work is deferred to SPEC-26 (collapsible drawer + chat header) and
a future CSS architecture migration spec.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---

## Report back

1. **Diff stats.** `git diff --stat main`. Expected: 5 JSON files changed (one field each), `Sidebar.tsx` net shrinks, `runner/index.js` net shrinks. Small diff overall.

2. **Static check output.** Paste every grep/node-e/tsc/smoke-test result from the "Static checks" section. Every assertion must pass.

3. **Pre-flight audit result.** Paste the `for v in ...` output showing the post-edit state of all 9 chat-enabled views. All should show `layout=sidebar-chat-content`.

4. **Item 2 cascade results.** What did `grep -n "confirmModal" Sidebar.tsx` return BEFORE and AFTER your edit? How many `setConfirmModal` references did you delete? Was there a render block to remove? Was the `ConfirmModal` import only used here?

5. **Live validation evidence.**
   - `HTTP 200` curl result
   - Screenshot or description of each non-code-viewer panel showing the sidebar (at minimum: issues-viewer, wiki-viewer)
   - Confirmation that switching between panels keeps thread lists scoped correctly
   - Confirmation that `thread:link` copy-link still works on one panel

6. **Any surprises.**
   - Did the `confirmModal` cascade reveal more dead code than expected?
   - Did a view's `index.json` have an unexpected shape (nested `settings` differently, missing the field, etc.)?
   - Did the browser console show any errors after hard-refresh?
   - Did any view render weirdly (layout-wise) after the flip?

7. **Files touched outside the change list.** Should be zero. If any, explain.

8. **Any 26 signals you noticed.** Things you spotted while touching Sidebar.tsx or App.tsx that look relevant to SPEC-26's collapsible drawer + chat header design. Examples:
   - Hardcoded colors that should be tokens
   - Layout assumptions that won't survive the drawer refactor
   - FLIP animation state that needs to move somewhere
   - Inline styles that should be in views.css

Hand the report back to the orchestrator. After this lands, the 24x series is complete.
