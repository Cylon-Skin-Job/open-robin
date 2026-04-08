# Screenshot Capture

How the active CLI accesses user screenshots for visual debugging and conversation context.

## How It Works

macOS screenshots land in `~/Desktop/Screenshots/`. The project symlinks to that folder:

```
ai/screenshots/desktop -> ~/Desktop/Screenshots/
```

This gives agents and the wiki system read access to screenshots without copying files or running watchers. Screenshots are ephemeral — FIFO. The folder can be purged periodically.

## Setup

**Step 1: Create the screenshots folder** (if it doesn't exist)
```bash
mkdir -p ~/Desktop/Screenshots
```

**Step 2: Redirect macOS screenshots there**
```bash
defaults write com.apple.screencapture location ~/Desktop/Screenshots
killall SystemUIServer
```

**Step 3: Symlink from project**
```bash
ln -s ~/Desktop/Screenshots ai/screenshots/desktop
```

**Step 4: Gitignore**
Already handled — `ai/.gitignore` excludes `screenshots/`.

## Privacy

- Screenshots stay on the local machine
- Nothing is uploaded, synced, or committed to git
- The symlink is read-only from the project's perspective
- macOS screenshot location change is reversible: `defaults delete com.apple.screencapture location`

## Multi-Project

Currently one project uses this. When multiple projects exist, each will have its own `ai/screenshots/desktop` symlink pointing to the same `~/Desktop/Screenshots/` folder. The active project context determines which workspace the screenshot is relevant to — no routing needed since all projects see the same folder.

## Status

- **2026-03-25:** Symlink created, gitignored, documented. macOS screenshot redirect is a manual opt-in step (see [Setup-Wizard](Setup-Wizard)).
