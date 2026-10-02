# Local Real-Time Governance Dashboard

A recipe that automatically updates the governance dashboard every time you save a file during development. You can check the health score and change diffs in real time in your browser.

## Overview

`shiori watch --dashboard` provides the following:

1. **File watching**: detects changes to source files and scans automatically
2. **HTML dashboard generation**: outputs a self-contained HTML that integrates verify + health + report
3. **Browser auto-reload**: reflects the latest state with a `<meta http-equiv="refresh">` at 3-second intervals
4. **Change diff display**: shows the diff from the previous scan (additions and removals) as an overlay

Features:

- **Zero configuration**: starts with a single command, no external server needed
- **Self-contained HTML**: no CDN dependencies, viewable offline
- **Dark theme UI**: visually shows the health score, insights, and breakdowns
- **Governance Diff Overlay**: shows the increase or decrease in annotations with each file change as badges and a table

## Prerequisites

- Node.js >= 22.6.0
- `shiori` is already added to the project's devDependencies
- A registry file exists (`shiori init` is done)

## Basic usage

### Start the dashboard and open it in the browser

```bash
shiori watch --dashboard --open
```

The browser opens automatically, and the dashboard updates every time you save a file. Stop with `Ctrl+C`.

### Dashboard only (open the browser manually)

```bash
shiori watch --dashboard
```

By default it is written to `.config/shiori/dashboard.html`. Open it directly in a browser.

### Also sync the registry

```bash
shiori watch --dashboard --sync-registry --open
```

When a new annotation is found, an entry is automatically added to the registry.

## Dashboard contents

| Section             | Content                                                                  |
| ------------------- | ------------------------------------------------------------------------ |
| Health Score        | Governance health score (0–100) and level display                        |
| Changes             | Diff from the previous scan (badges and table of additions and removals) |
| Overview            | Number of annotations, candidates, registry entries, etc.                |
| Insights            | Governance improvement suggestions (error/warning/info)                  |
| Issues by Type      | Breakdown by issue type                                                  |
| Annotations by Rule | Number of annotations per lint rule                                      |
| Ownership           | Number of annotations per owner                                          |
| Annotation Kinds    | Number of annotations per kind                                           |

Click a section heading to collapse or expand it.

## Customization

### Change the output path

```bash
shiori watch --dashboard --dashboard-output .tmp/my-dashboard.html --open
```

### Adjust the debounce interval

You can adjust the interval (in milliseconds) for file change detection. The default is 250ms.

```bash
# Use a longer interval if you save frequently
shiori watch --dashboard --debounce-ms 1000 --open
```

### Limit the scan targets

```bash
shiori watch --dashboard --patterns "src/**/*.ts,src/**/*.tsx" --open
```

### One-shot mode for a single generation

To generate once and exit, for CI or scripts:

```bash
shiori watch --once --dashboard --dashboard-output .tmp/report.html
```

## Register as a VSCode task

Add it to `.vscode/tasks.json` to launch it easily from VSCode:

```json
{
  "label": "shiori: live dashboard",
  "type": "shell",
  "command": "npx shiori watch --dashboard --open",
  "isBackground": true,
  "problemMatcher": []
}
```

## Flag reference

| Flag                 | Short | Description                                                   |
| -------------------- | ----- | ------------------------------------------------------------- |
| `--dashboard`        | —     | Enable HTML dashboard generation                              |
| `--dashboard-output` | —     | HTML output path (default: `.config/shiori/dashboard.html`)   |
| `--open`             | —     | Automatically open in the default browser on first generation |
| `--sync-registry`    | —     | Automatically merge scan results into the registry            |
| `--registry`         | `-r`  | Path to the registry file                                     |
| `--patterns`         | `-p`  | Glob patterns to scan (comma-separated)                       |
| `--ignore`           | `-i`  | Exclusion patterns (comma-separated)                          |
| `--debounce-ms`      | —     | Debounce interval (milliseconds, default: 250)                |
| `--once`             | —     | Run once and exit                                             |
| `--cwd`              | —     | Working directory                                             |
| `--config`           | `-c`  | Path to the config directory                                  |

---

## Related

- [HTML Artifacts Dashboard recipe](./html-artifacts-dashboard.md) — save an HTML report to Artifacts in CI
- [Governance Score Badge recipe](./governance-badge.md) — show a badge in the README
- [Delta PR Comment recipe](./github-actions-delta-pr-comment.md) — notify a PR of governance changes
