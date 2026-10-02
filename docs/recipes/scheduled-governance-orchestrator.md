# Scheduled Governance Orchestrator

An orchestration workflow that detects expired and soon-to-expire annotations on a schedule and automatically creates GitHub Issues. It is a production-oriented recipe that combines existing recipes ([Expires Alert](./github-actions-expires-alert.md), [GitHub Issue Creation](./github-issue-creation.md), [Slack Notification](./slack-notification.md)).

## Overview

This recipe covers the following in a single workflow:

1. **Scheduled run**: Run `shiori check` periodically via cron
2. **Automatic issue creation**: File a GitHub Issue per ref for expired / expiring-soon annotations
3. **Duplicate prevention**: Match against existing open Issues by ref to avoid filing twice
4. **Automatic assignee**: Resolve a GitHub username from the registry `owner` field
5. **Slack notification** (optional): Post a summary to Slack

## Prerequisites

- Node.js >= 18.0.0
- `shiori` is added to the project's devDependencies
- The `gh` CLI is available on the GitHub Actions runner (available by default)
- A `governance` label exists in the repository (create it with `gh label create governance`)

## Workflow

```yaml
# .github/workflows/shiori-governance-orchestrator.yml
name: shiori governance orchestrator

on:
  schedule:
    # Run every Monday at 9:00 UTC
    - cron: '0 9 * * 1'
  workflow_dispatch:
    inputs:
      threshold:
        description: 'Expiring threshold in days'
        required: false
        default: '30'
      dry_run:
        description: 'Dry run (no issues created)'
        required: false
        default: 'false'
        type: boolean

permissions:
  contents: read
  issues: write

jobs:
  orchestrate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - uses: pnpm/action-setup@v6

      - uses: actions/setup-node@v7
        with:
          node-version: '22'
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile

      # Step 1: Detect expired and expiring-soon annotations with shiori check
      - name: Run shiori check
        id: check
        run: |
          THRESHOLD="${{ inputs.threshold || '30' }}"
          pnpm shiori check \
            --fail-on expired,expiring-soon \
            --expiring-threshold "$THRESHOLD" \
            -f json \
            -o .tmp/shiori-check.json || true

          EXPIRED=$(jq '.summary.byType["expired"] // 0' .tmp/shiori-check.json)
          EXPIRING=$(jq '.summary.byType["expiring-soon"] // 0' .tmp/shiori-check.json)
          echo "expired=$EXPIRED" >> "$GITHUB_OUTPUT"
          echo "expiring=$EXPIRING" >> "$GITHUB_OUTPUT"
          echo "threshold=$THRESHOLD" >> "$GITHUB_OUTPUT"

      # Step 2: Create an Issue per ref (with duplicate check)
      - name: Create issues per ref
        if: steps.check.outputs.expired > 0 || steps.check.outputs.expiring > 0
        env:
          GH_TOKEN: ${{ github.token }}
          DRY_RUN: ${{ inputs.dry_run || 'false' }}
        run: |
          REGISTRY_FILE=".config/shiori/registry.json"
          CREATED=0
          SKIPPED=0

          # Process expired and expiring-soon issues per ref
          # NOTE: Use process substitution < <(...) so the while loop runs in the parent shell.
          # With a pipe (| while) it runs in a subshell and CREATED/SKIPPED are not reflected in the parent.
          while IFS=$'\t' read -r TYPE REF MESSAGE; do

            # Build the Issue title
            if [ "$TYPE" = "expired" ]; then
              TITLE="[shiori] Expired: ${REF}"
              LABELS="governance,expired"
            else
              TITLE="[shiori] Expiring soon: ${REF}"
              LABELS="governance,expiring-soon"
            fi

            # Duplicate check: search existing Issues by shiori label + ref
            EXISTING=$(gh issue list \
              --label "governance" \
              --search "in:title [shiori] ${REF}" \
              --state open \
              --json number \
              --jq 'length' 2>/dev/null || echo "0")

            if [ "$EXISTING" -gt 0 ]; then
              echo "⏭ Skip: Issue already exists for ${REF}"
              SKIPPED=$((SKIPPED + 1))
              continue
            fi

            # Get the owner from the registry and use it as the assignee
            OWNER=""
            if [ -f "$REGISTRY_FILE" ]; then
              OWNER=$(jq -r --arg ref "$REF" '.[$ref].owner // empty' "$REGISTRY_FILE")
            fi

            # Get metadata from the registry
            REASON=$(jq -r --arg ref "$REF" '.[$ref].reason // "No reason recorded"' "$REGISTRY_FILE" 2>/dev/null || echo "No reason recorded")
            EXPIRES=$(jq -r --arg ref "$REF" '.[$ref].expires // "Not set"' "$REGISTRY_FILE" 2>/dev/null || echo "Not set")
            KIND=$(jq -r --arg ref "$REF" '.[$ref].kind // "unknown"' "$REGISTRY_FILE" 2>/dev/null || echo "unknown")
            TARGET=$(jq -r --arg ref "$REF" '.[$ref].target // "unknown"' "$REGISTRY_FILE" 2>/dev/null || echo "unknown")

            # Build the Issue body
            BODY="## shiori Governance Alert

**Type:** \`${TYPE}\`
**Ref:** \`${REF}\`
**Kind:** \`${KIND}\`
**Target:** \`${TARGET}\`
**Expires:** ${EXPIRES}

### Reason

${REASON}

### Detection

${MESSAGE}

### Resolution

1. Check the details with \`shiori show --ref ${REF}\`
2. Jump to the source location with \`shiori jump --ref ${REF}\`
3. After resolving the problem, stop tracking it with \`shiori resolve --ref ${REF} --apply\`

---
*This issue was automatically created by [shiori governance orchestrator](https://github.com/berlysia/shiori).*"

            if [ "$DRY_RUN" = "true" ]; then
              echo "🔍 Dry run: Would create issue for ${REF}"
              echo "   Title: ${TITLE}"
              echo "   Labels: ${LABELS}"
              echo "   Assignee: ${OWNER:-none}"
              CREATED=$((CREATED + 1))
              continue
            fi

            # Create the Issue (build the assignee as an array to avoid word splitting)
            ASSIGN_ARGS=()
            if [ -n "$OWNER" ]; then
              ASSIGN_ARGS+=(--assignee "$OWNER")
            fi

            gh issue create \
              --title "$TITLE" \
              --body "$BODY" \
              --label "$LABELS" \
              "${ASSIGN_ARGS[@]}" || echo "⚠ Failed to create issue for ${REF} (assignee '${OWNER}' may not be a collaborator)"

            echo "✅ Created issue for ${REF}"
            CREATED=$((CREATED + 1))
          done < <(jq -r '
            .issues[]
            | select(.type == "expired" or .type == "expiring-soon")
            | [.type, .ref, .message] | @tsv
          ' .tmp/shiori-check.json | sort -u -k2,2)

          echo "### Summary" >> "$GITHUB_STEP_SUMMARY"
          echo "- Created: ${CREATED} issues" >> "$GITHUB_STEP_SUMMARY"
          echo "- Skipped (duplicate): ${SKIPPED} issues" >> "$GITHUB_STEP_SUMMARY"

      # Step 3 (Optional): Slack notification
      - name: Slack notification
        if: |
          (steps.check.outputs.expired > 0 || steps.check.outputs.expiring > 0)
          && env.SLACK_WEBHOOK_URL != ''
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
        run: |
          EXPIRED="${{ steps.check.outputs.expired }}"
          EXPIRING="${{ steps.check.outputs.expiring }}"
          THRESHOLD="${{ steps.check.outputs.threshold }}"
          REPO="${{ github.repository }}"
          RUN_URL="${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"

          TEXT=":warning: *shiori Governance Alert* — <${RUN_URL}|Details>\n"
          TEXT+=":red_circle: Expired: ${EXPIRED}\n"
          TEXT+=":large_yellow_circle: Expiring soon (within ${THRESHOLD} days): ${EXPIRING}\n"
          TEXT+="Repository: \`${REPO}\`\n"
          TEXT+="Run \`shiori triage\` for prioritized action list."

          curl -s -X POST "$SLACK_WEBHOOK_URL" \
            -H 'Content-Type: application/json' \
            -d "{\"text\": \"${TEXT}\"}"
```

