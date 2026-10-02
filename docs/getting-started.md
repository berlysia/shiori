# Getting Started — 5 Minutes to Governed Code

A hands-on guide to using shiori to make the lint disable comments in an existing codebase visible and trackable in 5 minutes.

> **How this differs from the README's [Quick Start](../packages/shiori-cli/README.md#quick-start):** The Quick Start is a reference for the shortest path of 3 commands. This guide is a practical walkthrough where you learn "what is happening" at each step by experiencing it.

## Prerequisites

- **Node.js >= 18.0.0** (recommended: 22.x)
- **npm / pnpm / yarn** (any of them)
- **A project containing lint disable comments** (`eslint-disable`, `stylelint-disable`, etc.)

> It works even in a project with no lint disables, but to see the value of this guide, a project with several or more disable comments is recommended.

## Step 0: Try It First (No Setup Required)

Before scanning your own project, you can check how shiori works with a demo:

```bash
npx @berlysia/shiori scan --demo
```

**What happens:** It runs the whole scan → verify → health pipeline on built-in sample files (3 kinds of annotations: ESLint / stylelint / standalone) and shows the result. No installation or project changes are needed.

<details>
<summary>Example output</summary>

```
━━━ shiori scan --demo ━━━━━━━━━━━━━━━━━━━━━

shiori tracks lint disable comments and design decisions in source code
as structured annotations and makes technical debt visible.

This demo lets you try it out using 3 sample files:

── Scan Results ────────────────────────────
Files: 3   Annotations: 3

  DEMO-001   src/api-client.ts:2   no-console   expires=2025-12-31
  DEMO-002   src/theme.css:2   color-named
  DEMO-003   src/config.ts:2

── Verify Issues ───────────────────────────
  ✗ [expired] DEMO-001 — Registry entry expired (2025-12-31)

── Health ──────────────────────────────────
🟡 Score: 67/100 (warning)

── Next Steps ─────────────────────────────
  $ shiori init            # Create a registry in your project
  $ shiori scan            # Scan your actual source code
  $ shiori health          # Check governance health
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

</details>

The 3 annotations shown in the demo cover the main patterns shiori detects:

| Demo ref   | Pattern                         | Meaning                                             |
| ---------- | ------------------------------- | --------------------------------------------------- |
| `DEMO-001` | lint disable + `shiori:` marker | Tracking a rule violation (with an expired example) |
| `DEMO-002` | lint disable + `shiori:` marker | Suppression for compatibility reasons (no expiry)   |
| `DEMO-003` | Standalone `shiori:` comment    | Documenting a design decision                       |

> **Sharing and CI integration:** The demo results can be output in several formats convenient for sharing with your team:
>
> ```bash
> # Markdown — paste into a Gist or Wiki
> npx @berlysia/shiori scan --demo --format markdown
>
> # GitHub Actions Step Summary — show in the CI Summary tab
> npx @berlysia/shiori scan --demo --format github-summary >> "$GITHUB_STEP_SUMMARY"
>
> # JSON — use from programs
> npx @berlysia/shiori scan --demo --format json
> ```
>
> See the [Demo CI Step Summary Recipe](./recipes/demo-ci-step-summary.md) for how to use it in CI.

Once you have seen the demo work, move on to Step 1 and set up your own project.

## Step 1: Install and Initialize

```bash
pnpm add -D @berlysia/shiori    # npm install -D / yarn add -D also work
shiori init
```

**What happens:** A `.config/shiori/` directory is created, and an empty registry file (`registry.json`) and a config file are generated.

<details>
<summary>Example output</summary>

```
✔ Created .config/shiori/config.yaml
✔ Created .config/shiori/registry.json
✔ Updated .gitignore
```

</details>

> **To set up CI at the same time:** `shiori init --ci basic` also generates a GitHub Actions workflow.

## Step 2: Scan the Source Code

```bash
shiori scan
```

**What happens:** It walks all source files in the project and detects lint disable comments and `shiori:` annotations. The result is saved to `.config/shiori/scan-result.json`.

<details>
<summary>Example output</summary>

```
Scanned 142 files
Found 8 annotations, 15 candidates
Saved to .config/shiori/scan-result.json
```

</details>

Two kinds of things are found here:

| Kind           | Description                                                 | Example                                                     |
| -------------- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| **annotation** | Existing annotation with a `shiori:` marker                 | `// eslint-disable-next-line no-console -- shiori: SUP-123` |
| **candidate**  | Lint disable comment without `shiori:` (tracking candidate) | `// eslint-disable-next-line no-console`                    |

## Step 3: Adopt Candidates in Bulk

```bash
shiori adopt --apply
```

