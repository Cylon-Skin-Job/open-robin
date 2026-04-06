#!/bin/sh
# Git credential helper for open-robin secrets (macOS Keychain).
# Reads GITLAB_TOKEN from Keychain when git needs gitlab.com credentials.
#
# Git calls this with "get", "store", or "erase" as $1.
# We only handle "get" — let git manage store/erase elsewhere.

case "$1" in
  get)
    # Read stdin for the request (host, protocol, etc.)
    host=""
    while IFS='=' read -r key value; do
      case "$key" in
        host) host="$value" ;;
      esac
    done

    # Only respond for gitlab.com
    case "$host" in
      gitlab.com)
        TOKEN=$(/usr/bin/security find-generic-password -a "open-robin" -s "GITLAB_TOKEN" -w 2>/dev/null)
        if [ -n "$TOKEN" ]; then
          echo "protocol=https"
          echo "host=gitlab.com"
          echo "username=oauth2"
          echo "password=$TOKEN"
          echo ""
        fi
        ;;
    esac
    ;;
esac
