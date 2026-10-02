# GitHub Actions: HTML Governance Dashboard (Artifacts)

A recipe for adding a governance dashboard to CI with zero authentication. No PAT, Gist, or GitHub Pages setup is required.

## Overview

This recipe covers the following:

1. **Generate an HTML report in CI**: Generate a self-contained HTML dashboard with `shiori report --format html`
2. **Upload to Artifacts**: Save the HTML file with `actions/upload-artifact`
3. **Show a link in the Job Summary**: Add a path to the dashboard in the CI summary

Features:

- **Zero authentication**: No PAT, Gist, or GitHub Pages setup needed
- **Self-contained HTML**: No external CDN dependencies; viewable offline
- **Dark theme UI**: Visually shows the health score, insights, and breakdowns
- **Interactive**: Includes collapsible sections

## Prerequisites

- Node.js >= 22.6.0
- `shiori` is added to the project's devDependencies

## Setup Steps

### Add the Workflow

```yaml
# .github/workflows/shiori-html-report.yml
name: shiori html report

on:
  push:
    branches: [main]
  # Daily refresh (optional)
  schedule:
    - cron: '0 0 * * *'

jobs:
  report:
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

      - name: Build
        run: pnpm build

      - name: Generate HTML report
        run: npx shiori report --format html --output .tmp/shiori-report.html

      - name: Upload HTML report artifact
        uses: actions/upload-artifact@v7
        with:
          name: shiori-governance-report
          path: .tmp/shiori-report.html
          retention-days: 90
          overwrite: true

      # Add a dashboard link to the Job Summary
      - name: Add dashboard link to summary
        run: |
          echo "## 📊 Shiori Governance Dashboard" >> "$GITHUB_STEP_SUMMARY"
          echo "" >> "$GITHUB_STEP_SUMMARY"
          echo "The HTML report has been uploaded to Artifacts." >> "$GITHUB_STEP_SUMMARY"
          echo "You can download it from the **Artifacts** section of the workflow run page." >> "$GITHUB_STEP_SUMMARY"
```

## Integrating into Existing CI

To add it to an existing CI job instead of a standalone workflow:

```yaml
# Add after the existing CI steps
- name: Generate HTML governance report
  run: npx shiori report --format html --output .tmp/shiori-report.html

- name: Upload governance dashboard
  uses: actions/upload-artifact@v7
  with:
    name: shiori-governance-report
    path: .tmp/shiori-report.html
    retention-days: 90
    overwrite: true
```

## Output

The HTML report contains the following sections:

| Section             | Content                                                             |
| ------------------- | ------------------------------------------------------------------- |
| Health Score        | Governance health score (0–100) and level                           |
| Overview            | Number of annotations, candidates, registry entries, etc.           |
| Insights            | Governance improvement suggestions (error/warning/info)             |
| Issues by Type      | Breakdown by issue type                                             |
| Annotations by Rule | Number of annotations per lint rule                                 |
| Ownership           | Number of annotations per owner                                     |
| Annotation Kinds    | Number of annotations per kind                                      |
| Changes (diff)      | Only when `--diff-base` is specified: added and removed annotations |

## Customization

### Failing CI on verify Errors

```yaml
- name: Generate report and verify
  run: |
    npx shiori report --format html --output .tmp/shiori-report.html
    npx shiori verify --fail-on missing-in-registry,expired
```

### Generating on PRs Too

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
```

In PR workflows, Artifacts are accessible from the PR's Checks tab.

### Generating a Report with a Diff Overlay

Specifying the previous scan result (ScanResult JSON) with the `--diff-base` option adds a diff overlay to the HTML report. Added and removed annotations are shown visually.

```yaml
# .github/workflows/shiori-html-diff-report.yml
name: shiori html diff report

on:
  push:
    branches: [main]

jobs:
  report:
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

      - name: Build
        run: pnpm build

      # Fetch the previous ScanResult from Artifacts
      - name: Download previous scan result
        uses: actions/github-script@v9
        with:
          script: |
            const artifacts = await github.rest.actions.listArtifactsForRepo({
              owner: context.repo.owner,
              repo: context.repo.repo,
              name: 'shiori-scan-result',
              per_page: 1,
            });
            if (artifacts.data.artifacts.length > 0) {
              const artifact = artifacts.data.artifacts[0];
              const download = await github.rest.actions.downloadArtifact({
                owner: context.repo.owner,
                repo: context.repo.repo,
                artifact_id: artifact.id,
                archive_format: 'zip',
              });
              const fs = require('fs');
              fs.writeFileSync('.tmp/shiori-prev-scan.zip', Buffer.from(download.data));
              require('child_process').execSync('unzip -o .tmp/shiori-prev-scan.zip -d .tmp/');
            }

      # Run the current scan
      - name: Scan
        run: npx shiori scan --output .tmp/shiori-scan.json

      # Generate the HTML report with a diff (if the previous ScanResult exists)
      - name: Generate HTML report with diff
        run: |
          if [ -f .tmp/shiori-prev-scan.json ]; then
            npx shiori report --format html --diff-base .tmp/shiori-prev-scan.json --output .tmp/shiori-report.html
          else
            npx shiori report --format html --output .tmp/shiori-report.html
          fi

      # Save the current ScanResult to Artifacts (for the next --diff-base)
      - name: Upload scan result
        uses: actions/upload-artifact@v7
        with:
          name: shiori-scan-result
          path: .tmp/shiori-scan.json
          retention-days: 90
          overwrite: true

      - name: Upload HTML report
        uses: actions/upload-artifact@v7
        with:
          name: shiori-governance-report
          path: .tmp/shiori-report.html
          retention-days: 90
          overwrite: true
```

PR workflows can use the same pattern to compare against the main branch's ScanResult:

```yaml
# For PRs: fetch main's ScanResult and generate a report with a diff
- name: Generate PR diff report
  run: |
    npx shiori scan --output .tmp/shiori-scan.json
    if [ -f .tmp/shiori-prev-scan.json ]; then
      npx shiori report --format html --diff-base .tmp/shiori-prev-scan.json --output .tmp/shiori-report.html
    else
      npx shiori report --format html --output .tmp/shiori-report.html
    fi
```

### Combining with the Badge Recipe

```yaml
- name: Generate reports
  run: |
    npx shiori report --format html --output .tmp/shiori-report.html
    npx shiori report --format badge --output .tmp/shiori-badge.json
```

---

## Related

- [Governance Score Badge recipe](./governance-badge.md)
- [Delta PR Comment recipe](./github-actions-delta-pr-comment.md)
- [GitHub Checks Gate recipe](./github-checks-gate.md)