## Details

### Duplicate Prevention

The duplicate check for Issues uses two conditions:

1. **Label**: The `governance` label is attached
2. **Title search**: The title contains `[shiori] <ref>`

Once an Issue is closed (resolved), the next run creates a new Issue for the same ref. This way, a problem that recurs after being resolved is still detected.

### Automatic Assignee

The value of the registry `owner` field is used directly as the GitHub username:

```json
{
  "SUP-1234": {
    "reason": "vendor prefix fallback",
    "owner": "octocat",
    "expires": "2026-06-01"
  }
}
```

In this case, `octocat` is set as the Issue assignee.

> **Note**: If `owner` is not a collaborator on the repository, setting the assignee fails, but the Issue itself is still created.

### Dry Run

When triggering manually from `workflow_dispatch`, specify `dry_run: true` to only preview without creating Issues. Use this to verify behavior when first adopting the workflow.

## Customization

### Changing the Schedule

```yaml
on:
  schedule:
    - cron: '0 9 * * 1' # Every Monday at 9:00 UTC
    - cron: '0 9 * * 1-5' # Every weekday at 9:00 UTC
    - cron: '0 0 1 * *' # 1st of every month at 0:00 UTC
```

### Changing the Threshold

Adjust the number of days for alerts with `--expiring-threshold`. You can also set `verify.expiringThresholdDays` in config.yaml as the project-wide default.

