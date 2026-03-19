#!/usr/bin/env bash
# Post or update a PR comment with delta and triage reports.
# Uses gh CLI for GitHub API calls.
#
# Usage: post-pr-comment.sh <repo> <pr-number> <delta-file> <triage-file> <show-onboarding>
# Requires: GH_TOKEN environment variable

set -euo pipefail

REPO="$1"
PR_NUMBER="$2"
DELTA_FILE="$3"
TRIAGE_FILE="$4"
SHOW_ONBOARDING="$5"

MARKER="<!-- shiori-delta -->"

echo "::group::Post PR comment"

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
fi

# Assemble comment body
BODY="$DELTA_CONTENT"

# Add triage section (collapsed)
if [ -n "$TRIAGE_CONTENT" ]; then
  BODY="$BODY

<details>
<summary>📋 Triage Report</summary>

$TRIAGE_CONTENT

</details>"
fi

# Add onboarding footer
if [ "$SHOW_ONBOARDING" = "true" ]; then
  BODY="$BODY

---

<details>
<summary>🔖 What is shiori?</summary>

**shiori** tracks lint-disable annotations and other code exceptions in a structured registry,
keeping technical debt visible and governable.

#### Quick Start

\`\`\`bash
# Install
pnpm add -D @berlysia/shiori

# Initialize with starter templates
pnpm shiori init --starter

# Scan your codebase
pnpm shiori scan

# See what needs attention
pnpm shiori check
\`\`\`

[Learn more](https://github.com/berlysia/shiori)

</details>"
fi

# Find existing comment by marker
COMMENT_ID=$(gh api "repos/$REPO/issues/$PR_NUMBER/comments" --paginate --jq ".[] | select(.body | contains(\"$MARKER\")) | .id" 2>/dev/null | head -1 || true)

if [ -n "$COMMENT_ID" ] && [ "$COMMENT_ID" != "null" ]; then
  # Update existing comment
  gh api "repos/$REPO/issues/comments/$COMMENT_ID" \
    --method PATCH \
    --field body="$BODY" \
    --silent
  echo "Updated existing comment $COMMENT_ID"
else
  # Create new comment
  gh api "repos/$REPO/issues/$PR_NUMBER/comments" \
    --method POST \
    --field body="$BODY" \
    --silent
  echo "Created new comment on PR #$PR_NUMBER"
fi

echo "::endgroup::"
