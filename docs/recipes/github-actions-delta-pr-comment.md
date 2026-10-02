# GitHub Actions: Delta PR Comment

An end-to-end recipe that detects a PR's annotation changes in CI and automatically posts a delta report as a PR comment.

## Overview

This recipe does the following:

1. Saves a **baseline scan** (the list of annotations on the `main` branch) as an artifact
2. **Scans the PR branch** and computes the difference from the baseline with `shiori delta`
3. Posts the delta report in Markdown format as a PR comment (`peter-evans/create-or-update-comment`)
4. Fails CI when the net increase in annotations exceeds a threshold (`--max-increase`)

## Prerequisites

- Node.js >= 22.6.0
- `shiori` is already added to the project's devDependencies (`pnpm add -D shiori`)
- GitHub Actions with the `pull_request` event as the trigger

## Workflow structure

The recipe consists of **two workflow files**.

---

### 1. Baseline scan workflow

Saves the scan result as an artifact when `main` is pushed.

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
          # Retained for 90 days (default). Adjust to fit your team's practice.
          retention-days: 90
          overwrite: true
```

---

### 2. PR comment workflow

Runs a scan on the PR branch, compares it with the baseline, and posts the delta as a PR comment.

````yaml
# .github/workflows/shiori-pr.yml
name: shiori PR delta

on:
  pull_request:
    branches:
      - main

jobs:
  delta-comment:
    runs-on: ubuntu-latest
    # actions: read is required for writing PR comments and for cross-workflow artifact retrieval
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
      # actions/download-artifact@v8 can only fetch artifacts within the same workflow,
      # so for cross-workflow cases (an artifact saved by a different workflow) we use the GitHub API.
      - name: Download baseline scan artifact
        uses: actions/github-script@v9
        with:
          script: |
            const fs = require('fs');

            // Find the latest successful run of the 'shiori baseline' workflow
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

            // Find the artifact of that run
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

            // Download and extract the artifact
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
      # --base-fallback-empty: works even on the first PR, when no base file exists
      # --max-increase 0: forbid a net increase in annotations (change according to your team policy)
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

      # Append an onboarding section (for developers who don't know shiori)
      # Remove this step once the whole team has been onboarded.
      - name: Append onboarding section
        run: |
          cat >> .tmp/shiori-delta.md << 'ONBOARDING'

          ---

          <details>
          <summary>💡 About shiori</summary>

          **shiori** is a governance tool that tracks and manages lint disable comments and technical decisions in source code.

          This comment is posted automatically by `shiori delta`.

          ### Quick start

          ```bash
          # Install
          pnpm add -D shiori

          # Initialize the project (generates the registry + CI templates)
          pnpm shiori init

          # Detect lint disable candidates and start tracking them
          pnpm shiori candidates
          pnpm shiori adopt

          # Verify consistency with the registry
          pnpm shiori check
          ```

          📖 Details: `pnpm shiori docs`

          </details>
          ONBOARDING

      # Post the delta report as a PR comment (overwrites the existing comment)
      - name: Post delta as PR comment
        uses: peter-evans/create-or-update-comment@v5
        with:
          issue-number: ${{ github.event.pull_request.number }}
          body-path: .tmp/shiori-delta.md
          # Marker used to identify and overwrite the existing shiori comment
          comment-author: 'github-actions[bot]'
          body-includes: '<\!-- shiori-delta -->'

      # Fail CI when --max-increase is exceeded
      - name: Fail if annotation count increased
        if: steps.delta.outcome == 'failure'
        run: |
          echo "::error::shiori delta: annotation count exceeded --max-increase threshold"
          exit 1
````

---

## PR comment Markdown output sample

`shiori delta --format markdown` produces output like the following:

```markdown
<\!-- shiori-delta -->

## shiori Annotation Delta

|              | Count |
| ------------ | ----- |
| ➕ Added     | 2     |
| ➖ Removed   | 0     |
| ∆ Net change | +2    |
| Total (head) | 15    |

### ➕ Added (2)

| Ref        | File                      | Line |
| ---------- | ------------------------- | ---- |
| `SUP-9999` | `src/utils/format.ts`     | 42   |
| `SUP-8888` | `src/components/Form.tsx` | 17   |

<details>
<summary>Unchanged (13)</summary>

| Ref        | File                | Line |
| ---------- | ------------------- | ---- |
| `SUP-1234` | `src/api/client.ts` | 8    |

...

</details>
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

### Disable the onboarding section

Once the whole team is proficient with shiori, you can remove the step that appends the onboarding section,
or control it with an environment variable:

```yaml
- name: Append onboarding section
  if: ${{ env.SHIORI_ONBOARDING != 'false' }}
  run: |
    cat >> .tmp/shiori-delta.md << 'ONBOARDING'
    ...
    ONBOARDING
```

See [PR Onboarding Snippet](./pr-onboarding-snippet.md) for details.

### Speed things up with caching

```yaml
# cache: 'pnpm' on actions/setup-node automatically caches the pnpm store
- uses: actions/setup-node@v7
  with:
    node-version: '22'
    cache: 'pnpm'
```

---

## Complete workflow (single-file version)

A simple setup that puts the baseline scan and the PR delta in one file:

````yaml
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

  # On PRs, compute the delta and post a comment
  pr-delta:
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

      - name: Append onboarding section
        run: |
          cat >> .tmp/shiori-delta.md << 'ONBOARDING'

          ---

          <details>
          <summary>💡 About shiori</summary>

          **shiori** is a governance tool that tracks and manages lint disable comments and technical decisions in source code.

          This comment is posted automatically by `shiori delta`.

          ### Quick start

          ```bash
          # Install
          pnpm add -D shiori

          # Initialize the project
          pnpm shiori init

          # Detect lint disable candidates and start tracking them
          pnpm shiori candidates
          pnpm shiori adopt

          # Verify consistency with the registry
          pnpm shiori check
          ```

          📖 Details: `pnpm shiori docs`

          </details>
          ONBOARDING

      - uses: peter-evans/create-or-update-comment@v5
        with:
          issue-number: ${{ github.event.pull_request.number }}
          body-path: .tmp/shiori-delta.md
          comment-author: 'github-actions[bot]'
          body-includes: '<\!-- shiori-delta -->'

      - name: Fail if increased
        if: steps.delta.outcome == 'failure'
        run: exit 1
````

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

### A new PR comment is posted every time

`peter-evans/create-or-update-comment` searches for the comment by the `body-includes` string.
Check that the `<\!-- shiori-delta -->` marker is included in the output.

### CI fails unintentionally because of `--max-increase`

Because `continue-on-error: true` is set on the delta step, posting the comment still succeeds.
The CI failure is controlled by explicitly running `exit 1` in the final step.

---

## Easy setup with the Composite Action

A composite action is available that cuts the YAML above down to a few lines:

```yaml
- uses: berlysia/shiori/actions/shiori-action@v0.1.1
  with:
    mode: pr-comment
    max-increase: 0
```

See the [Composite Action recipe](./github-actions-composite-action.md) for details.

---

## Related

- [ADR 018: External service integration strategy](../decisions/018-external-service-integration.md)
- [Composite Action recipe](./github-actions-composite-action.md)
- [PR Onboarding Snippet](./pr-onboarding-snippet.md)
- [Alert-to-Ref bridge recipe](./alert-to-ref.md)
