# GitHub Actions: shiori-action Composite Action

A composite action that runs every shiori CI integration pattern in a single step. Over 70 lines of YAML become a few lines.

## Overview

`shiori-action` is a composite action that provides the following modes:

| Mode             | Description                                     | Example trigger             |
| ---------------- | ----------------------------------------------- | --------------------------- |
| `baseline`       | Save the base branch scan result as an artifact | `push` to main              |
| `pr-comment`     | Post a delta + triage report as a PR comment    | `pull_request`              |
| `pr-description` | Embed delta + triage in the PR description      | `pull_request`              |
| `checks-gate`    | Status check via `shiori check`                 | `push` + `pull_request`     |
| `badge`          | Generate governance badge JSON                  | `push` to main + `schedule` |
| `sarif`          | SARIF output + Code Scanning upload             | `push` + `pull_request`     |

## Quick Start

### Minimal setup (baseline + PR comment)

```yaml
# .github/workflows/shiori.yml
name: shiori

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  baseline:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: '22'
          cache: pnpm
      - run: pnpm install --frozen-lockfile

      - uses: berlysia/shiori/actions/shiori-action@v0.1.1
        with:
          mode: baseline

  pr-comment:
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
          cache: pnpm
      - run: pnpm install --frozen-lockfile

      - uses: berlysia/shiori/actions/shiori-action@v0.1.1
        with:
          mode: pr-comment
          max-increase: 0
```

This reduces what used to be over 70 lines of YAML to effectively two steps.

## Required Permissions

Set `permissions` in the calling workflow according to the mode:

| Mode             | Required permissions                                      |
| ---------------- | --------------------------------------------------------- |
| `baseline`       | `contents: read`                                          |
| `pr-comment`     | `contents: read`, `pull-requests: write`, `actions: read` |
| `pr-description` | `contents: read`, `pull-requests: write`, `actions: read` |
| `checks-gate`    | `contents: read`                                          |
| `badge`          | `contents: read`                                          |
| `sarif`          | `contents: read`, `security-events: write`                |

## Usage by Mode

### baseline: Save the base scan

```yaml
- uses: berlysia/shiori/actions/shiori-action@v0.1.1
  with:
    mode: baseline
```

Runs `pnpm shiori scan` and saves the result as a GitHub Actions artifact. It is used as the baseline for the PR modes (`pr-comment`, `pr-description`).

**Customizable inputs:**

- `baseline-artifact-name`: artifact name (default: `shiori-base-scan`)
- `retention-days`: artifact retention in days (default: `90`)

### pr-comment: Post a PR comment

```yaml
- uses: berlysia/shiori/actions/shiori-action@v0.1.1
  with:
    mode: pr-comment
    max-increase: 0 # forbid a net increase in annotations
    onboarding: true # show the onboarding footer
```

Computes the difference from the baseline and posts a delta report + triage report as a PR comment. If the annotation count exceeds `max-increase`, CI fails.

**Additional inputs:**

- `added-only`: show only added annotations (default: `false`)
- `base-branch`: base branch name (default: `main`)
- `baseline-workflow-name`: baseline workflow name (default: `shiori baseline`)

### pr-description: Update the PR description

```yaml
- uses: berlysia/shiori/actions/shiori-action@v0.1.1
  with:
    mode: pr-description
    max-increase: 0
```

Embeds the report between the `<!-- shiori-delta-start -->` / `<!-- shiori-delta-end -->` markers and between the `<!-- shiori-triage-start -->` / `<!-- shiori-triage-end -->` markers in the PR description. If the markers are absent, the report is appended to the end.

### checks-gate: Status check

```yaml
- uses: berlysia/shiori/actions/shiori-action@v0.1.1
  with:
    mode: checks-gate
    fail-on: expired,missing-in-registry
```

Runs `shiori check` and fails CI if the specified issue types are detected. Combined with branch protection rules, it can block merges.

### badge: Governance badge

```yaml
- uses: berlysia/shiori/actions/shiori-action@v0.1.1
  with:
    mode: badge
    gist-token: ${{ secrets.GIST_TOKEN }}
    gist-id: ${{ vars.SHIORI_BADGE_GIST_ID }}
```

Generates shields.io endpoint JSON and saves it as an artifact. If `gist-token` and `gist-id` are specified, it also uploads to a Gist.

### sarif: Code Scanning

```yaml
- uses: berlysia/shiori/actions/shiori-action@v0.1.1
  with:
    mode: sarif
    sarif-category: shiori
```

Generates diagnostics in SARIF v2.1.0 format and uploads them to GitHub Code Scanning.

## Example Workflow with All Modes

```yaml
name: shiori

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  baseline:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: '22'
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - uses: berlysia/shiori/actions/shiori-action@v0.1.1
        with:
          mode: baseline

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
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - uses: berlysia/shiori/actions/shiori-action@v0.1.1
        with:
          mode: pr-comment
          max-increase: 0

  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: '22'
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - uses: berlysia/shiori/actions/shiori-action@v0.1.1
        with:
          mode: checks-gate

  code-scanning:
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
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - uses: berlysia/shiori/actions/shiori-action@v0.1.1
        with:
          mode: sarif
```

## Choosing Between the Composite Action and Manual YAML Recipes

| Criterion               | Use the Composite Action    | Use manual YAML           |
| ----------------------- | --------------------------- | ------------------------- |
| Customization           | Standard settings suffice   | Custom steps are needed   |
| Workflow                | New setup or replacing one  | Keep the existing YAML    |
| `actions/github-script` | Not needed                  | Custom JS logic is needed |
| Self-hosted runners     | Using GitHub-hosted runners | `gh` CLI is not installed |

The manual YAML recipes remain available:

- [Delta PR Comment](./github-actions-delta-pr-comment.md)
- [Delta PR Description](./github-actions-delta-pr-description.md)
- [Checks Gate](./github-checks-gate.md)
- [Governance Badge](./governance-badge.md)
- [Code Scanning](./code-scanning.md)

## Troubleshooting

### The baseline is not found

On the first PR, no baseline artifact exists, so the download is skipped. `--base-fallback-empty` treats it as an empty base, and all annotations are shown as "Added".

### A new PR comment is posted every time

Existing comments are looked up by the `<!-- shiori-delta -->` marker. Check that the output of `shiori delta --format markdown` contains this marker.

### It does not work on a self-hosted runner

The `gh` CLI may not be preinstalled. Add a step to install the `gh` CLI to the workflow, or use the manual YAML recipes.

### `actions: read` permission error

The `pr-comment` / `pr-description` modes need the `actions: read` permission to fetch cross-workflow artifacts. Check the `permissions` section of your workflow.

---

## Related

- [ADR 018: External Service Integration Strategy](../decisions/018-external-service-integration.md)
- [Delta PR Comment Recipe](./github-actions-delta-pr-comment.md)
- [Delta PR Description Recipe](./github-actions-delta-pr-description.md)
- [Checks Gate Recipe](./github-checks-gate.md)
- [Governance Badge Recipe](./governance-badge.md)
- [Code Scanning Recipe](./code-scanning.md)
- [Governance Summary Recipe](./github-actions-governance-summary.md)
