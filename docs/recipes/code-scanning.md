# GitHub Code Scanning: Inline shiori Diagnostics in the IDE

A recipe that uploads shiori's SARIF output to GitHub Code Scanning and shows annotation violations inline in VS Code / Codespaces.

## Overview

This recipe provides:

1. **Run `shiori verify --format sarif` in CI** to generate diagnostics in SARIF v2.1.0 format
2. **Upload to GitHub Code Scanning** with `github/codeql-action/upload-sarif`
3. **List alerts** in the **Security → Code scanning alerts** tab
4. **Show inline diagnostics** on the source code in **VS Code / Codespaces**

No new code is needed — it reuses the existing SARIF formatter (`src/formatters/sarif.ts`) as is.

## What Changes for the User

| Before                                         | After                                                 |
| ---------------------------------------------- | ----------------------------------------------------- |
| Run `shiori check` manually in the CLI         | Problems are shown inline on the line in VS Code      |
| Look for the file and line in terminal output  | Jump by clicking in the editor                        |
| The list of problems exists only in CLI output | Filter, search, and manage status in the Security tab |

## Governance Maturity Model

| Level | Name       | Mechanism                             | Recipe                                                   |
| ----- | ---------- | ------------------------------------- | -------------------------------------------------------- |
| 0     | Invisible  | Violations are hidden by lint disable | —                                                        |
| 1     | Visible    | Diffs are reported in PR comments     | [Delta PR Comment](./github-actions-delta-pr-comment.md) |
| 2     | Enforced   | PR status checks block merges         | [Checks Gate](./github-checks-gate.md)                   |
| 3     | Measured   | Governance score badge                | [Governance Badge](./governance-badge.md)                |
| 4     | **Inline** | **Inline diagnostics in the editor**  | **This recipe**                                          |

## Prerequisites

- Node.js >= 22.6.0
- `shiori` added to the project's devDependencies (`pnpm add -D shiori`)
- Code Scanning is enabled on the GitHub repository (free for public repositories; private repositories require a GitHub Advanced Security license)

## Workflow

### Minimal setup

```yaml
# .github/workflows/shiori.yml
name: shiori

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  code-scanning:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write

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

      - name: Generate SARIF
        run: pnpm shiori verify --format sarif --output .tmp/shiori.sarif

      - name: Upload SARIF
        uses: github/codeql-action/upload-sarif@v4
        with:
          sarif_file: .tmp/shiori.sarif
          category: shiori
```

### Auto-generate with `shiori init --ci`

```bash
pnpm shiori init --ci sarif
```

This command generates the workflow YAML above at `.github/workflows/shiori.yml`. It also includes a `check` step, so status checks and Code Scanning are enabled at the same time.

## Required Permissions

```yaml
permissions:
  contents: read # read the repository
  security-events: write # upload SARIF
```

Without `security-events: write`, the `upload-sarif` step fails with a 403.

## SARIF Output Contents

shiori's SARIF formatter emits the following issue types as rules:

| Rule ID                     | Description                                    | Level   |
| --------------------------- | ---------------------------------------------- | ------- |
| `missing-in-registry`       | Present in source but not in the registry      | warning |
| `unused-in-source`          | Present in the registry but absent from source | warning |
| `expired`                   | Annotation past its expiry date                | error   |
| `expiring-soon`             | Annotation close to its expiry date            | warning |
| `syntax-error`              | Annotation syntax error                        | error   |
| `ref-format`                | Invalid ref format                             | error   |
| `ref-collision`             | The same ref exists in multiple registries     | warning |
| `unrouted-ref`              | Ref that matches no routing pattern            | warning |
| `registry-routing-mismatch` | Registry file does not match routing pattern   | warning |
| `ref-status-closed`         | Reference target closed by external status     | warning |

Each rule's `level` (error/warning) follows the severity mapping of `shiori verify`.

## Display in VS Code / Codespaces