**What happens:** It inserts `shiori:` markers into the candidates found in Step 2 (untracked lint disables) and adds entries to the registry. Both the source files and the registry are updated.

<details>
<summary>Example output</summary>

```
Adopted 15 candidates:
  ADOPT-001 → src/utils/legacy.ts:12 (no-explicit-any)
  ADOPT-002 → src/api/client.ts:45 (no-console)
  ...
Updated .config/shiori/registry.json (15 new entries)
```

</details>

> **To preview before applying:** Run `shiori adopt` without `--apply` to see only a preview of the changes (dry-run).
>
> **To choose interactively:** `shiori adopt --wizard` lets you select candidates group by group.

### Check the Registry

If you open `.config/shiori/registry.json` at this point, a stub entry has been generated for each ref:

```json
{
  "ADOPT-001": {
    "reason": "adopted by shiori adopt",
    "target": "src/utils/legacy.ts",
    "kind": "adoption"
  }
}
```

Filling in `reason`, `owner`, and `expires` to fit your project increases the value of governance.

## Step 4: Verify Consistency

```bash
shiori verify
```

**What happens:** It cross-checks the scan result against the registry and detects inconsistencies. Right after Step 3, there should be no problems (0 issues).

<details>
<summary>Example output</summary>

```json
{
  "summary": {
    "annotations": 15,
    "candidates": 0,
    "issues": 0
  }
}
```

</details>

Kinds of inconsistencies detected:

| Issue type            | Meaning                                     |
| --------------------- | ------------------------------------------- |
| `missing-in-registry` | A ref in the source but not in the registry |
| `unused-in-source`    | A ref in the registry but not in the source |
| `expired`             | `expires` has passed                        |
| `expiring-soon`       | Close to expiry (default: within 14 days)   |
| `syntax-error`        | Syntax error in a `shiori:` marker          |

> **For CI, use `shiori check`:** It runs `scan` + `verify` in one go, and `--fail-on` specifies the CI failure conditions:
>
> ```bash
> shiori check --fail-on missing-in-registry,expired
> ```

## Step 5: Health Check

```bash
shiori health
```

**What happens:** It computes a health score (0-100) for the whole registry and shows a summary. The more expired, untracked, or syntax-error entries there are, the lower the score.

<details>
<summary>Example output</summary>

```
Governance Health: 85/100 (healthy)

  Entries: 15 tracked, 0 candidates
  Issues:  0 expired, 0 missing
  Score breakdown:
    - Base:        100
    - Expired:     -0
    - Missing:     -0
    - Candidates:  -15
```

</details>

> **Feed dashboards with JSON output:** `shiori health -f json` returns structured data.

## Done 🎉

By now, the lint disable comments in your project are:

1. **Visible** — `scan` gives you the full count
2. **Tracked** — `adopt` assigns refs and registers them in the registry
3. **Verified** — `verify` / `check` detect inconsistencies
4. **Measured** — `health` turns them into a score

## Next Steps

### CI Integration

```bash
# Generate a GitHub Actions workflow
shiori init --ci basic

# Post a diff comment on PRs
shiori init --ci delta-pr-comment
```

Details: [CI Integration](../packages/shiori-cli/README.md#ci-integration)

### Deepening Governance

| What you want to do                          | Recipe                                                           |
| -------------------------------------------- | ---------------------------------------------------------------- |
| Track over time with weekly snapshots        | [Governance Observatory](./recipes/governance-observatory.md)    |
| Generate improvement suggestions with an LLM | [Governance Coach](./recipes/governance-coach.md)                |
| Show a diff summary on PRs                   | [Delta PR Comment](./recipes/github-actions-delta-pr-comment.md) |
| Set up a check gate in CI                    | [Checks Gate](./recipes/github-checks-gate.md)                   |
| Send notifications to Slack                  | [Slack Notification](./recipes/slack-notification.md)            |

### Enriching the Registry

Flesh out the stub entries generated by adopt:

```json
{
  "ADOPT-001": {
    "reason": "Legacy API returns untyped response; migration planned for Q3",
    "target": "src/utils/legacy.ts",
    "expires": "2026-09-30",
    "ticket": "JIRA-4567",
    "owner": "team-platform",
    "kind": "compat"
  }
}
```

Setting `reason` (why the suppression is needed) and `expires` (when to review it) greatly improves your team's visibility into technical debt.

---

## Related Documents

- [README — Quick Start](../packages/shiori-cli/README.md#quick-start) — Reference for the shortest path of 3 commands
- [Configuration](./configuration.md) — Config file details
- [API Reference](./api.md) — Programmatic API
- [All Recipes](./recipes/) — Collection of integration recipes (28 kinds)
