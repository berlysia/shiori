# GitHub Actions: Governance Summary PR Comment

A recipe that shows a "governance summary" in a single PR comment, combining not only the delta but also coverage, hygiene, and trend.

## Overview

A delta alone cannot tell you how serious "+1 added" is. One added annotation in a repository with 85% coverage means something entirely different from one added in a repository with 30% coverage.

This recipe combines the following commands to give an overview of the repository's governance in a single PR comment:

1. **`shiori delta`** — Differences in this PR (additions and removals)
2. **`shiori health`** — Governance score (coverage, hygiene)
3. **`shiori trend`** — Score trend over time
4. **`shiori triage`** — Prioritized action list

## Example PR Comment

```markdown
<!-- shiori-governance-summary -->

## 🔖 Governance Summary

### Delta (this PR)

| Metric     | Count |
| ---------- | ----- |
| ➕ Added   | 1     |
| ➖ Removed | 2     |
| ∆ Net      | -1    |

### Health Score

| Metric   | Score  | Status |
| -------- | ------ | ------ |
| Overall  | 82/100 | 🟢     |
| Coverage | 91%    | 🟢     |
| Hygiene  | 73%    | 🟡     |

### Trend (last 5 snapshots)
```

Score: 78 → 80 → 79 → 81 → 82 ▲

```

<details>
<summary>📋 Triage (2 items)</summary>

| Priority | Ref | Issue | Action |
|----------|-----|-------|--------|
| 🔴 critical | SUP-1234 | expired | `shiori resolve --ref SUP-1234` |
| 🟡 high | SUP-9999 | missing-in-registry | `shiori update` |

</details>
```

## Prerequisites

- Node.js >= 22.6.0
- `shiori` added to the project's devDependencies
- The [Baseline workflow](./github-actions-delta-pr-comment.md) is set up (for the delta)
- Health snapshots have been accumulated (for the trend; it works without them)

## Workflow

