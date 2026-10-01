# Slack Governance Pulse Dashboard

Send a weekly governance pulse to Slack using Block Kit for rich formatting.
Uses `shiori summary --format slack` to generate a Slack-native payload.

## Prerequisites

- Slack incoming webhook URL ([Create one](https://api.slack.com/messaging/webhooks))
- shiori v0.2.0+

## Script

```bash
#!/usr/bin/env bash
# slack-pulse.sh
# Sends a governance pulse dashboard to Slack via Block Kit JSON.
# Requires: SLACK_WEBHOOK_URL environment variable
set -euo pipefail

# Generate Block Kit payload; stderr has diagnostic output
PAYLOAD=$(shiori summary --format slack --history .config/shiori/reports/ --snapshot .config/shiori/reports/ 2>/dev/null)

# POST to Slack webhook
curl -s -X POST "$SLACK_WEBHOOK_URL" \
  -H 'Content-Type: application/json' \
  -d "$PAYLOAD"
```

## Usage

```bash
# Basic pulse (health + issues only)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/... bash docs/recipes/slack-pulse.sh

# With trend data (requires accumulated snapshots in .config/shiori/reports/)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/... bash docs/recipes/slack-pulse.sh
```

## GitHub Actions Integration

```yaml
name: Weekly Governance Pulse
on:
  schedule:
    - cron: '0 9 * * 1' # Every Monday at 09:00 UTC
  workflow_dispatch: {}

jobs:
  pulse:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - uses: actions/setup-node@v7
        with:
          node-version: '22'

      - run: npm install -g @berlysia/shiori

      - name: Send governance pulse to Slack
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
        run: |
          shiori summary --format slack \
            --history .config/shiori/reports/ \
            --snapshot .config/shiori/reports/ \
            | curl -s -X POST "$SLACK_WEBHOOK_URL" \
                -H 'Content-Type: application/json' \
                -d @-
```

## Options

| Flag                       | Purpose                                  |
| -------------------------- | ---------------------------------------- |
| `--format slack`           | Generate Slack Block Kit JSON            |
| `--history <dir>`          | Load past snapshots for trend sparkline  |
| `--snapshot <dir>`         | Save current snapshot for future trends  |
| `--repository <name>`      | Tag with repo name for multi-repo setups |
| `--fail-on-level critical` | Set exit code 1 if health is critical    |

## Combining with Health Gate

```bash
# Post to Slack AND fail CI if health is critical
shiori summary --format slack --fail-on-level critical \
  | curl -s -X POST "$SLACK_WEBHOOK_URL" \
    -H 'Content-Type: application/json' \
    -d @-
```

## See Also

- [slack-notification.md](./slack-notification.md) — Simple text alerts for expiring annotations
- [governance-coach.md](./governance-coach.md) — LLM coaching from governance data
