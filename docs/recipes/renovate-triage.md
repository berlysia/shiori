# Automatic shiori triage for Renovate/Dependabot PRs

A recipe that automatically runs `shiori triage` on dependency update PRs and notifies, via a PR comment, about annotations that may have become unnecessary due to the library update.

## Overview

Updating a dependency can make a lint disable comment (`eslint-disable`, etc.) that used to be necessary unnecessary.
For example, a warning suppressed to work around a library bug may be resolved by updating to the version that fixes the bug.

This recipe does the following:

1. **Automatically detects Renovate/Dependabot PRs** (by branch name or label)
2. **Computes the annotation increase/decrease** with `shiori delta`
3. **Generates a prioritized action list** with `shiori triage --format markdown`
4. **Posts the result as a PR comment**, prompting a review of annotations during code review

> **No new code is needed.** It is achieved only by combining the existing `shiori delta` and `shiori triage` commands.

## Prerequisites

- Node.js >= 22.6.0
- `shiori` is added to the project's devDependencies (`pnpm add -D shiori`)
- The [base scan upload workflow](./github-actions-delta-pr-comment.md) is set up
- Renovate or Dependabot is configured

## Workflow

```yaml
# .github/workflows/shiori-renovate-triage.yml
name: shiori renovate triage

on:
  pull_request:
    branches:
      - main
    # Typical paths used by Renovate/Dependabot
    paths:
      - 'package.json'
      - 'pnpm-lock.yaml'
      - 'package-lock.json'
      - 'yarn.lock'

jobs:
  triage-comment:
    # Run only for Renovate or Dependabot PRs
    if: |
      startsWith(github.head_ref, 'renovate/') ||
      startsWith(github.head_ref, 'dependabot/') ||
      contains(github.event.pull_request.labels.*.name, 'dependencies')
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
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

      # Fetch the baseline artifact (cross-workflow)
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
            if (!baselineWorkflow) {
              console.log('No baseline workflow found, skipping');
              return;
            }

            const runs = await github.rest.actions.listWorkflowRuns({
              owner: context.repo.owner,
              repo: context.repo.repo,
              workflow_id: baselineWorkflow.id,
              branch: 'main',
              status: 'success',
              per_page: 1,
            });
            if (runs.data.workflow_runs.length === 0) {
              console.log('No successful baseline runs found, skipping');
              return;
            }

            const runId = runs.data.workflow_runs[0].id;

            const artifacts = await github.rest.actions.listWorkflowRunArtifacts({
              owner: context.repo.owner,
              repo: context.repo.repo,
              run_id: runId,
            });
            const artifact = artifacts.data.artifacts.find(
              a => a.name === 'shiori-base-scan'
            );
            if (!artifact) {
              console.log('No baseline scan artifact found, skipping');
              return;
            }

            const download = await github.rest.actions.downloadArtifact({
              owner: context.repo.owner,
              repo: context.repo.repo,
              artifact_id: artifact.id,
              archive_format: 'zip',
            });

            fs.mkdirSync('.tmp', { recursive: true });
            const zipPath = '.tmp/shiori-base-scan.zip';
            fs.writeFileSync(zipPath, Buffer.from(download.data));

            const { execSync } = require('child_process');
            execSync(`unzip -o ${zipPath} -d .tmp/`);
            console.log('Baseline scan artifact downloaded successfully');
        continue-on-error: true

      # Scan annotations on the PR branch (after the dependency update)
      - name: Scan annotations (PR head)
        run: pnpm shiori scan --output .tmp/shiori-head-scan.json

      # Compute the delta
      - name: Compute delta
        run: |
          pnpm shiori delta \
            --base .tmp/shiori-base-scan.json \
            --head .tmp/shiori-head-scan.json \
            --format markdown \
            --base-fallback-empty \
            --output .tmp/shiori-delta.md
        continue-on-error: true

      # Generate the triage report (detect expired and resolvable annotations)
      - name: Generate triage report
        run: |
          pnpm shiori triage \
            --format markdown \
            --output .tmp/shiori-triage.md
        continue-on-error: true

      # Combine delta and triage into the PR comment report
      - name: Compose PR comment
        run: |
          cat > .tmp/shiori-renovate-comment.md << 'HEADER'
          <!-- shiori-renovate-triage -->

          ## 📦 shiori: Annotation review for dependency updates

          This PR includes dependency updates.
          Please check whether any lint disable comments have become unnecessary due to the library updates.

          HEADER

          # Append the delta report
          if [ -f .tmp/shiori-delta.md ]; then
            echo "### Annotation Delta" >> .tmp/shiori-renovate-comment.md
            echo "" >> .tmp/shiori-renovate-comment.md
            cat .tmp/shiori-delta.md >> .tmp/shiori-renovate-comment.md
            echo "" >> .tmp/shiori-renovate-comment.md
          fi

          # Append the triage report
          if [ -f .tmp/shiori-triage.md ]; then
            echo "---" >> .tmp/shiori-renovate-comment.md
            echo "" >> .tmp/shiori-renovate-comment.md
            echo "### Triage Report" >> .tmp/shiori-renovate-comment.md
            echo "" >> .tmp/shiori-renovate-comment.md
            cat .tmp/shiori-triage.md >> .tmp/shiori-renovate-comment.md
            echo "" >> .tmp/shiori-renovate-comment.md
          fi

          # Append the footer
          cat >> .tmp/shiori-renovate-comment.md << 'FOOTER'

          ---

          <details>
          <summary>💡 About this comment</summary>

          This comment is posted automatically on dependency update PRs by `shiori triage`.
          It finds lint disable comments that correspond to problems resolved by library updates
          and notifies you of opportunities to pay down technical debt.

          **Recommended actions:**

          1. Review the Critical / High items in the Triage Report
          2. If any annotations relate to the updated libraries, resolve them with `shiori resolve`
          3. If unsure, check the suppression reason with `shiori why <ref>`

          </details>
          FOOTER

      # Post as a PR comment (overwrite the existing comment)
      - name: Post triage as PR comment
        uses: peter-evans/create-or-update-comment@v5
        with:
          issue-number: ${{ github.event.pull_request.number }}
          body-path: .tmp/shiori-renovate-comment.md
          comment-author: 'github-actions[bot]'
          body-includes: '<!-- shiori-renovate-triage -->'
```

