# GitHub Actions: PR Checks Score Summary

A recipe that embeds the results of `shiori delta` and `shiori health` into the GitHub Checks API `output.summary`, so changes in the governance score are visible directly in the Checks tab of the PR review screen.

## Overview

The [Checks Gate recipe](./github-checks-gate.md) blocks a PR based on the exit code (pass/fail) of `shiori check`, but it does not convey the "direction" of the score. This recipe uses the `output.summary` field of the GitHub Checks API to show a rich summary of the score diff in the PR's Checks tab.

### Checks API `output.summary` vs. `$GITHUB_STEP_SUMMARY`

| Item                | Checks API `output.summary`                              | `$GITHUB_STEP_SUMMARY`                                  |
| ------------------- | -------------------------------------------------------- | ------------------------------------------------------- |
| Where it appears    | **Checks tab** on the PR page → individual check details | **Summary tab of the workflow run**                     |
| API / mechanism     | REST API `POST /repos/{owner}/{repo}/check-runs`         | Just append to a file with `>>`                         |
| Required permission | `checks: write`                                          | None (built into the workflow)                          |
| Cost for reviewers  | Stays within the PR page (1 click)                       | Requires navigating to the workflow run page            |
| Applicable recipe   | **This recipe**                                          | [Step Summary recipe](./github-actions-step-summary.md) |

Use **this recipe (Checks API)** when reviewers want to see score changes within the PR page, and **Step Summary** when CI operators want an overview of workflow results. You can also use both together.

## Prerequisites

- Node.js >= 22.6.0
- `shiori` is already added to the project's devDependencies
- **EP-0167 (ADR 028 schema envelope rollout) is complete** — `shiori delta --format json` and `shiori health --format json` must output the ADR 028 envelope (`meta` + `data` wrapper)
- The [Baseline workflow](./github-actions-delta-pr-comment.md) is set up (for delta)

> **Note if EP-0167 is not complete**: Without the envelope, the top-level JSON structure is different. Read the `jq` paths in the workflow example below with the `data.` prefix removed, for example `.data.summary.added` → `.summary.added` and `.data.health.score` → `.health.score`.

## Required permissions

Because this recipe uses the GitHub Checks API, the workflow needs the **`checks: write`** permission.

```yaml
permissions:
  contents: read
  checks: write # Write to Checks API output.summary
  actions: read # Fetch artifacts across workflows
```

> **Token scope**: Specifying `checks: write` with the default `GITHUB_TOKEN` is sufficient. If you use a fine-grained PAT, grant "Checks" Read and write permission. For fork PRs, you may need to consider the `pull_request_target` event (which requires security care).

## Workflow

