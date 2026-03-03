# GitHub Issue Auto-Creation for Expired Annotations

Automatically create GitHub Issues for each expired or expiring-soon annotation using `gh` CLI.

## Script

```bash
#!/usr/bin/env bash
# shiori-create-issues.sh — Create GitHub Issues for expiring annotations
set -euo pipefail

THRESHOLD="${1:-14}"
RESULT=$(shiori check --fail-on expired --expiring-threshold "$THRESHOLD" -f json 2>/dev/null || true)

# Extract expiring-soon and expired issues
echo "$RESULT" | jq -r '
  .issues[]
  | select(.type == "expired" or .type == "expiring-soon")
  | [.type, .ref, .message] | @tsv
' | while IFS=$'\t' read -r TYPE REF MESSAGE; do
  LABEL="governance"
  if [ "$TYPE" = "expired" ]; then
    LABEL="governance,expired"
    TITLE="[shiori] Expired: $REF"
  else
    LABEL="governance,expiring-soon"
    TITLE="[shiori] Expiring soon: $REF"
  fi

  # Check if issue already exists
  EXISTING=$(gh issue list --search "in:title $TITLE" --state open --json number --jq 'length')
  if [ "$EXISTING" -gt 0 ]; then
    echo "Issue already exists for $REF, skipping"
    continue
  fi

  gh issue create \
    --title "$TITLE" \
    --body "**$TYPE**: $MESSAGE" \
    --label "$LABEL"
  echo "Created issue for $REF"
done
```

## Usage

```bash
# Create issues for annotations expiring within 14 days
./shiori-create-issues.sh

# Custom threshold
./shiori-create-issues.sh 30
```

## Notes

- The script checks for existing open issues to avoid duplicates
- Labels `governance`, `expired`, and `expiring-soon` should be created in your repository
- Requires `gh` CLI authenticated with appropriate permissions
