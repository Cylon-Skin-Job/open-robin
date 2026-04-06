#!/bin/bash
# Migrate keychain secrets from kimi-ide -> open-robin
# Run ONCE before Phase 4 code changes take effect.
# Old entries are left intact for rollback safety.

OLD_ACCOUNT="kimi-ide"
NEW_ACCOUNT="open-robin"

for SERVICE in GITLAB_TOKEN ANTHROPIC_API_KEY GOOGLE_API_KEY OPENAI_API_KEY; do
  VALUE=$(/usr/bin/security find-generic-password -a "$OLD_ACCOUNT" -s "$SERVICE" -w 2>/dev/null)
  if [ -n "$VALUE" ]; then
    /usr/bin/security add-generic-password -a "$NEW_ACCOUNT" -s "$SERVICE" -w "$VALUE" -U
    echo "Migrated $SERVICE"
  else
    echo "Skipped $SERVICE (not found under $OLD_ACCOUNT)"
  fi
done
echo "Migration complete. Old entries left intact for rollback."
