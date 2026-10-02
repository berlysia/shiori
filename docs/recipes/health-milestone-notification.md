# Health Milestone Notification

A recipe that sends a positive-feedback notification when the health score reaches a threshold. Sharing the reduction of technical debt as a "visible achievement" helps keep the team motivated.

## Overview

Governance improvements tend to become invisible: fewer problems means fewer notifications. This recipe takes the opposite approach:

- Send a 🎉 notification when the health score reaches the target threshold (default: 80)
- Include the score improvement history in the message
- Supports both Slack and GitHub Step Summary

## Script

```bash
#!/usr/bin/env bash
# health-milestone-notification.sh
# Send a positive-feedback notification when the health score reaches the threshold
# Requires: SLACK_WEBHOOK_URL environment variable (optional)
set -euo pipefail

THRESHOLD="${1:-80}"

# Get the health score
RESULT=$(shiori health -f json 2>/dev/null)
SCORE=$(echo "$RESULT" | jq '.data.health.score')
LEVEL=$(echo "$RESULT" | jq -r '.data.health.level')
ISSUES=$(echo "$RESULT" | jq '.data.issues.total')

# Do not notify if below the threshold
if [ "$SCORE" -lt "$THRESHOLD" ]; then
  echo "Score ${SCORE} is below threshold ${THRESHOLD}. No notification."
  exit 0
fi

echo "🎉 Health score ${SCORE} reached threshold ${THRESHOLD}!"

# Slack notification (when SLACK_WEBHOOK_URL is set)
if [ -n "${SLACK_WEBHOOK_URL:-}" ]; then
  TEXT=":tada: *Governance Milestone Reached!*\n"
  TEXT+=":chart_with_upwards_trend: Health Score: *${SCORE}/100* (${LEVEL})\n"
  TEXT+=":dart: Threshold: ${THRESHOLD}\n"
  TEXT+=":page_facing_up: Remaining issues: ${ISSUES}\n"
  TEXT+="Great work keeping technical debt under control! :muscle:"

  curl -s -X POST "$SLACK_WEBHOOK_URL" \
    -H 'Content-Type: application/json' \
    -d "{\"text\": \"${TEXT}\"}"
  echo "Slack notification sent."
fi
```

## Usage

```bash
# Check with the default threshold (80)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/... bash docs/recipes/health-milestone-notification.sh

# Custom threshold: 90
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/... bash docs/recipes/health-milestone-notification.sh 90
```

## GitHub Actions Integration

