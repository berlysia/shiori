# GitHub Actions: Delta PR Description

A recipe that automatically embeds a PR's annotation changes and a **triage report (a prioritized technical-debt report)** into the **PR description (body)**.

## Overview

Embedding the governance summary in the PR description itself, rather than in a PR comment, lets reviewers see annotation changes and the technical-debt picture the moment they open the PR.

This recipe does the following:

1. Saves a **baseline scan** (the list of annotations on the `main` branch) as an artifact
2. **Scans the PR branch** and computes the difference from the baseline with `shiori delta --format markdown`
3. Generates a **triage report** with `shiori triage --format markdown` to provide a prioritized action list
4. Automatically updates the `<!-- shiori-delta-start/end -->` and `<!-- shiori-triage-start/end -->` sections in the PR description
5. Fails CI when the net increase in annotations exceeds a threshold (`--max-increase`)

> **Choosing between PR Comment and PR Description**: Embedding in the PR description is for teams that want to always check it in the PR body. If you want to use comment notifications, use the [Delta PR Comment recipe](./github-actions-delta-pr-comment.md).

## Prerequisites

- Node.js >= 22.6.0
- `shiori` is already added to the project's devDependencies (`pnpm add -D shiori`)
- GitHub Actions with the `pull_request` event as the trigger

## Preparing the PR template

Prepare a PR description template that contains the marker comments.
shiori embeds the delta report between `<!-- shiori-delta-start -->` and `<!-- shiori-delta-end -->`, and the triage report between `<!-- shiori-triage-start -->` and `<!-- shiori-triage-end -->`.

```markdown
<!-- .github/pull_request_template.md -->

## Summary

<!-- Describe the PR overview -->

## Test Plan

- [ ] Tests pass

## Governance Summary

<!-- shiori-delta-start -->

_Waiting for CI..._

<!-- shiori-delta-end -->

## Triage Report

<!-- shiori-triage-start -->

_Waiting for CI..._

<!-- shiori-triage-end -->
```

> **Note:** If the marker comments are missing, the workflow appends the sections to the end of the PR description.

## Workflow structure

---

### 1. Baseline scan workflow

Saves the scan result as an artifact when `main` is pushed.
(Shared with the [Delta PR Comment recipe](./github-actions-delta-pr-comment.md). Skip this if it is already set up.)

```yaml
# .github/workflows/shiori-base.yml
name: shiori baseline

on:
  push:
    branches:
      - main

jobs:
  scan-base:
    runs-on: ubuntu-latest
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

      - name: Scan annotations (baseline)
        run: pnpm shiori scan --output .tmp/shiori-base-scan.json

      - name: Upload baseline scan artifact
        uses: actions/upload-artifact@v7
        with:
          name: shiori-base-scan
          path: .tmp/shiori-base-scan.json
          retention-days: 90
          overwrite: true
```

---

### 2. PR description update workflow

Runs a scan on the PR branch, compares it with the baseline, and updates the PR description.

```yaml
# .github/workflows/shiori-pr-description.yml
name: shiori PR description

on:
  pull_request:
    branches:
      - main

jobs:
  delta-description:
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

      # Fetch the baseline artifact.
      # actions/download-artifact@v8 can only fetch artifacts within the same workflow run,
      # so for cross-workflow cases (an artifact saved by a different workflow) we use the GitHub API.
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

      # Scan annotations on the PR branch
      - name: Scan annotations (PR head)
        run: pnpm shiori scan --output .tmp/shiori-head-scan.json

      # Compute the delta and generate a Markdown report
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

      # Generate the triage report
      - name: Generate triage report
        run: |
          pnpm shiori triage \
            --format markdown \
            --output .tmp/shiori-triage.md
        continue-on-error: true

      # Replace the marker sections in the PR description with the delta and triage reports
      - name: Update PR description
        uses: actions/github-script@v9
        with:
          script: |
            const fs = require('fs');

            // Read delta report
            let deltaContent;
            try {
              deltaContent = fs.readFileSync('.tmp/shiori-delta.md', 'utf-8').trim();
            } catch {
              deltaContent = '_No delta report generated._';
            }

            // Read triage report
            let triageContent;
            try {
              triageContent = fs.readFileSync('.tmp/shiori-triage.md', 'utf-8').trim();
            } catch {
              triageContent = '_No triage report generated._';
            }

            // Get current PR description
            const { data: pr } = await github.rest.pulls.get({
              owner: context.repo.owner,
              repo: context.repo.repo,
              pull_number: context.issue.number,
            });
            let body = pr.body || '';

            // Helper: replace content between markers or append section
            function replaceSection(body, startMarker, endMarker, content, heading) {
              const startIdx = body.indexOf(startMarker);
              const endIdx = body.indexOf(endMarker);
              if (startIdx !== -1 && endIdx !== -1) {
                return (
                  body.substring(0, startIdx + startMarker.length) +
                  '\n' + content + '\n' +
                  body.substring(endIdx)
                );
              } else {
                return (
                  body +
                  '\n\n## ' + heading + '\n\n' +
                  startMarker + '\n' +
                  content + '\n' +
                  endMarker
                );
              }
            }

            body = replaceSection(
              body,
              '<!-- shiori-delta-start -->',
              '<!-- shiori-delta-end -->',
              deltaContent,
              'Governance Summary',
            );
            body = replaceSection(
              body,
              '<!-- shiori-triage-start -->',
              '<!-- shiori-triage-end -->',
              triageContent,
              'Triage Report',
            );

            await github.rest.pulls.update({
              owner: context.repo.owner,
              repo: context.repo.repo,
              pull_number: context.issue.number,
              body: body,
            });

      # Fail CI when --max-increase is exceeded
      - name: Fail if annotation count increased
        if: steps.delta.outcome == 'failure'
        run: |
          echo "::error::shiori delta: annotation count exceeded --max-increase threshold"
          exit 1
```

