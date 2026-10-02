# GitHub Actions: Multi-Repo Governance HTML Dashboard

A recipe that aggregates the governance status of multiple repositories into a single HTML dashboard and publishes it automatically as CI Artifacts.

## Overview

This recipe achieves the following:

1. **Run `shiori summary` in each repository**: Output a governance summary as JSON
2. **Aggregate with `shiori aggregate --format html`**: Generate an organization-wide dashboard
3. **Upload to Artifacts**: Viewable without authentication

Features:

- **Zero authentication**: No PAT, Gist, or GitHub Pages setup required
- **Self-contained HTML**: No external CDN dependencies; viewable offline
- **Dark-theme UI**: Score-distribution sparkline, repository comparison table, and worst-repository highlight
- **Interactive**: Collapsible sections
- **CI gate integration**: Score threshold checks are possible with `--fail-on-level`

## Prerequisites

- Node.js >= 22.6.0
- shiori is adopted in each repository
- The CI of each repository outputs JSON with `shiori summary --output`

## Setup Steps

### Step 1: Output the summary JSON in each repository

Run `shiori summary` in each repository's CI and upload the result to Artifacts:

```yaml
# .github/workflows/shiori-summary.yml in each repository
name: shiori summary

on:
  push:
    branches: [main]
  schedule:
    - cron: '0 0 * * *'

jobs:
  summary:
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

      - run: pnpm install --frozen-lockfile
      - run: pnpm build

      - name: Generate summary JSON
        run: npx shiori summary --repository "${{ github.repository }}" --output .tmp/summary.json

      - uses: actions/upload-artifact@v7
        with:
          name: shiori-summary
          path: .tmp/summary.json
          retention-days: 30
          overwrite: true
```

### Step 2: Generate the aggregate dashboard

Create the aggregation workflow in a separate repository (or at the root of a monorepo):

```yaml
# .github/workflows/shiori-aggregate-dashboard.yml
name: shiori aggregate dashboard

on:
  schedule:
    - cron: '0 1 * * *' # Runs after each repository's summary output
  workflow_dispatch:

jobs:
  aggregate:
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

      - run: pnpm install --frozen-lockfile
      - run: pnpm build

      # Download each repository's summary JSON
      - name: Download summary artifacts
        uses: actions/github-script@v9
        with:
          script: |
            const fs = require('fs');
            const repos = ['org/repo-a', 'org/repo-b', 'org/repo-c'];
            fs.mkdirSync('.tmp/summaries', { recursive: true });
            for (const repo of repos) {
              const [owner, name] = repo.split('/');
              try {
                const artifacts = await github.rest.actions.listArtifactsForRepo({
                  owner, repo: name,
                  name: 'shiori-summary',
                  per_page: 1,
                });
                if (artifacts.data.artifacts.length > 0) {
                  const download = await github.rest.actions.downloadArtifact({
                    owner, repo: name,
                    artifact_id: artifacts.data.artifacts[0].id,
                    archive_format: 'zip',
                  });
                  fs.writeFileSync(`.tmp/${name}.zip`, Buffer.from(download.data));
                  require('child_process').execSync(`unzip -o .tmp/${name}.zip -d .tmp/summaries/${name}/`);
                }
              } catch (e) {
                console.warn(`Skipping ${repo}: ${e.message}`);
              }
            }

      # Generate the HTML dashboard
      - name: Generate aggregate HTML dashboard
        run: npx shiori aggregate --files ".tmp/summaries/*/summary.json" --format html -o .tmp/dashboard.html

      - uses: actions/upload-artifact@v7
        with:
          name: shiori-governance-dashboard
          path: .tmp/dashboard.html
          retention-days: 90
          overwrite: true

      - name: Add dashboard link to summary
        run: |
          echo "## 📊 Shiori Organization Governance Dashboard" >> "$GITHUB_STEP_SUMMARY"
          echo "" >> "$GITHUB_STEP_SUMMARY"
          echo "The HTML dashboard has been uploaded to Artifacts." >> "$GITHUB_STEP_SUMMARY"
          echo "You can download it from the **Artifacts** section of the workflow run page." >> "$GITHUB_STEP_SUMMARY"
```

## Using It in a Monorepo

Aggregating multiple packages within a monorepo is simpler:

```yaml
- name: Generate summaries
  run: |
    for pkg in packages/*/; do
      name=$(basename "$pkg")
      npx shiori summary --cwd "$pkg" --repository "$name" --output ".tmp/summaries/${name}.json"
    done

- name: Generate aggregate dashboard
  run: npx shiori aggregate --files ".tmp/summaries/*.json" --format html -o .tmp/dashboard.html
```

## Combining with a CI Gate

You can generate the HTML dashboard and apply a CI gate at the same time:

```yaml
- name: Generate dashboard and enforce quality gate
  run: |
    npx shiori aggregate --files ".tmp/summaries/*.json" --format html -o .tmp/dashboard.html
    npx shiori aggregate --files ".tmp/summaries/*.json" --fail-on-level critical
```

## Output

The HTML dashboard contains the following sections:

| Section              | Content                                                             |
| -------------------- | ------------------------------------------------------------------- |
| Overall Summary Card | Organization-wide average score, repository count, and total issues |
| Worst Repository     | Highlight of the repository with the lowest score                   |
| Score Distribution   | Sparkline of per-repository scores (color-coded by health color)    |
| Repository Table     | Comparison table of all repositories (with score bars)              |

---

## Related

- [HTML Artifacts Dashboard (single-repo)](./html-artifacts-dashboard.md)
- [Governance Summary PR Comment](./github-actions-governance-summary.md)
- [GitHub Checks Gate](./github-checks-gate.md)
