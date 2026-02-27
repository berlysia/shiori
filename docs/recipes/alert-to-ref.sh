#!/usr/bin/env bash
# alert-to-ref.sh — GitHub Code Scanning Alert to shiori ref jump bridge
#
# Usage: alert-to-ref.sh <owner/repo> <alert_number>
#
# Fetches a GitHub Code Scanning alert via gh CLI, extracts the shiori ref
# from the alert message, and invokes `shiori show --ref <ref>`.
#
# Exit codes:
#   0 — Success
#   1 — Ref extraction failed (message pattern mismatch)
#   2 — gh CLI not installed
#   3 — GitHub API authentication failure (401/403)
#   4 — Alert not found (404)
#   5 — Network or other errors

set -euo pipefail

# --- Argument validation ---
if [ $# -lt 2 ]; then
  echo "Usage: alert-to-ref.sh <owner/repo> <alert_number>" >&2
  exit 1
fi

REPO="$1"
ALERT_NUMBER="$2"

# --- Prerequisite check: gh CLI ---
if ! command -v gh >/dev/null 2>&1; then
  echo 'Error: gh CLI not found. Install: https://cli.github.com/' >&2
  exit 2
fi

# --- Fetch alert message text via GitHub API ---
# gh api handles authentication and returns appropriate errors
MESSAGE=""
API_ERROR=""
API_ERROR=$(gh api \
  "/repos/${REPO}/code-scanning/alerts/${ALERT_NUMBER}" \
  --jq '.most_recent_instance.message.text' 2>&1) && MESSAGE="$API_ERROR" || {
  EXIT_CODE=$?
  ERROR_TEXT="$API_ERROR"

  # Detect HTTP status from gh error output
  if echo "$ERROR_TEXT" | grep -qiE '401|403|authentication|forbidden'; then
    echo 'Error: GitHub API authentication failed. Run "gh auth login" first.' >&2
    exit 3
  elif echo "$ERROR_TEXT" | grep -qi '404\|not found'; then
    echo "Error: Alert #${ALERT_NUMBER} not found in ${REPO}." >&2
    exit 4
  else
    echo "Error: Failed to fetch alert: ${ERROR_TEXT}" >&2
    exit 5
  fi
}

if [ -z "$MESSAGE" ]; then
  echo "Error: Could not extract message text from alert response" >&2
  exit 1
fi

# --- Extract ref from message ---
# verify.ts produces two patterns:
#   ID "<ref>" — for missing-in-registry, unused-in-source, expired
#   Ref "<ref>" — for ref-format, unrouted-ref, ref-collision, registry-routing-mismatch
# Regex captures the quoted value after either keyword.
REF=$(echo "$MESSAGE" | grep -oP '(?:ID|Ref) "\K[^"]+' | head -1) || true

if [ -z "$REF" ]; then
  echo "Error: Could not extract ref from alert message: \"${MESSAGE}\"" >&2
  exit 1
fi

# --- Jump to ref ---
exec shiori show --ref "$REF"
