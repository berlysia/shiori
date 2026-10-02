# GitHub Actions: Checks Gate

A recipe that shows the result of `shiori check` as a GitHub PR status check (✅/❌) and blocks merging with branch protection rules.

## Overview

This recipe covers the following:

1. **Run `shiori check` on every PR** to detect governance violations
2. **GitHub Actions automatically detects the exit code** and shows the status in the PR's Checks tab
3. **Make shiori check required in branch protection rules** so PRs with violations cannot be merged

No changes to the core CLI are needed. It uses the existing exit codes of `shiori check` as they are (0 = success, 1 = violations found).

## Governance Maturity Model

This recipe is designed for staged adoption:

| Level | Name         | Mechanism                               | Recipe                                                   |
| ----- | ------------ | --------------------------------------- | -------------------------------------------------------- |
| 0     | Invisible    | Violations hidden by lint disable       | —                                                        |
| 1     | Visible      | Notify diffs via PR comment             | [Delta PR Comment](./github-actions-delta-pr-comment.md) |
| 2     | **Enforced** | **Block merging with PR status check**  | **This recipe**                                          |
| 3     | Measured     | Governance score badge + trend tracking | [Governance Badge](./governance-badge.md)                |

The recommended pattern is to start at Level 1 (notification) and promote to Level 2 (enforcement) as the team becomes familiar with it.

## Prerequisites

- Node.js >= 22.6.0
- `shiori` is added to the project's devDependencies (`pnpm add -D shiori`)
- Use the `pull_request` event as the trigger in GitHub Actions

## Workflow

```yaml
# .github/workflows/shiori-checks-gate.yml
name: shiori governance

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  check:
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

      # shiori check runs scan + verify in one step.
      # If an issue type specified with --fail-on is detected, it returns exit code 1,
      # and GitHub Actions marks this step as failed.
      - name: shiori check
        run: pnpm shiori check --fail-on expired,missing-in-registry
```

With just this, `shiori governance / check` appears in the PR's Checks tab.

## Exit Codes and Statuses

| `shiori check` exit code | GitHub Checks status | Meaning                                       |
| ------------------------ | -------------------- | --------------------------------------------- |
| `0`                      | ✅ Success           | No governance violations                      |
| `1`                      | ❌ Failure           | Violations matching `--fail-on` were detected |

GitHub Actions reflects the step's exit code directly in the Checks status, so no additional API calls are needed.

## Configuring Branch Protection Rules

To make the PR status check a merge requirement:

1. In the repository, go to **Settings → Branches → Branch protection rules**
2. Edit the rule for `main` (or the target branch)
3. Enable **Require status checks to pass before merging**
4. Type `shiori governance / check` in the search box and add it

> **Note**: A status check name has the form `<workflow name> / <job name>`.
> In the example above, the workflow name is `shiori governance` and the job name is `check`,
> so the name is `shiori governance / check`.

## Designing the `--fail-on` Policy

The issue types specified with `--fail-on` let you tune the strictness of governance:

### Staged Adoption Example

```yaml
# Step 1: Minimal policy (block only on expired)
- name: shiori check
  run: pnpm shiori check --fail-on expired

# Step 2: Also block on missing registry entries
- name: shiori check
  run: pnpm shiori check --fail-on expired,missing-in-registry

# Step 3: Strict policy (also block on missing tracking refs)
- name: shiori check
  run: pnpm shiori check --fail-on expired,missing-in-registry,missing-ref

# Step 4: Also show soon-to-expire items as warnings
- name: shiori check
  run: pnpm shiori check --fail-on expired,missing-in-registry --warn-on expiring-soon
```

### Available Issue Types

| Issue Type            | Description                                          |
| --------------------- | ---------------------------------------------------- |
| `expired`             | Annotations past their `expires` date                |
| `expiring-soon`       | Annotations whose `expires` date is approaching      |
| `missing-in-registry` | Present in source but not registered in the registry |
| `unused-in-source`    | Present in the registry but absent from source       |
| `missing-ref`         | No tracking reference (ref) is attached              |
| `duplicate-ref`       | The same ref exists in multiple registries           |
| `invalid-ref`         | The ref does not match the pattern                   |

## Customization

### Using with SARIF Output

You can enable the status check and Code Scanning at the same time:

```yaml
jobs:
  check:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
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

      - name: Generate SARIF
        if: always()
        run: pnpm shiori verify --format sarif --output .tmp/shiori.sarif

      - name: Upload SARIF
        if: always()
        uses: github/codeql-action/upload-sarif@v4
        with:
          sarif_file: .tmp/shiori.sarif
          category: shiori
```

### Using with Delta PR Comment

Combining a status check (blocking) with a PR comment (notification) is the most effective:

```yaml
jobs:
  # Level 2: Block with the status check
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

  # Level 1: Notify the diff via PR comment (runs in parallel)
  pr-delta:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      actions: read
    steps:
      # ... (see the delta-pr-comment recipe)
```

See the [Delta PR Comment recipe](./github-actions-delta-pr-comment.md) for details.

### Auto-Generating with `shiori init --ci`

```bash
pnpm shiori init --ci checks-gate
```

This command automatically generates the workflow YAML above at `.github/workflows/shiori.yml`.

---

## Troubleshooting

### The Status Check Does Not Appear

- It does not appear in the branch protection rule search until the workflow has run at least once. Create a PR first and let the workflow run.

### The Check Does Not Fail Even After Changing `--fail-on`

- Check that annotations of the issue types specified with `--fail-on` actually exist:
  ```bash
  pnpm shiori check --fail-on expired,missing-in-registry -f json | jq '.summary'
  ```

### I Want to Rename the Checks Tab Entry

Change `name` and `jobs.<job_id>` in the workflow YAML:

```yaml
name: annotation governance # ← workflow name
jobs:
  shiori: # ← job name
    # → The Checks tab shows "annotation governance / shiori"
```

---

## Using the Composite Action for Simplicity

A composite action is available that reduces the YAML above to a few lines:

```yaml
- uses: berlysia/shiori/actions/shiori-action@v0.1.1
  with:
    mode: checks-gate
    fail-on: expired,missing-in-registry
```

See the [Composite Action recipe](./github-actions-composite-action.md) for details.

---

## Related

- [ADR 018: External Service Integration Strategy](../decisions/018-external-service-integration.md)
- [Composite Action recipe](./github-actions-composite-action.md)
- [Delta PR Comment recipe](./github-actions-delta-pr-comment.md)
- [Governance Badge recipe](./governance-badge.md)
- [Expires Alert recipe](./github-actions-expires-alert.md)