### Changing the Issue Template

Edit the `BODY` variable in the workflow to customize the format of the Issue body. Markdown can be used as is.

### Enabling Slack Notification

1. Get a Slack Incoming Webhook URL
2. Register it as `SLACK_WEBHOOK_URL` in the repository Secrets
3. The workflow sends the notification automatically (only when the Webhook URL is set)

### Per-Team Routing

Combining the registry `owner` with GitHub CODEOWNERS enables per-team routing:

```json
{
  "FE-001": { "owner": "team-frontend", "expires": "2026-06" },
  "BE-002": { "owner": "team-backend", "expires": "2026-09" }
}
```

To set GitHub Teams as assignees, grant Teams Write permission on the repository in your Organization.

## Troubleshooting

### Issues Are Not Created

1. Check that the `governance` label exists: `gh label list | grep governance`
2. Check the `GITHUB_TOKEN` permissions: `issues: write` is required
3. Verify behavior with a dry run: run from `workflow_dispatch` with `dry_run: true`

### Assignee Is Not Set

- Check that the registry `owner` value matches a repository collaborator name
- For an Organization, use an individual GitHub username, not a Team name
- A failure to set the assignee does not block Issue creation (warning only)

### Duplicate Issues Are Created

- Check that the `governance` label is attached to the Issue
- Check that the `[shiori]` prefix in the Issue title has not been changed
- If the GitHub API search index is delayed, duplicates may rarely occur

## Position in the Governance Maturity Model

| Level | Name          | Mechanism                               | Recipe                                                   |
| ----- | ------------- | --------------------------------------- | -------------------------------------------------------- |
| 0     | Invisible     | Violations hidden by lint disable       | —                                                        |
| 1     | Visible       | Notify diffs via PR comment             | [Delta PR Comment](./github-actions-delta-pr-comment.md) |
| 2     | Enforced      | Block with PR status check              | [Checks Gate](./github-checks-gate.md)                   |
| 3     | Measured      | Badge + trend tracking                  | [Governance Badge](./governance-badge.md)                |
| 4     | **Proactive** | **Automatic Issues on a scheduled run** | **This recipe**                                          |

Level 4 is the state where expiry management is automated and the team can manage technical debt just by receiving alerts passively.

## Related

- [ADR 018: External Service Integration Strategy](../decisions/018-external-service-integration.md)
- [Expires Alert recipe](./github-actions-expires-alert.md) — Simple expires detection + Issue creation
- [GitHub Issue Creation recipe](./github-issue-creation.md) — Script-based Issue creation
- [Slack Notification recipe](./slack-notification.md) — Slack notification only
- [Checks Gate recipe](./github-checks-gate.md) — PR status check