---

## Sample PR Comment Output

After the CI run, a comment like the following is posted on the dependency update PR:

```markdown
<!-- shiori-renovate-triage -->

## 📦 shiori: Annotation review for dependency updates

This PR includes dependency updates.
Please check whether any lint disable comments have become unnecessary due to the library updates.

### Annotation Delta

| Metric    | Count  |
| --------- | ------ |
| Added     | 0      |
| Removed   | 1      |
| Unchanged | 14     |
| **Net**   | **-1** |

### Removed

| Ref      | File              | Line |
| -------- | ----------------- | ---- |
| SUP-5678 | src/api/client.ts | 23   |

---

### Triage Report

| Priority | Count |
| -------- | ----- |
| critical | 1     |
| high     | 0     |
| medium   | 2     |
| low      | 0     |

### 🔴 Critical

| Ref      | Issues  | Owner      | Action                                          |
| -------- | ------- | ---------- | ----------------------------------------------- |
| SUP-1234 | expired | team-infra | shiori resolve --ref SUP-1234 or extend expires |

---

<details>
<summary>💡 About this comment</summary>

This comment is posted automatically on dependency update PRs by `shiori triage`.
...

</details>
```

---

## Customization

### Changing the Target Branch Pattern

To support bots other than Renovate/Dependabot or custom branch names:

```yaml
if: |
  startsWith(github.head_ref, 'renovate/') ||
  startsWith(github.head_ref, 'dependabot/') ||
  startsWith(github.head_ref, 'deps/') ||
  contains(github.event.pull_request.labels.*.name, 'dependencies')
```

### Limiting to Expired Annotations Only

To notify only about annotations directly related to the update:

```yaml
- name: Generate triage report
  run: |
    pnpm shiori triage \
      --format markdown \
      --expired-only \
      --output .tmp/shiori-triage.md
```

### Limiting to a Specific Team's Annotations

```yaml
- name: Generate triage report
  run: |
    pnpm shiori triage \
      --format markdown \
      --owner team-platform \
      --output .tmp/shiori-triage.md
```

### Using an Annotation Increase as a CI Gate

To fail CI when a dependency update increases the number of annotations:

```yaml
- name: Compute delta
  id: delta
  run: |
    pnpm shiori delta \
      --base .tmp/shiori-base-scan.json \
      --head .tmp/shiori-head-scan.json \
      --format markdown \
      --base-fallback-empty \
      --max-increase 0 \
      --output .tmp/shiori-delta.md
  continue-on-error: true

# ... (comment posting step) ...

- name: Fail if annotation count increased
  if: steps.delta.outcome == 'failure'
  run: |
    echo "::error::shiori delta: annotation count exceeded --max-increase threshold"
    exit 1
```

### Coexisting with the Existing Delta PR Comment Workflow

If you have already adopted the [Delta PR Comment recipe](./github-actions-delta-pr-comment.md),
this recipe posts an additional comment with the triage report **only on dependency update PRs**.
Because the comment markers differ (`<!-- shiori-renovate-triage -->` vs `<!-- shiori-delta -->`),
both comments are posted and updated independently.

---

## Troubleshooting

### The Workflow Does Not Run on Renovate PRs

Check that the branch name pattern in the `if` condition matches your Renovate configuration.
Renovate's default branch prefix is `renovate/`, but it may have been changed by custom settings.

Adding label-based detection (`contains(github.event.pull_request.labels.*.name, 'dependencies')`)
also enables detection that does not depend on the branch name.

### Baseline Not Found

This works the same way as in the [Delta PR Comment recipe](./github-actions-delta-pr-comment.md).
With `continue-on-error: true` and `--base-fallback-empty`, all annotations are shown as "Added" on the first run.

### Items Detected by Triage Look Unrelated to the Dependency Update

`shiori triage` triages the annotations of the whole project.
To narrow it down to annotations directly related to the dependency update, consider using the `--expired-only` filter.

If an option such as `shiori triage --changed-files` is added in the future,
triage limited to the changed files will become possible.

---

## Related

- [Delta PR Comment recipe](./github-actions-delta-pr-comment.md) — Delta comment on all PRs
- [Delta PR Description recipe](./github-actions-delta-pr-description.md) — Embedding in the PR Description
- [Expires Alert recipe](./github-actions-expires-alert.md) — Periodic expiry notification
- [ADR 018: External Service Integration Strategy](../decisions/018-external-service-integration.md)
