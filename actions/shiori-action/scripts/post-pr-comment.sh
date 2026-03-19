#!/usr/bin/env bash
# Post or update a PR comment with governance summary.
# Uses gh CLI for GitHub API calls.
#
# Usage: post-pr-comment.sh <repo> <pr-number> <summary-file> <show-onboarding> [candidates-file]
# Requires: GH_TOKEN environment variable

set -euo pipefail

REPO="$1"
PR_NUMBER="$2"
SUMMARY_FILE="$3"
SHOW_ONBOARDING="$4"
CANDIDATES_FILE="${5:-}"

MARKER="<!-- shiori-governance -->"

echo "::group::Post PR comment"

# Read summary report (always include marker for comment deduplication)
SUMMARY_CONTENT=""
if [ -f "$SUMMARY_FILE" ]; then
  SUMMARY_CONTENT=$(cat "$SUMMARY_FILE")
else
  SUMMARY_CONTENT="_No governance summary generated._"
fi

# Assemble comment body with marker
BODY="$MARKER
$SUMMARY_CONTENT"

# Add onboarding footer
if [ "$SHOW_ONBOARDING" = "true" ]; then
  # Build candidates discovery section when candidates file is provided
  CANDIDATES_SECTION=""
  if [ -n "$CANDIDATES_FILE" ] && [ -f "$CANDIDATES_FILE" ]; then
    CANDIDATES_COUNT=$(jq '.count // 0' "$CANDIDATES_FILE" 2>/dev/null || echo "0")
    if [ "$CANDIDATES_COUNT" -gt 0 ] 2>/dev/null; then
      # Extract top 3 candidates for display
      CANDIDATES_EXAMPLES=$(jq -r '.candidates[:3][] | "- `\(.location.file):\(.location.line)` \(.pattern)\(if .rule then " `\(.rule)`" else "" end)"' "$CANDIDATES_FILE" 2>/dev/null || true)
      CANDIDATES_SECTION="
#### 🔍 Untracked lint disables detected

Found **${CANDIDATES_COUNT}** untracked lint disable(s) in this PR.

${CANDIDATES_EXAMPLES}

Start tracking with \`shiori adopt\` to bring them under governance."
    fi
  fi

  BODY="$BODY

---

<details>
<summary>🔖 What is shiori?</summary>

**shiori** tracks lint-disable annotations and other code exceptions in a structured registry,
keeping technical debt visible and governable.
${CANDIDATES_SECTION}

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

# Find existing comment by marker (also check legacy marker for migration)
LEGACY_MARKER="<!-- shiori-delta -->"
COMMENT_ID=$(gh api "repos/$REPO/issues/$PR_NUMBER/comments" --paginate --jq ".[] | select(.body | (contains(\"$MARKER\") or contains(\"$LEGACY_MARKER\"))) | .id" 2>/dev/null | head -1 || true)

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