Once the SARIF is uploaded, GitHub's Code Scanning feature provides:

1. **Security tab**: All alerts are listed under the repository's Security → Code scanning alerts
2. **PR Files changed**: Inline annotations appear on the relevant lines in the PR diff view
3. **Codespaces**: While working in GitHub Codespaces, diagnostics appear directly in the editor

### Display in local VS Code

To show Code Scanning alerts inline in a local VS Code environment, install the [GitHub Pull Requests extension](https://marketplace.visualstudio.com/items?itemName=GitHub.vscode-pull-request-github) (`GitHub.vscode-pull-request-github`). During PR review, Code Scanning alerts are shown inline in the editor.

## Customization

### Using with Checks Gate (recommended)

Combining a status check (blocking) with Code Scanning (visualization) is the most effective:

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
        with:
          version: latest
      - uses: actions/setup-node@v7
        with:
          node-version: '22'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile

      # Status check (blocking)
      # An exit code of 1 fails GitHub Checks and blocks the merge
      - name: shiori check
        run: pnpm shiori check --fail-on expired,missing-in-registry

      # Code Scanning (visualization)
      # `if: always()` lets the SARIF upload continue even if check fails
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

> **Note**: With `if: always()`, the subsequent SARIF upload runs even if `shiori check` fails with exit code 1. `continue-on-error` is not used, so a check failure is reflected as-is in the GitHub Checks status; the merge is blocked while the violations are still visualized inline.

### Using with the Alert-to-Ref Bridge

You can look up details from a Code Scanning alert with `shiori show`:

```bash
# Show ref information for a given alert number
./docs/recipes/alert-to-ref.sh owner/repo 42
```

See the [Alert-to-Ref Recipe](./alert-to-ref.md) for details.

### Using `category`

The `category` parameter of `upload-sarif` lets you keep results separate from other SARIF tools (such as CodeQL):

```yaml
- uses: github/codeql-action/upload-sarif@v4
  with:
    sarif_file: .tmp/shiori.sarif
    category: shiori # ← can be filtered in the Code Scanning UI
```

---

## Troubleshooting

### SARIF upload fails with a 403

Check that `permissions.security-events: write` is set in the workflow. If GitHub Actions permissions are restricted at the organization level, ask an administrator.

### No alerts are shown

- If the SARIF file is empty (0 issues), no alerts are generated. Check the number of issues with `shiori verify -f json`
- Check that the `Uploaded SARIF` message appears in the `upload-sarif` log
- It may take a few minutes from upload until alerts appear

### Code Scanning is unavailable on a private repository

GitHub Code Scanning requires a [GitHub Advanced Security](https://docs.github.com/en/get-started/learning-about-github/about-github-advanced-security) license on private repositories. As an alternative, the [Checks Gate Recipe](./github-checks-gate.md) lets you enforce governance through PR status checks without Code Scanning.

### Nothing is shown inline in VS Code

In local VS Code (rather than Codespaces), the [GitHub Pull Requests extension](https://marketplace.visualstudio.com/items?itemName=GitHub.vscode-pull-request-github) is required. Alerts are also not shown when the workspace is not linked to a GitHub repository (before cloning, or in a fork target).

---

## Easy Setup with the Composite Action

A composite action is available that reduces the YAML above to a few lines:

```yaml
- uses: berlysia/shiori/actions/shiori-action@v0.1.1
  with:
    mode: sarif
    sarif-category: shiori
```

See the [Composite Action Recipe](./github-actions-composite-action.md) for details.

---

## Related

- [ADR 018: External Service Integration Strategy](../decisions/018-external-service-integration.md)
- [Composite Action Recipe](./github-actions-composite-action.md)
- [Alert-to-Ref Bridge Recipe](./alert-to-ref.md)
- [Checks Gate Recipe](./github-checks-gate.md)
- [Governance Badge Recipe](./governance-badge.md)
- [Delta PR Comment Recipe](./github-actions-delta-pr-comment.md)
