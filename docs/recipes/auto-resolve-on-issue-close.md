# GitHub Actions: Issue Close → Auto Resolve

A workflow template that automatically runs `shiori resolve --closed` when a GitHub Issue is closed, resolving the annotations. No daemon deployment is needed; it works with GitHub Actions alone.

## Overview

- Triggered by an issue close with `on: issues` + `types: [closed]`
- Runs `shiori scan` → `shiori resolve --closed --apply --yes`
- Writes the result to the Job Summary
- If there are changes, commits and pushes them automatically

## Prerequisites

- Node.js >= 22.6.0
- `shiori` is added to the project's devDependencies
- GitHub Issue numbers are used as refs (e.g. `GH-123`)
- The `contents: write` permission is allowed in the repository's Actions settings

## Workflow

````yaml
# .github/workflows/shiori-auto-resolve.yml
name: shiori auto-resolve on issue close

on:
  issues:
    types: [closed]

permissions:
  contents: write

jobs:
  auto-resolve:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: '22'
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile

      - name: Scan annotations
        run: pnpm shiori scan

      - name: Resolve closed refs
        id: resolve
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          OUTPUT=$(pnpm shiori resolve --closed --apply --yes --format json 2>&1) || true
          echo "$OUTPUT"

          # Extract JSON from stdout (shiori writes status to stderr, JSON to stdout)
          JSON=$(echo "$OUTPUT" | grep -E '^\{' | head -1)
          if [ -n "$JSON" ]; then
            RESOLVED=$(echo "$JSON" | jq -r '.resolvedRefs | length // 0')
            echo "resolved=$RESOLVED" >> "$GITHUB_OUTPUT"
            echo "json=$JSON" >> "$GITHUB_OUTPUT"
          else
            echo "resolved=0" >> "$GITHUB_OUTPUT"
          fi

      - name: Write Job Summary
        if: always()
        run: |
          echo "## shiori auto-resolve" >> "$GITHUB_STEP_SUMMARY"
          echo "" >> "$GITHUB_STEP_SUMMARY"
          if [ "${{ steps.resolve.outputs.resolved }}" -gt 0 ] 2>/dev/null; then
            echo "✅ Resolved ${{ steps.resolve.outputs.resolved }} closed ref(s)" >> "$GITHUB_STEP_SUMMARY"
            echo "" >> "$GITHUB_STEP_SUMMARY"
            echo '```json' >> "$GITHUB_STEP_SUMMARY"
            echo '${{ steps.resolve.outputs.json }}' >> "$GITHUB_STEP_SUMMARY"
            echo '```' >> "$GITHUB_STEP_SUMMARY"
          else
            echo "ℹ️ No annotations matched the closed issue." >> "$GITHUB_STEP_SUMMARY"
          fi

      - name: Commit and push changes
        if: steps.resolve.outputs.resolved > 0
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add -A
          git diff --cached --quiet && exit 0
          git commit -m "chore(shiori): auto-resolve annotations for closed issue #${{ github.event.issue.number }}"
          git push
````

## Flow

1. A GitHub Issue is closed
2. The workflow is triggered and checks out the repository
3. `shiori scan` scans the source code and generates the latest scan-result
4. `shiori resolve --closed --apply --yes --format json` does the following:
   - Uses `GITHUB_TOKEN` to check the Issue status of every ref
   - Removes the annotations corresponding to closed refs from the source
   - Deletes the registry entries
5. Writes the result to the Job Summary
6. If there are changes, commits and pushes them automatically

## Choosing Between This and the daemon

| Aspect          | GitHub Actions (this recipe)                      | shiori-daemon                                       |
| --------------- | ------------------------------------------------- | --------------------------------------------------- |
| Infrastructure  | None needed (provided by GitHub)                  | A long-running process must be deployed             |
| Fit             | Low-to-medium frequency of issue closes           | High-frequency event handling                       |
| Latency         | Tens of seconds to minutes (Actions startup time) | Seconds (the resident process responds immediately) |
| Environment     | GitHub.com / GitHub Enterprise Cloud              | Self-hosted environments are also supported         |
| Complexity      | One YAML file                                     | Server deployment + Webhook setup                   |
| Customizability | Extend by adding workflow steps                   | Extend freely by changing code                      |

**Recommendation**:

- **Start with this recipe (GitHub Actions)** — it can be adopted immediately with no infrastructure
- Consider moving to the daemon if issues are closed frequently and latency becomes a problem

## Customization

### Restricting to Specific Branches

To run only on the default branch:

```yaml
on:
  issues:
    types: [closed]

jobs:
  auto-resolve:
    runs-on: ubuntu-latest
    if: github.event.issue.state_reason != 'not_planned'
```

Excluding issues closed as `not_planned` means only deliberately closed issues are processed.

### Adding a Slack Notification

To notify Slack of the resolve result, combine this with the [Slack Notification recipe](./slack-notification.md):

```yaml
- name: Notify Slack
  if: steps.resolve.outputs.resolved > 0
  env:
    SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
  run: |
    curl -X POST "$SLACK_WEBHOOK_URL" \
      -H 'Content-Type: application/json' \
      -d "{\"text\": \"shiori: Closing issue #${{ github.event.issue.number }} automatically resolved ${{ steps.resolve.outputs.resolved }} annotation(s)\"}"
```

### Making Changes via a PR

To create a PR instead of pushing directly:

```yaml
- name: Create PR for resolved annotations
  if: steps.resolve.outputs.resolved > 0
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: |
    BRANCH="shiori/auto-resolve-${{ github.event.issue.number }}"
    git checkout -b "$BRANCH"
    git add -A
    git diff --cached --quiet && exit 0
    git commit -m "chore(shiori): auto-resolve annotations for closed issue #${{ github.event.issue.number }}"
    git push -u origin "$BRANCH"
    gh pr create \
      --title "chore(shiori): auto-resolve for #${{ github.event.issue.number }}" \
      --body "Automatically resolves the related annotations because issue #${{ github.event.issue.number }} was closed." \
      --label "governance"
```

## Troubleshooting

### "No closed refs found" is shown

- Check that the ref format matches GitHub Issues (e.g. `GH-123`)
- Check that the target ref is included in the `shiori scan` result: `pnpm shiori scan && pnpm shiori show --ref GH-123`
- Check that `GITHUB_TOKEN` is set correctly

### The push fails with a permission error

- Check that the workflow's `permissions` includes `contents: write`
- Select "Read and write permissions" in the repository settings > Actions > General > Workflow permissions

### scan-result freshness error

This occurs when a source file changes after the scan. It does not normally occur if `shiori scan` runs immediately before `resolve` in the workflow. If a concurrent workflow is modifying files at the same time, consider adding the `--force` flag.