---

## PR description output sample

After CI runs, the Governance Summary section of the PR description is updated as follows:

```markdown
## Governance Summary

<!-- shiori-delta-start -->
<!-- shiori-delta -->

# Annotation Delta Report

## Summary

| Metric    | Count  |
| --------- | ------ |
| Added     | 2      |
| Removed   | 0      |
| Unchanged | 13     |
| **Net**   | **+2** |

## Added

| Ref      | File                    | Line |
| -------- | ----------------------- | ---- |
| SUP-9999 | src/utils/format.ts     | 42   |
| SUP-8888 | src/components/Form.tsx | 17   |

<details><summary>13 unchanged annotation(s)</summary>

| Ref      | File              | Line |
| -------- | ----------------- | ---- |
| SUP-1234 | src/api/client.ts | 8    |

...

</details>
<!-- shiori-delta-end -->

## Triage Report

<!-- shiori-triage-start -->

# Shiori Triage Report

**Generated:** 2025-01-15T10:00:00.000Z

## Summary

| Priority | Count |
| -------- | ----- |
| critical | 1     |
| high     | 1     |
| medium   | 0     |
| low      | 0     |

## Action Items

### 🔴 Critical

| Ref      | Issues  | Owner      | Action                                          |
| -------- | ------- | ---------- | ----------------------------------------------- |
| SUP-1234 | expired | team-infra | shiori resolve --ref SUP-1234 or extend expires |

### 🟡 High

| Ref      | Issues              | Owner | Action        |
| -------- | ------------------- | ----- | ------------- |
| SUP-9999 | missing-in-registry | -     | shiori update |

<!-- shiori-triage-end -->
```

---

## Customization

### Change the annotation increase threshold

```yaml
# Example: allow an increase of up to 3
- name: Compute delta
  run: |
    pnpm shiori delta \
      --base .tmp/shiori-base-scan.json \
      --head .tmp/shiori-head-scan.json \
      --max-increase 3 \
      ...
```

### Also run verify (registry reconciliation)

```yaml
- name: Verify annotations
  run: pnpm shiori verify
  continue-on-error: true
```

### Filter the triage report

```yaml
# Show only technical debt for a specific owner
- name: Generate triage report
  run: |
    pnpm shiori triage \
      --format markdown \
      --owner team-platform \
      --output .tmp/shiori-triage.md

# Show only expired items
- name: Generate triage report
  run: |
    pnpm shiori triage \
      --format markdown \
      --expired-only \
      --output .tmp/shiori-triage.md
```

### Disable the triage section

If you do not need the triage section, remove the triage step from the workflow and remove the `<!-- shiori-triage-start/end -->` markers from the PR template. The delta section works independently.

### Use both PR Comment and PR Description

You can combine both recipes. For example, embed the summary in the PR description and post the details as a PR comment, whichever suits your team.

---

## Complete workflow (single-file version)

A simple setup that puts the baseline scan and the PR description update in one file:

