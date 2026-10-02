# Governance Observatory: Time-Series Dashboard

A recipe that accumulates the output of `weekly-report --format json` and visualizes technical debt trends on a static GitHub Pages dashboard.

## Overview

This recipe provides:

1. **Weekly JSON snapshot accumulation**: Automatically commits the output of `shiori weekly-report --format json` to the Git repository
2. **Static HTML dashboard**: Reads the accumulated JSON and shows score trends and issue history as SVG charts
3. **Automatic GitHub Pages deployment**: Publishes the dashboard automatically on push

Features:

- **Zero external dependencies**: No CDN such as Chart.js; self-contained HTML + pure SVG charts
- **Dark theme UI**: Design consistent with the existing shiori HTML dashboard
- **Interactive**: Tooltips and collapsible sections
- **Incremental accumulation**: Every snapshot is kept in Git history, so no data is lost

## Prerequisites

- Node.js >= 22.6.0
- `shiori` added to the project's devDependencies
- A registry file exists (`shiori init` has been run)
- GitHub Pages is enabled (Settings → Pages → Source: GitHub Actions)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Scheduled CI Workflow (weekly)                              │
│                                                             │
│  shiori weekly-report --format json                         │
│       ↓                                                     │
│  data/YYYY-MM-DD.json  ← Git commit & push                 │
│       ↓                                                     │
│  data/snapshots.json   ← update manifest                    │
│       ↓                                                     │
│  GitHub Pages deploy   → governance-observatory.html        │
│                           + data/*.json                     │
└─────────────────────────────────────────────────────────────┘
```

## Setup Steps

### Step 1: Place the dashboard files

Create an `observatory/` directory at the repository root and copy the HTML template:

```bash
mkdir -p observatory/data
cp node_modules/@berlysia/shiori/docs/templates/governance-observatory.html observatory/index.html
echo '{"files":[]}' > observatory/data/snapshots.json
```

> **Note**: The template is located at `docs/templates/governance-observatory.html`. Copy it from the npm package, or [get it directly from the repository](https://github.com/berlysia/shiori/blob/main/docs/templates/governance-observatory.html).

### Step 2: Add the GitHub Actions workflow

```yaml
# .github/workflows/shiori-observatory.yml
name: shiori governance observatory

on:
  schedule:
    # Run every Monday at 00:00 UTC
    - cron: '0 0 * * 1'
  workflow_dispatch:

permissions:
  contents: write
  pages: write
  id-token: write

jobs:
  snapshot:
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

      # Step 1: Generate the weekly report JSON
      - name: Generate weekly report snapshot
        run: |
          DATE=$(date -u +%Y-%m-%d)
          npx shiori weekly-report \
            --preset weekly \
            --format json \
            --output "observatory/data/${DATE}.json"

      # Step 2: Update the manifest
      - name: Update snapshots manifest
        run: |
          cd observatory/data
          # List all JSON files in data/ (excluding snapshots.json)
          FILES=$(ls -1 *.json 2>/dev/null | grep -v snapshots.json | sort)
          # Build the JSON array
          echo '{"files":[' > snapshots.json.tmp
          FIRST=true
          for f in $FILES; do
            if [ "$FIRST" = true ]; then
              FIRST=false
            else
              echo ',' >> snapshots.json.tmp
            fi
            echo "\"$f\"" >> snapshots.json.tmp
          done
          echo ']}' >> snapshots.json.tmp
          mv snapshots.json.tmp snapshots.json

      # Step 3: Git commit & push
      - name: Commit snapshot
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add observatory/data/
          git diff --cached --quiet && echo "No changes to commit" && exit 0
          DATE=$(date -u +%Y-%m-%d)
          git commit -m "chore(observatory): add governance snapshot ${DATE}"
          git push

  deploy:
    needs: snapshot
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v7
        with:
          ref: ${{ github.ref }}

      # Check out again to pick up the push from the snapshot job
      - run: git pull --rebase

      - uses: actions/configure-pages@v6

      - uses: actions/upload-pages-artifact@v5
        with:
          path: observatory

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v5
```

### Step 3: Enable GitHub Pages

1. Go to the repository's **Settings** → **Pages**
2. Set **Source** to **GitHub Actions**

### Step 4: Run the first snapshot manually

Trigger the `shiori governance observatory` workflow manually from the Actions tab (`workflow_dispatch`) to generate the initial data.

## Directory Structure

```
observatory/
├── index.html              ← dashboard HTML (copied from the template)
└── data/
    ├── snapshots.json      ← manifest (list of file names)
    ├── 2026-03-17.json     ← weekly snapshot
    ├── 2026-03-24.json
    └── ...
```

## Dashboard Contents

| Section          | Content                                  |
| ---------------- | ---------------------------------------- |
| Latest Score     | Latest health score and level badge      |
| Score Trend      | Score over time (SVG line chart)         |
| Issue Trend      | Trend of issues, annotations, candidates |
| Snapshot History | Table listing all snapshots              |

Charts show tooltips on hover. Click a section heading to collapse or expand it.

## Customization

### Changing the schedule

```yaml
on:
  schedule:
    - cron: '0 0 * * 1' # every Monday (default)
    - cron: '0 0 * * *' # daily
    - cron: '0 0 1 * *' # first day of every month
```

### Changing the preset

```yaml
# Health snapshot over the entire period
- run: npx shiori weekly-report --preset health --format json --output "observatory/data/${DATE}.json"

# Custom period
- run: npx shiori weekly-report --preset custom --since 2026-01-01 --format json --output "observatory/data/${DATE}.json"
```

### Also back up to Artifacts

```yaml
# Add after the Git commit
- uses: actions/upload-artifact@v7
  with:
    name: observatory-snapshot-${{ env.DATE }}
    path: observatory/data/${{ env.DATE }}.json
    retention-days: 365
```

### Show the score in the GitHub Step Summary

```yaml
# Add to the steps of the snapshot job
- name: Add score to summary
  run: |
    SCORE=$(jq '.health.score' "observatory/data/${DATE}.json")
    LEVEL=$(jq -r '.health.level' "observatory/data/${DATE}.json")
    echo "## 📡 Governance Observatory" >> "$GITHUB_STEP_SUMMARY"
    echo "" >> "$GITHUB_STEP_SUMMARY"
    echo "**Score:** ${SCORE}/100 (${LEVEL})" >> "$GITHUB_STEP_SUMMARY"
    echo "" >> "$GITHUB_STEP_SUMMARY"
    echo "[📊 Dashboard](${{ steps.deployment.outputs.page_url || 'TBD' }})" >> "$GITHUB_STEP_SUMMARY"
```

### Use alongside the existing HTML report

```yaml
# Also generate the HTML report
- run: |
    npx shiori weekly-report --preset weekly --format json --output "observatory/data/${DATE}.json"
    npx shiori weekly-report --preset weekly --format html --output "observatory/reports/${DATE}.html"
```

## Local Preview

The dashboard is a set of static files, so you can preview it with any HTTP server:

```bash
# Python
cd observatory && python3 -m http.server 8080

# Node.js (npx)
npx serve observatory

# Open directly (an HTTP server is recommended because fetch does not work)
open observatory/index.html
```

## Snapshot Data Format

Each snapshot is exactly the output of `shiori weekly-report --format json`:

```json
{
  "timestamp": "2026-03-24T00:00:00.000Z",
  "period": { "since": "2026-03-17", "until": "2026-03-24" },
  "activity": {
    "totalOperations": 5,
    "successfulOperations": 5,
    "successRate": 100,
    "netChange": 2,
    "uniqueRefs": ["SUP-1234", "SUP-5678"]
  },
  "health": { "score": 85, "level": "healthy", "summary": "..." },
  "registryOverview": {
    "totalEntries": 12,
    "totalAnnotations": 15,
    "totalCandidates": 3,
    "totalIssues": 2
  },
  "insights": [],
  "velocity": { "count": 0 }
}
```

The dashboard HTML draws its charts from the `health` and `registryOverview` fields.

## Troubleshooting

### The dashboard is empty (No snapshot data found)

1. Check that the `files` array in `observatory/data/snapshots.json` is not empty
2. Check that the JSON files exist in `observatory/data/`
3. Check that you are accessing it through an HTTP server (fetch fails over `file://`)

### It is not deployed to GitHub Pages

1. Check that Settings → Pages → Source is set to "GitHub Actions"
2. Check that the workflow's `permissions` include `pages: write` and `id-token: write`
3. Check that the repository is public, or that you are on a paid plan with GitHub Pages enabled

### Snapshots are duplicated

When the cron schedule and `workflow_dispatch` run on the same day, they generate the same file name (`YYYY-MM-DD.json`), so the file is overwritten. This is intentional.

## Position in the Governance Maturity Model

| Level | Name         | Mechanism                             | Recipe                                                   |
| ----- | ------------ | ------------------------------------- | -------------------------------------------------------- |
| 0     | Invisible    | Violations are hidden by lint disable | —                                                        |
| 1     | Visible      | Diffs are reported in PR comments     | [Delta PR Comment](./github-actions-delta-pr-comment.md) |
| 2     | Enforced     | PR status checks block merges         | [Checks Gate](./github-checks-gate.md)                   |
| 3     | **Measured** | **Trend tracking + dashboard**        | **This recipe**                                          |
| 4     | Proactive    | Scheduled runs create issues          | [Orchestrator](./scheduled-governance-orchestrator.md)   |

Level 3 is the state where the whole team can see whether governance is improving or worsening and manage technical debt in a data-driven way.

---

## Related

- [HTML Artifacts Dashboard](./html-artifacts-dashboard.md) — HTML report for a single snapshot
- [Governance Score Badge](./governance-badge.md) — Show a badge in the README
- [Scheduled Governance Orchestrator](./scheduled-governance-orchestrator.md) — Automatic issue creation
- [GitHub Actions Step Summary](./github-actions-step-summary.md) — Step Summary integration
