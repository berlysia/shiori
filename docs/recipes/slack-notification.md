# Slack Notification for Expiring Annotations

Send Slack alerts when annotations are approaching or past their expiration date.

## Script

```bash
#!/usr/bin/env bash
# slack-shiori-alert.sh
# Requires: SLACK_WEBHOOK_URL environment variable
set -euo pipefail

THRESHOLD="${1:-14}"
RESULT=$(shiori check --fail-on expired --expiring-threshold "$THRESHOLD" -f json 2>/dev/null || true)

EXPIRED=$(echo "$RESULT" | jq '.summary.byType["expired"]')
EXPIRING=$(echo "$RESULT" | jq '.summary.byType["expiring-soon"]')

if [ "$EXPIRED" -gt 0 ] || [ "$EXPIRING" -gt 0 ]; then
  TEXT=":warning: *Shiori Governance Alert*\n"
  TEXT+="• Expired: $EXPIRED\n"
  TEXT+="• Expiring soon (within ${THRESHOLD} days): $EXPIRING\n"
  TEXT+="Run \`shiori check -f markdown\` for details."

  curl -s -X POST "$SLACK_WEBHOOK_URL" \
    -H 'Content-Type: application/json' \
    -d "{\"text\": \"$TEXT\"}"
fi
```

## Usage

```bash
# Alert for annotations expiring within 14 days (default)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/... ./slack-shiori-alert.sh

# Custom threshold: 30 days
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/... ./slack-shiori-alert.sh 30
```

## GitHub Actions Integration

```yaml
- name: Slack alert for expiring annotations
  env:
    SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
  run: bash docs/recipes/slack-shiori-alert.sh 14
```
