# GitLab

kimi-claude uses GitLab as the remote for project repos, wikis, and API-driven automation. GitHub remains the primary `origin` — GitLab is the second remote (`gitlab`).

## Namespace

All projects live under the `Cylon-Skin-Job` user namespace:

```
Cylon-Skin-Job/
├── kimi-claude        ← this project
├── LaunchPad          ← has its own wiki (architecture, models, decisions)
├── task-command
├── phoenix-command
├── Jason
└── phoenix
```

There is also a `cylon-skin-job-group` group namespace, currently unused.

## Dual-Remote Pattern

Each project has two remotes:

| Remote   | Host   | Purpose |
|----------|--------|---------|
| `origin` | GitHub | Primary repo, collaboration, CI |
| `gitlab` | GitLab | Wiki hosting, GitLab API features |

```bash
git push origin main    # push to GitHub
git push gitlab main    # push to GitLab
```

## Authentication

GitLab auth uses a Personal Access Token stored in macOS Keychain. See [Secrets](Secrets) for details.

Git credential flow for `gitlab.com`:
1. `git-credential-cache` checks RAM (12-hour TTL)
2. On miss → `scripts/git-credential-kimi.sh` reads from Keychain
3. First Keychain access per session requires one-click "Allow"
4. Token cached in RAM for subsequent operations

The credential helper is configured globally:
```
credential.https://gitlab.com.helper = cache --timeout=43200
credential.https://gitlab.com.helper = scripts/git-credential-kimi.sh
```

## API Access

The same token works for the GitLab API:

```bash
TOKEN=$(security find-generic-password -a "kimi-ide" -s "GITLAB_TOKEN" -w 2>/dev/null)
curl -s --header "PRIVATE-TOKEN: $TOKEN" "https://gitlab.com/api/v4/projects/<id>/wikis"
```

## Token Rotation

Tokens have an expiry date. Rotate via CLI:

```bash
TOKEN=$(security find-generic-password -a "kimi-ide" -s "GITLAB_TOKEN" -w 2>/dev/null)
curl -s -X POST --header "PRIVATE-TOKEN: $TOKEN" \
  "https://gitlab.com/api/v4/personal_access_tokens/self/rotate" \
  -d "expires_at=YYYY-MM-DD"
```

This returns a new token and invalidates the old one. Update the Keychain immediately after:

```bash
security add-generic-password -a "kimi-ide" -s "GITLAB_TOKEN" -w "<new-token>" -U
```

The `self_rotate` scope on the token makes this possible. Current token expires **2026-06-20**.

## Creating a New Project

```bash
TOKEN=$(security find-generic-password -a "kimi-ide" -s "GITLAB_TOKEN" -w 2>/dev/null)
curl -s -X POST --header "PRIVATE-TOKEN: $TOKEN" "https://gitlab.com/api/v4/projects" \
  -d "name=<project-name>" \
  -d "visibility=private" \
  -d "wiki_enabled=true"
```

Then add the remote locally:
```bash
git remote add gitlab https://gitlab.com/Cylon-Skin-Job/<project-name>.git
git push gitlab main
```