```yaml
# .github/workflows/shiori-checks-summary.yml
name: shiori checks summary

on:
  pull_request:
    branches: [main]

jobs:
  checks-summary:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      checks: write
      actions: read

    steps:
      - uses: actions/checkout@v7

      - uses: pnpm/action-setup@v6
        with:
          version: latest

      - uses: actions/setup-node@v7
        with:
          node-version: '22'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

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

      # 2. Scan PR head
      - name: Scan annotations (PR head)
        run: pnpm shiori scan --output .tmp/shiori-head-scan.json

      # 3. Compute delta (JSON format for jq parsing)
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

      # 4. Collect health score
      - name: Health check
        run: pnpm shiori health --format json --output .tmp/shiori-health.json
        continue-on-error: true

      # 5. Build Markdown summary for Checks API output.summary
      - name: Build checks summary
        shell: bash
        run: |
          SUMMARY=""

          # Delta section
          if [ -f .tmp/shiori-delta.json ]; then
            ADDED=$(jq '.data.summary.added // 0' .tmp/shiori-delta.json)
            REMOVED=$(jq '.data.summary.removed // 0' .tmp/shiori-delta.json)
            NET=$(jq '.data.summary.net // 0' .tmp/shiori-delta.json)
            UNCHANGED=$(jq '.data.summary.unchanged // 0' .tmp/shiori-delta.json)

            # Net change indicator
            if [ "$NET" -gt 0 ] 2>/dev/null; then
              NET_DISPLAY="+${NET} :chart_with_upwards_trend:"
            elif [ "$NET" -lt 0 ] 2>/dev/null; then
              NET_DISPLAY="${NET} :chart_with_downwards_trend:"
            else
              NET_DISPLAY="0 :left_right_arrow:"
            fi

            SUMMARY+="## Annotation Delta\n\n"
            SUMMARY+="| Metric | Count |\n"
            SUMMARY+="|--------|-------|\n"
            SUMMARY+="| :heavy_plus_sign: Added | ${ADDED} |\n"
            SUMMARY+="| :heavy_minus_sign: Removed | ${REMOVED} |\n"
            SUMMARY+="| Unchanged | ${UNCHANGED} |\n"
            SUMMARY+="| **Net change** | **${NET_DISPLAY}** |\n\n"
          fi

          # Health section
          if [ -f .tmp/shiori-health.json ]; then
            SCORE=$(jq '.data.health.score // empty' .tmp/shiori-health.json 2>/dev/null || echo "")
            LEVEL=$(jq -r '.data.health.level // empty' .tmp/shiori-health.json 2>/dev/null || echo "")
            HEALTH_SUMMARY=$(jq -r '.data.health.summary // empty' .tmp/shiori-health.json 2>/dev/null || echo "")
            ERRORS=$(jq '.data.issues.errors // 0' .tmp/shiori-health.json 2>/dev/null || echo "0")
            WARNINGS=$(jq '.data.issues.warnings // 0' .tmp/shiori-health.json 2>/dev/null || echo "0")

            if [ -n "$SCORE" ]; then
              # Status emoji based on health level
              case "$LEVEL" in
                healthy)  STATUS_EMOJI=":green_circle:" ;;
                warning)  STATUS_EMOJI=":yellow_circle:" ;;
                critical) STATUS_EMOJI=":red_circle:" ;;
                *)        STATUS_EMOJI=":white_circle:" ;;
              esac

              SUMMARY+="## Health Score\n\n"
              SUMMARY+="${STATUS_EMOJI} **${SCORE}/100** (${LEVEL})\n\n"
              if [ -n "$HEALTH_SUMMARY" ]; then
                SUMMARY+="> ${HEALTH_SUMMARY}\n\n"
              fi
              SUMMARY+="| Metric | Value |\n"
              SUMMARY+="|--------|-------|\n"
              SUMMARY+="| Errors | ${ERRORS} |\n"
              SUMMARY+="| Warnings | ${WARNINGS} |\n\n"
            fi
          fi

          # Fallback if no data
          if [ -z "$SUMMARY" ]; then
            SUMMARY="No governance data available for this PR.\n"
          fi

          # Save summary for next step
          printf '%b' "$SUMMARY" > .tmp/shiori-checks-summary.md

      # 6. Create/update Check Run with output.summary
      - name: Post checks summary
        uses: actions/github-script@v9
        with:
          script: |
            const fs = require('fs');
            const summary = fs.readFileSync('.tmp/shiori-checks-summary.md', 'utf-8');

            // Determine conclusion from delta step outcome
            const deltaOutcome = '${{ steps.delta.outcome }}';
            const conclusion = deltaOutcome === 'failure' ? 'failure' : 'success';

            await github.rest.checks.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              name: 'shiori governance summary',
              head_sha: context.payload.pull_request.head.sha,
              status: 'completed',
              conclusion: conclusion,
              output: {
                title: conclusion === 'success'
                  ? 'Governance check passed'
                  : 'Annotation count exceeded threshold',
                summary: summary,
              },
            });
```

## Example Checks tab display

When you click "shiori governance summary" in the PR's Checks tab, a summary like the following is displayed:

```markdown
## Annotation Delta

| Metric                     | Count                               |
| -------------------------- | ----------------------------------- |
| :heavy_plus_sign: Added    | 1                                   |
| :heavy_minus_sign: Removed | 2                                   |
| Unchanged                  | 13                                  |
| **Net change**             | **-1 :chart_with_downwards_trend:** |

## Health Score

:green_circle: **85/100** (healthy)

> 42 tracked annotations, 3 issues remaining

| Metric   | Value |
| -------- | ----- |
| Errors   | 1     |
| Warnings | 2     |
```