```yaml
# .github/workflows/shiori-health-milestone.yml
name: shiori health milestone

on:
  push:
    branches: [main]
    paths:
      - '.config/shiori/**'
  workflow_dispatch:
    inputs:
      threshold:
        description: 'Health score threshold for celebration'
        required: false
        default: '80'

jobs:
  milestone-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: '22'
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile

      - name: Check health milestone
        id: health
        run: |
          THRESHOLD="${{ inputs.threshold || '80' }}"
          RESULT=$(pnpm shiori health -f json 2>/dev/null)
          SCORE=$(echo "$RESULT" | jq '.data.health.score')
          LEVEL=$(echo "$RESULT" | jq -r '.data.health.level')
          ISSUES=$(echo "$RESULT" | jq '.data.issues.total')

          echo "score=$SCORE" >> "$GITHUB_OUTPUT"
          echo "level=$LEVEL" >> "$GITHUB_OUTPUT"
          echo "issues=$ISSUES" >> "$GITHUB_OUTPUT"
          echo "threshold=$THRESHOLD" >> "$GITHUB_OUTPUT"
          echo "reached=$( [ "$SCORE" -ge "$THRESHOLD" ] && echo true || echo false )" >> "$GITHUB_OUTPUT"

      - name: Post milestone to Step Summary
        if: steps.health.outputs.reached == 'true'
        run: |
          cat >> "$GITHUB_STEP_SUMMARY" <<EOF
          ## 🎉 Governance Milestone Reached!

          | Metric | Value |
          |--------|-------|
          | Health Score | **${{ steps.health.outputs.score }}/100** |
          | Level | ${{ steps.health.outputs.level }} |
          | Threshold | ${{ steps.health.outputs.threshold }} |
          | Remaining Issues | ${{ steps.health.outputs.issues }} |

          Great work keeping technical debt under control!
          EOF

      - name: Notify Slack
        if: steps.health.outputs.reached == 'true' && env.SLACK_WEBHOOK_URL != ''
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
        run: |
          SCORE="${{ steps.health.outputs.score }}"
          LEVEL="${{ steps.health.outputs.level }}"
          THRESHOLD="${{ steps.health.outputs.threshold }}"
          ISSUES="${{ steps.health.outputs.issues }}"

          TEXT=":tada: *Governance Milestone Reached!*\n"
          TEXT+=":chart_with_upwards_trend: Health Score: *${SCORE}/100* (${LEVEL})\n"
          TEXT+=":dart: Threshold: ${THRESHOLD}\n"
          TEXT+=":page_facing_up: Remaining issues: ${ISSUES}\n"
          TEXT+="Great work keeping technical debt under control! :muscle:"

          curl -s -X POST "$SLACK_WEBHOOK_URL" \
            -H 'Content-Type: application/json' \
            -d "{\"text\": \"${TEXT}\"}"

      - name: Post current status (below threshold)
        if: steps.health.outputs.reached == 'false'
        run: |
          echo "### Health Status" >> "$GITHUB_STEP_SUMMARY"
          echo "Score: ${{ steps.health.outputs.score }}/100 (threshold: ${{ steps.health.outputs.threshold }})" >> "$GITHUB_STEP_SUMMARY"
          echo "Keep going! 💪" >> "$GITHUB_STEP_SUMMARY"
```

## Setting Staged Thresholds

Raising the threshold as the project matures keeps the motivation for continuous improvement:

| Phase        | Threshold | Meaning                                   |
| ------------ | --------- | ----------------------------------------- |
| Introduction | 50        | Basic annotation tracking has started     |
| Establishing | 70        | Major violations are under management     |
| Maturity     | 80        | Governance is built into daily operations |
| Optimization | 90        | Technical debt is being actively reduced  |

## Integration with the Autopilot Kit

When incorporating this into the cron workflow of the [Governance Autopilot Kit](./governance-autopilot-kit.md), you can add a milestone check after the health check:

```yaml
- name: Health check
  id: health
  run: pnpm shiori health -f json -o .tmp/health.json

- name: Milestone notification
  run: |
    SCORE=$(jq '.data.health.score' .tmp/health.json)
    if [ "$SCORE" -ge 80 ]; then
      echo "🎉 Milestone reached!" >> "$GITHUB_STEP_SUMMARY"
    fi
```

## Position in the Governance Maturity Model

This recipe structures a "positive feedback loop". It pairs with the recipes that detect and warn about problems (Expires Alert, Orchestrator) and makes the results of improvement visible.

| Level | Corresponding Recipe                                   | Feedback                                    |
| ----- | ------------------------------------------------------ | ------------------------------------------- |
| 2     | [Checks Gate](./github-checks-gate.md)                 | ❌ Blocks when there are problems           |
| 3     | [Governance Badge](./governance-badge.md)              | 📊 Always shows the score                   |
| 4     | [Orchestrator](./scheduled-governance-orchestrator.md) | ⚠️ Turns problems into Issues automatically |
| 4+    | **This recipe**                                        | 🎉 Celebrates improvement                   |

## Related

- [Slack Pulse](./slack-pulse.md) — Periodic dashboard notification
- [Governance Badge](./governance-badge.md) — Show a score badge in the README
- [Scheduled Governance Orchestrator](./scheduled-governance-orchestrator.md) — Automating problem detection