```yaml
# .github/workflows/shiori-governance-summary.yml
name: shiori governance summary

on:
  pull_request:
    branches: [main]

jobs:
  governance-summary:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      actions: read
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: '22'
          cache: pnpm
      - run: pnpm install --frozen-lockfile

      # 1. Download baseline (same as pr-comment recipe)
      - name: Download baseline scan artifact
        uses: actions/github-script@v9
        with:
          script: |
            const fs = require('fs');
            const workflows = await github.rest.actions.listRepoWorkflows({
              owner: context.repo.owner,
              repo: context.repo.repo,
            });
            const baselineWorkflow = workflows.data.workflows.find(
              w => w.name === 'shiori baseline'
            );
            if (!baselineWorkflow) return;
            const runs = await github.rest.actions.listWorkflowRuns({
              owner: context.repo.owner,
              repo: context.repo.repo,
              workflow_id: baselineWorkflow.id,
              branch: 'main',
              status: 'success',
              per_page: 1,
            });
            if (runs.data.workflow_runs.length === 0) return;
            const artifacts = await github.rest.actions.listWorkflowRunArtifacts({
              owner: context.repo.owner,
              repo: context.repo.repo,
              run_id: runs.data.workflow_runs[0].id,
            });
            const artifact = artifacts.data.artifacts.find(
              a => a.name === 'shiori-base-scan'
            );
            if (!artifact) return;
            const download = await github.rest.actions.downloadArtifact({
              owner: context.repo.owner,
              repo: context.repo.repo,
              artifact_id: artifact.id,
              archive_format: 'zip',
            });
            fs.mkdirSync('.tmp', { recursive: true });
            fs.writeFileSync('.tmp/shiori-base-scan.zip', Buffer.from(download.data));
            require('child_process').execSync('unzip -o .tmp/shiori-base-scan.zip -d .tmp/');
        continue-on-error: true

      # 2. Gather all data
      - name: Scan (PR head)
        run: pnpm shiori scan --output .tmp/shiori-head-scan.json

      - name: Compute delta
        id: delta
        run: |
          pnpm shiori delta \
            --base .tmp/shiori-base-scan.json \
            --head .tmp/shiori-head-scan.json \
            --format json \
            --base-fallback-empty \
            --max-increase 0 \
            --output .tmp/shiori-delta.json
        continue-on-error: true

      - name: Health check
        run: pnpm shiori health --format json --output .tmp/shiori-health.json
        continue-on-error: true

      - name: Trend data
        run: pnpm shiori trend --format json --output .tmp/shiori-trend.json
        continue-on-error: true

      - name: Triage report
        run: pnpm shiori triage --format json --output .tmp/shiori-triage.json
        continue-on-error: true

      # 3. Assemble summary comment
      - name: Build governance summary
        shell: bash
        run: |
          cat > .tmp/shiori-summary.md << 'HEADER'
          <!-- shiori-governance-summary -->

          ## 🔖 Governance Summary

          HEADER

          # Delta section
          if [ -f .tmp/shiori-delta.json ]; then
            ADDED=$(jq '.summary.added // 0' .tmp/shiori-delta.json)
            REMOVED=$(jq '.summary.removed // 0' .tmp/shiori-delta.json)
            NET=$(jq '.summary.net // 0' .tmp/shiori-delta.json)
            cat >> .tmp/shiori-summary.md << EOF
          ### Delta (this PR)

          | Metric | Count |
          |--------|-------|
          | ➕ Added | $ADDED |
          | ➖ Removed | $REMOVED |
          | ∆ Net | $NET |

          EOF
          fi

          # Health section
          if [ -f .tmp/shiori-health.json ]; then
            SCORE=$(jq '.score // "N/A"' .tmp/shiori-health.json)
            COVERAGE=$(jq -r '.coverage // "N/A"' .tmp/shiori-health.json)
            HYGIENE=$(jq -r '.hygiene // "N/A"' .tmp/shiori-health.json)

            # Determine status emoji based on score
            STATUS="🟢"
            if [ "$SCORE" != "N/A" ] && [ "$SCORE" -lt 80 ] 2>/dev/null; then STATUS="🟡"; fi
            if [ "$SCORE" != "N/A" ] && [ "$SCORE" -lt 50 ] 2>/dev/null; then STATUS="🔴"; fi

            cat >> .tmp/shiori-summary.md << EOF
          ### Health Score

          | Metric | Score | Status |
          |--------|-------|--------|
          | Overall | $SCORE/100 | $STATUS |
          | Coverage | $COVERAGE | — |
          | Hygiene | $HYGIENE | — |

          EOF
          fi

          # Trend section
          if [ -f .tmp/shiori-trend.json ]; then
            TREND_LINE=$(jq -r '[.snapshots[].score] | map(tostring) | join(" → ")' .tmp/shiori-trend.json 2>/dev/null || echo "")
            if [ -n "$TREND_LINE" ]; then
              cat >> .tmp/shiori-summary.md << EOF
          ### Trend

          \`\`\`
          Score: $TREND_LINE
          \`\`\`

          EOF
            fi
          fi

          # Triage section (collapsed)
          if [ -f .tmp/shiori-triage.json ]; then
            TRIAGE_COUNT=$(jq '.items | length' .tmp/shiori-triage.json 2>/dev/null || echo "0")
            if [ "$TRIAGE_COUNT" -gt 0 ] 2>/dev/null; then
              echo "<details>" >> .tmp/shiori-summary.md
              echo "<summary>📋 Triage ($TRIAGE_COUNT items)</summary>" >> .tmp/shiori-summary.md
              echo "" >> .tmp/shiori-summary.md
              pnpm shiori triage --format markdown >> .tmp/shiori-summary.md 2>/dev/null || true
              echo "" >> .tmp/shiori-summary.md
              echo "</details>" >> .tmp/shiori-summary.md
            fi
          fi

      # 4. Post comment
      - name: Post governance summary
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          MARKER="<!-- shiori-governance-summary -->"
          REPO="${{ github.repository }}"
          PR="${{ github.event.pull_request.number }}"
          BODY=$(cat .tmp/shiori-summary.md)

          # Find existing comment
          COMMENT_ID=$(gh api "repos/$REPO/issues/$PR/comments" --paginate \
            --jq ".[] | select(.body | contains(\"$MARKER\")) | .id" | head -1 || true)

          if [ -n "$COMMENT_ID" ] && [ "$COMMENT_ID" != "null" ]; then
            gh api "repos/$REPO/issues/comments/$COMMENT_ID" \
              --method PATCH --field body="$BODY" --silent
          else
            gh api "repos/$REPO/issues/$PR/comments" \
              --method POST --field body="$BODY" --silent
          fi

      # 5. Fail gate
      - name: Fail if annotation count increased
        if: steps.delta.outcome == 'failure'
        run: exit 1
```

## Customization

### Omitting the Health / Trend sections

Simply remove the step for a command to hide the corresponding section. Because of `continue-on-error: true`, the workflow continues even if a command fails.

### Combining with the Composite Action

Once the composite action from EP-0088 is released, the recommended setup is to replace the delta + triage part of this recipe with `shiori-action` and add only the health / trend part manually.

```yaml
# delta + triage via the composite action
- uses: berlysia/shiori/actions/shiori-action@v0.1.1
  with:
    mode: pr-comment
    max-increase: 0

# health + trend as additional steps
- run: pnpm shiori health --format json --output .tmp/health.json
- run: pnpm shiori trend --format json --output .tmp/trend.json
```

### Customizing the score thresholds

To change the color-coding criteria for the health score, edit the STATUS determination logic in the "Build governance summary" step.

---

## Related

- [Composite Action Recipe](./github-actions-composite-action.md)
- [Delta PR Comment Recipe](./github-actions-delta-pr-comment.md)
- [ADR 018: External Service Integration Strategy](../decisions/018-external-service-integration.md)
