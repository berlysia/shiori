#!/usr/bin/env bash
# Update PR description by replacing content between marker comments.
# Uses gh CLI for GitHub API calls.
#
# Usage: update-pr-description.sh <repo> <pr-number> <delta-file> <triage-file>
# Requires: GH_TOKEN environment variable

set -euo pipefail

REPO="$1"
PR_NUMBER="$2"
DELTA_FILE="$3"
TRIAGE_FILE="$4"

echo "::group::Update PR description"

# Read delta report
DELTA_CONTENT=""
if [ -f "$DELTA_FILE" ]; then
  DELTA_CONTENT=$(cat "$DELTA_FILE")
else
  DELTA_CONTENT="_No delta report generated._"
fi

# Read triage report
TRIAGE_CONTENT=""
if [ -f "$TRIAGE_FILE" ]; then
  TRIAGE_CONTENT=$(cat "$TRIAGE_FILE")
else
  TRIAGE_CONTENT="_No triage report generated._"
fi

# Get current PR body
PR_BODY=$(gh api "repos/$REPO/pulls/$PR_NUMBER" --jq '.body // ""')

# Replace or append delta section
DELTA_START="<!-- shiori-delta-start -->"
DELTA_END="<!-- shiori-delta-end -->"

if echo "$PR_BODY" | grep -qF "$DELTA_START" && echo "$PR_BODY" | grep -qF "$DELTA_END"; then
  # Replace content between markers using ENVIRON to avoid awk -v backslash/newline issues
  export SHIORI_REPLACE_CONTENT="$DELTA_CONTENT"
  PR_BODY=$(echo "$PR_BODY" | awk -v start="$DELTA_START" -v end_marker="$DELTA_END" '
    $0 == start { print; print ENVIRON["SHIORI_REPLACE_CONTENT"]; skip=1; next }
    $0 == end_marker { skip=0 }
    !skip { print }
  ')
else
  # Append section
  PR_BODY="$PR_BODY

## Governance Summary

$DELTA_START
$DELTA_CONTENT
$DELTA_END"
fi

# Replace or append triage section
TRIAGE_START="<!-- shiori-triage-start -->"
TRIAGE_END="<!-- shiori-triage-end -->"

if echo "$PR_BODY" | grep -qF "$TRIAGE_START" && echo "$PR_BODY" | grep -qF "$TRIAGE_END"; then
  export SHIORI_REPLACE_CONTENT="$TRIAGE_CONTENT"
  PR_BODY=$(echo "$PR_BODY" | awk -v start="$TRIAGE_START" -v end_marker="$TRIAGE_END" '
    $0 == start { print; print ENVIRON["SHIORI_REPLACE_CONTENT"]; skip=1; next }
    $0 == end_marker { skip=0 }
    !skip { print }
  ')
else
  PR_BODY="$PR_BODY

## Triage Report

$TRIAGE_START
$TRIAGE_CONTENT
$TRIAGE_END"
fi

# Update PR
gh api "repos/$REPO/pulls/$PR_NUMBER" \
  --method PATCH \
  --field body="$PR_BODY" \
  --silent

echo "PR description updated successfully"
echo "::endgroup::"