## Position in the governance maturity model

| Level | Name         | Mechanism                                 | Recipe                                                   |
| ----- | ------------ | ----------------------------------------- | -------------------------------------------------------- |
| 0     | Invisible    | Violations are hidden by lint disable     | ---                                                      |
| 1     | Visible      | Notify of the diff via PR comment         | [Delta PR Comment](./github-actions-delta-pr-comment.md) |
| 2     | Enforced     | Block merges with a PR status check       | [Checks Gate](./github-checks-gate.md)                   |
| 2+    | **Informed** | **Show the score diff in the Checks tab** | **This recipe**                                          |
| 3     | Measured     | Governance score badge + trend tracking   | [Governance Badge](./governance-badge.md)                |

This recipe fills the gap between Level 2 (Enforced) and Level 3 (Measured). Used together with Checks Gate, it tells reviewers the direction of the score in addition to pass/fail.

## Customization

### Use together with Checks Gate

This recipe works independently of Checks Gate. By including both in the same workflow, you can provide a blocking decision and a score summary at the same time:

```yaml
jobs:
  # Level 2: pass/fail gate
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: '22'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - name: shiori check
        run: pnpm shiori check --fail-on expired,missing-in-registry

  # Level 2+: score diff summary (runs in parallel)
  checks-summary:
    # ... (see the workflow above)
```

### Use together with Step Summary

To show governance information in both the Checks tab and the workflow Summary:

```yaml
# Shown in Checks API output.summary
- name: Post checks summary
  # ... (the step above)

# Also shown in Step Summary
- name: Health step summary
  continue-on-error: true
  run: pnpm shiori health --format github-summary >> "$GITHUB_STEP_SUMMARY"
```

### Change the `--max-increase` threshold

```yaml
- name: Compute delta
  run: |
    pnpm shiori delta \
      --base .tmp/shiori-base-scan.json \
      --head .tmp/shiori-head-scan.json \
      --format json \
      --base-fallback-empty \
      --max-increase 3 \
      --output .tmp/shiori-delta.json
```

### Change the Check Run name

Change the `name` field inside `actions/github-script`:

```javascript
await github.rest.checks.create({
  // ...
  name: 'annotation governance', // ← any name
  // ...
});
```

If you make this check required in branch protection rules, use the name specified here.

---

## Troubleshooting

### The summary does not appear in the Checks tab

- Check that `permissions.checks: write` is set.
- Check that `head_sha` points to the correct commit SHA. For the `pull_request` event, use `context.payload.pull_request.head.sha`.
- For fork PRs, `GITHUB_TOKEN` may not have `checks: write` permission. Consider using the `pull_request_target` event (which requires security care).

### `jq` path errors

The JSON structure differs depending on whether EP-0167 (ADR 028 envelope rollout) has been applied:

- **With envelope** (after EP-0167): `.data.summary.added`
- **Without envelope** (before EP-0167): `.summary.added`

If `shiori delta --format json | jq '.meta.schemaVersion'` returns `1`, the envelope is present; if it errors, the envelope is absent.

### Baseline not found

See [Troubleshooting in the Delta PR Comment recipe](./github-actions-delta-pr-comment.md#baseline-not-found-first-pr). With `--base-fallback-empty`, it works even for the first PR.

---

## Related

- [Checks Gate recipe](./github-checks-gate.md) --- pass/fail status check
- [Step Summary recipe](./github-actions-step-summary.md) --- output to `$GITHUB_STEP_SUMMARY`
- [Delta PR Comment recipe](./github-actions-delta-pr-comment.md) --- post the diff as a PR comment
- [Governance Summary recipe](./github-actions-governance-summary.md) --- unified governance summary
- [ADR 018: External Service Integration Strategy](../decisions/018-external-service-integration.md)
- [ADR 028: Command Output Schema Versioning](../decisions/028-command-output-schema-versioning.md)
