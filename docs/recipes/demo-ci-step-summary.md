# Demo CI Step Summary

A recipe that uses `scan --demo --format github-summary` to show a governance demo in the CI Step Summary, even for projects that have not adopted shiori.

## Overview

You can try shiori in CI before setting it up in your project. It uses built-in sample files, so no registry initialization or source code changes are needed.

It works well for introducing the tool to team members and for evaluation before adoption.

## Minimal workflow

```yaml
name: shiori demo
on: [pull_request]

jobs:
  demo:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22

      - name: shiori demo → Step Summary
        run: npx @berlysia/shiori scan --demo --format github-summary >> "$GITHUB_STEP_SUMMARY"
```

With just this, the demo result appears in the PR's Step Summary tab.

## Output formats

| Format                   | Command                               | Use                                  |
| ------------------------ | ------------------------------------- | ------------------------------------ |
| GitHub Summary           | `scan --demo --format github-summary` | Direct Step Summary output           |
| Markdown                 | `scan --demo --format markdown`       | Sharing via Gist, wiki, or documents |
| JSON                     | `scan --demo --format json`           | CI pipelines and programmatic use    |
| Human-readable (default) | `scan --demo`                         | Local terminal display               |

## Practical example: team introduction workflow

An example that runs the demo in CI and saves the result as a Markdown artifact:

```yaml
name: shiori demo report
on:
  workflow_dispatch: # Run manually for evaluation

jobs:
  demo:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22

      # Show in Step Summary
      - name: Demo → Step Summary
        run: npx @berlysia/shiori scan --demo --format github-summary >> "$GITHUB_STEP_SUMMARY"

      # Save the Markdown report as an artifact
      - name: Demo → Markdown report
        run: npx @berlysia/shiori scan --demo --format markdown --output demo-report.md

      - name: Upload demo report
        uses: actions/upload-artifact@v7
        with:
          name: shiori-demo-report
          path: demo-report.md
          retention-days: 30
```

## Moving from the demo to full adoption

Once you have confirmed how it works in the demo, you can adopt it fully in 3 commands:

```bash
pnpm add -D @berlysia/shiori
shiori init --ci basic
shiori check
```

`shiori init --ci basic` automatically generates a production CI workflow (`shiori check` + Step Summary).

## Design points

- **Zero install with `npx`**: no `pnpm add` needed. It can run in CI via `npx`
- **No `continue-on-error` needed**: demo mode always returns exit 0, so no workflow control is required
- **No setup dependencies**: no registry, configuration file, or source code changes are needed

## Related

- [Step Summary recipe](./github-actions-step-summary.md) — production verify/health/report Step Summary
- [Getting Started](../getting-started.md) — a 5-minute setup guide
