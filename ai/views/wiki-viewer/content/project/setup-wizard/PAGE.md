# Setup Wizard

Onboarding checklist for new Kimi installations. Each step is opt-in. The system works without any of these, but enabling them unlocks additional functionality.

## Required

These are needed for Kimi to function at all.

- [ ] **Node.js** installed (v18+)
- [ ] **Kimi CLI** authenticated (`kimi login`)
- [ ] **Project cloned** and dependencies installed (`npm install` in both client and server)

## Recommended

These improve the day-to-day experience significantly.

- [ ] **macOS screenshot location** — Redirect screenshots to `~/Desktop/Screenshots/` so the system can access them. See [Screenshot-Capture](Screenshot-Capture).
  ```bash
  mkdir -p ~/Desktop/Screenshots
  defaults write com.apple.screencapture location ~/Desktop/Screenshots
  killall SystemUIServer
  ```
  **Privacy note:** This changes where macOS saves screenshots. Your screenshots stay on your machine — nothing is uploaded. The project accesses them via a symlink.

- [ ] **Playwright browsers** — Install for e2e testing and automated visual verification.
  ```bash
  cd kimi-ide-client && npx playwright install chromium
  ```

## Optional

Power-user features. Skip these until you need them.

- [ ] **GitLab integration** — For wiki syncing and issue tracking. Requires a personal access token. See [GitLab](GitLab) and [Secrets](Secrets).

- [ ] **Background agents** — Autonomous workers that poll for tasks. See [Background-Agents](Background-Agents). Requires separate terminal instances.

- [ ] **macOS Keychain secrets** — Store API keys in the system keychain instead of env vars. See [Secrets](Secrets).
  ```bash
  security add-generic-password -a kimi -s "kimi-api-key" -w "YOUR_KEY"
  ```

## Per-Project Setup

When creating a new project that uses the Kimi workspace system:

1. Create `ai/` directory structure (workspaces, scripts, screenshots)
2. Symlink screenshots: `ln -s ~/Desktop/Screenshots ai/screenshots/desktop`
3. Add `screenshots/` to `ai/.gitignore`
4. Create workspace folders as needed

## Privacy Principles

- **No automatic system changes** — Every system-level change (screenshot location, keychain entries, Git config) requires explicit user action.
- **Local-first** — All data stays on the machine unless the user explicitly pushes to a remote.
- **Opt-in escalation** — Base functionality works without any special permissions. Each opt-in step is documented with what it does and why.
