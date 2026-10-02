# GitHub Actions Step Summary

A recipe that uses `--format github-summary` to display CI results richly in the GitHub Actions Step Summary.

## Overview

By writing directly to `$GITHUB_STEP_SUMMARY` in GitHub Actions, you can show governance information in the summary tab of a workflow run. It is the simplest CI visualization pattern, requiring no artifact downloads or comment posting.

## Supported commands

| Command                                 | Output                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| `shiori verify --format github-summary` | Error/warning counts, breakdown by issue type, collapsible issue detail table |
| `shiori report --format github-summary` | Health score card, metrics overview, insights, breakdown by rule              |
| `shiori health --format github-summary` | Health score card, expiry warnings, trend, prescription table                 |

## Basic pattern

```yaml
- name: Shiori verify summary
  continue-on-error: true
  run: shiori verify --format github-summary >> "$GITHUB_STEP_SUMMARY"
```

`continue-on-error: true` is required. `shiori verify` returns exit 1 when a governance violation is detected, but writing to the Step Summary and the subsequent steps (HTML report generation, artifact upload, etc.) must continue.

## Workflow example

```yaml
# .github/workflows/ci.yml (relevant steps only)
steps:
  - uses: actions/checkout@v7
  - uses: pnpm/action-setup@v6
  - uses: actions/setup-node@v7
    with:
      node-version: '22'
      cache: pnpm
  - run: pnpm install --frozen-lockfile
  - run: pnpm build

  # Governance check (for pass/fail decision)
  - name: shiori check
    run: pnpm shiori check

  # Step Summary: verify result (with error details)
  - name: Verify summary
    continue-on-error: true
    run: pnpm shiori verify --format github-summary >> "$GITHUB_STEP_SUMMARY"

  # Step Summary: health score card
  - name: Health summary
    continue-on-error: true
    run: pnpm shiori health --format github-summary >> "$GITHUB_STEP_SUMMARY"

  # Step Summary: report (with per-rule breakdown)
  - name: Report summary
    continue-on-error: true
    run: pnpm shiori report --format github-summary >> "$GITHUB_STEP_SUMMARY"
```

Appending the output of multiple commands to the same `$GITHUB_STEP_SUMMARY` with `>>` shows them combined on a single Step Summary page.

## Display examples

### verify

```markdown
### ❌ Shiori Verify: 1 error(s), 2 warning(s)

| Metric           | Value |
| ---------------- | ----- |
| Scanned records  | 42    |
| Registry entries | 40    |
| Errors           | 1     |
| Warnings         | 2     |

<details><summary>❌ Errors (1)</summary>

| Ref      | Type      | Location        | Message                          |
| -------- | --------- | --------------- | -------------------------------- |
| SUP-1234 | `expired` | `src/foo.ts:42` | Annotation expired on 2025-01-15 |

</details>
```

### health

```markdown
### 🟢 Shiori Health: 85/100 (healthy)

> 42 tracked annotations, 3 issues remaining

| Metric        | Value |
| ------------- | ----- |
| Issues        | 3     |
| Errors        | 1     |
| Warnings      | 2     |
| Expired       | 1     |
| Expiring soon | 1     |

**Trend:** ↑ improving (+5) over 4 snapshot(s)

<details><summary>💊 Prescriptions (1)</summary>

| Urgency     | Impact | Command         |
| ----------- | ------ | --------------- |
| 🔴 critical | +15pt  | `shiori update` |

</details>
```

## Design points

- **`continue-on-error: true`**: required so that subsequent steps run even when verify/health returns exit 1. The CI pass/fail decision is made by a separate `shiori check` step
- **Append mode (`>>`)**: the output of multiple commands can be combined into one Summary
- **Collapsible sections**: details are folded with `<details>` tags so the Summary does not bloat

## Related

- [Demo CI Step Summary recipe](./demo-ci-step-summary.md) — a demo Step Summary that needs no setup
- [Delta PR Comment recipe](./github-actions-delta-pr-comment.md) — posts delta information as a PR comment
- [Governance Summary recipe](./github-actions-governance-summary.md) — posts a consolidated summary as a PR comment
- [HTML Artifacts Dashboard recipe](./html-artifacts-dashboard.md) — saves HTML reports as artifacts
- [Code Scanning recipe](./code-scanning.md) — inline display in the IDE via SARIF format