```yaml
# .github/workflows/shiori.yml
name: shiori

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  # Save the baseline when main is pushed
  save-baseline:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: '22'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm shiori scan --output .tmp/shiori-base-scan.json
      - uses: actions/upload-artifact@v7
        with:
          name: shiori-base-scan
          path: .tmp/shiori-base-scan.json
          overwrite: true

  # On PRs, compute the delta and triage and update the PR description
  pr-description:
    if: github.event_name == 'pull_request'
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
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile

      # push and pull_request run as separate workflow runs,
      # so download-artifact cannot fetch it. Use the GitHub API.
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
              w => w.name === 'shiori'
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

      - name: Scan (PR head)
        run: pnpm shiori scan --output .tmp/shiori-head-scan.json

      - name: Delta
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

      - name: Triage
        run: |
          pnpm shiori triage \
            --format markdown \
            --output .tmp/shiori-triage.md
        continue-on-error: true

      - name: Update PR description
        uses: actions/github-script@v9
        with:
          script: |
            const fs = require('fs');
            let deltaContent;
            try {
              deltaContent = fs.readFileSync('.tmp/shiori-delta.md', 'utf-8').trim();
            } catch {
              deltaContent = '_No delta report generated._';
            }
            let triageContent;
            try {
              triageContent = fs.readFileSync('.tmp/shiori-triage.md', 'utf-8').trim();
            } catch {
              triageContent = '_No triage report generated._';
            }
            const { data: pr } = await github.rest.pulls.get({
              owner: context.repo.owner,
              repo: context.repo.repo,
              pull_number: context.issue.number,
            });
            let body = pr.body || '';
            function replaceSection(body, startMarker, endMarker, content, heading) {
              const startIdx = body.indexOf(startMarker);
              const endIdx = body.indexOf(endMarker);
              if (startIdx !== -1 && endIdx !== -1) {
                return (
                  body.substring(0, startIdx + startMarker.length) +
                  '\n' + content + '\n' +
                  body.substring(endIdx)
                );
              } else {
                return (
                  body +
                  '\n\n## ' + heading + '\n\n' +
                  startMarker + '\n' +
                  content + '\n' +
                  endMarker
                );
              }
            }
            body = replaceSection(
              body,
              '<!-- shiori-delta-start -->',
              '<!-- shiori-delta-end -->',
              deltaContent,
              'Governance Summary',
            );
            body = replaceSection(
              body,
              '<!-- shiori-triage-start -->',
              '<!-- shiori-triage-end -->',
              triageContent,
              'Triage Report',
            );
            await github.rest.pulls.update({
              owner: context.repo.owner,
              repo: context.repo.repo,
              pull_number: context.issue.number,
              body: body,
            });

      - name: Fail if increased
        if: steps.delta.outcome == 'failure'
        run: exit 1
```

---

## Troubleshooting

### Baseline not found (first PR)

Even if the artifact-fetch step via the GitHub API fails, `continue-on-error: true` lets processing continue.
Because the `shiori delta --base-fallback-empty` flag treats a missing base file as an empty scan result,
all annotations are shown as "Added" on the first PR.

### Why use the GitHub API instead of `actions/download-artifact`

`actions/download-artifact@v8` can only fetch artifacts **within the same workflow run**.
The baseline scan and the PR delta run in different workflow runs (and even within a single workflow, `push` / `pull_request` are separate runs),
so fetching an artifact across workflows requires using the GitHub REST API via `actions/github-script@v9`.
This approach additionally requires the `actions: read` permission.

### The PR description is not updated

Check that `permissions.pull-requests: write` is set.
For fork PRs, you may need to use the `pull_request_target` event (security considerations apply).

### Markers were deleted manually

If the marker comments (`<!-- shiori-delta-start/end -->` or `<!-- shiori-triage-start/end -->`) are removed from the PR description, the workflow appends new sections to the end.

### CI fails unintentionally because of `--max-increase`

Because `continue-on-error: true` is set on the delta step, the PR description update still succeeds.
The CI failure is controlled by explicitly running `exit 1` in the final step.

---

## Easy setup with the Composite Action

A composite action is available that cuts the YAML above down to a few lines:

```yaml
- uses: berlysia/shiori/actions/shiori-action@v0.1.1
  with:
    mode: pr-description
    max-increase: 0
```

See the [Composite Action recipe](./github-actions-composite-action.md) for details.

---

## Related

- [Delta PR Comment recipe](./github-actions-delta-pr-comment.md) — posts as a PR comment
- [Composite Action recipe](./github-actions-composite-action.md)
- [Governance Badge recipe](./governance-badge.md) — governance score badge
- [ADR 018: External service integration strategy](../decisions/018-external-service-integration.md)
