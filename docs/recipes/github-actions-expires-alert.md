# GitHub Actions: Expires Alert

Run `shiori check` on a schedule to detect expiring annotations and create GitHub Issues.

## Workflow

```yaml
# .github/workflows/shiori-expires-alert.yml
name: Shiori Expires Alert

on:
  schedule:
    - cron: '0 9 * * 1' # Every Monday at 9:00 UTC
  workflow_dispatch: # Manual trigger

jobs:
  check-expires:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile

      - name: Check for expiring annotations
        id: shiori
        run: |
          # Run check with expiring-soon as error to fail the step
          pnpm shiori check \
            --fail-on expiring-soon,expired \
            --expiring-threshold 30 \
            -f json \
            -o shiori-result.json || true

          # Extract counts for downstream steps
          EXPIRING=$(jq '.summary.byType["expiring-soon"]' shiori-result.json)
          EXPIRED=$(jq '.summary.byType["expired"]' shiori-result.json)
          echo "expiring=$EXPIRING" >> "$GITHUB_OUTPUT"
          echo "expired=$EXPIRED" >> "$GITHUB_OUTPUT"

      - name: Create issue if expiring annotations found
        if: steps.shiori.outputs.expiring > 0 || steps.shiori.outputs.expired > 0
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          TITLE="Shiori: $(date +%Y-%m-%d) — ${{ steps.shiori.outputs.expired }} expired, ${{ steps.shiori.outputs.expiring }} expiring soon"
          BODY=$(pnpm shiori check \
            --fail-on expiring-soon,expired \
            --expiring-threshold 30 \
            -f markdown 2>/dev/null || true)
          gh issue create --title "$TITLE" --body "$BODY" --label "governance"
```

## Customization

- **Threshold**: Adjust `--expiring-threshold` to change the warning window (default: 14 days)
- **Schedule**: Change the cron expression for different check frequencies
- **Labels**: Add `--label` flags to categorize issues
- **Config**: Set `verify.expiringThresholdDays` in `config.yaml` for a project-wide default
