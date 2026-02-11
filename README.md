# lint-ledger

Lint suppression ledger management tool.

## Purpose

`lint-ledger` is a governance layer that recovers "technical exceptions" — lint violations hidden by `disable` comments — from source code, manages them in a ledger, and verifies them in CI.

When developers use `stylelint-disable-next-line` or `eslint-disable-next-line`, those violations disappear from lint results entirely. This tool brings them back under organizational control by:

- Scanning source code for suppression comments
- Requiring each suppression to carry a tracking ID via `waive(<ID>)`
- Verifying IDs against a JSON ledger with reason, ownership, and expiration
- Generating human-readable (Markdown) and machine-readable (JSON) reports

## Why Not a Lint Plugin?

- `disable` comments make violations invisible to lint results. A plugin cannot reliably observe or report suppressed violations.
- Plugins can enforce comment formatting (e.g., requiring an ID), but **ledger reconciliation, expiry detection, and inventory audits** are organizational concerns that bloat a plugin.
- This tool operates as an external CLI that handles extraction, reconciliation, and reporting — complementary to (not replacing) lint rules.

## Architecture: Provider Design

Suppression extraction is abstracted behind a `SuppressionProvider` interface, making the tool independent of any specific lint tool's internals.

```
┌─────────────┐     ┌──────────────────────┐     ┌─────────┐
│ Source Files │────▶│  SuppressionProvider  │────▶│ Records │
└─────────────┘     │  (pluggable)          │     └─────────┘
                    └──────────────────────┘
                              │
                    ┌─────────┼─────────┐
                    ▼         ▼         ▼
             CommentProvider  (future)  (future)
             (disable comments) ESLint   Remote
                              native    ledger
                              suppress.
```

**Current:** `CommentProvider` — line-based text scanning for `stylelint-disable-*` and `eslint-disable-*` comments.

**Future providers** (not yet implemented):
- ESLint native suppressions (`eslint-suppressions.json`)
- External JSON suppressions
- Remote ledger APIs

## Usage

### Comment Convention

Each suppression comment must include `waive(<ID>)`. An `expires=YYYY-MM-DD` is recommended.

**stylelint:**

```css
/* stylelint-disable-next-line plugin/baseline -- waive(SUP-1234) expires=2026-06-01 */
.foo { display: flex; }
```

**ESLint:**

```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- waive(SUP-5678) expires=2026-12-31
const data: any = fetchLegacyAPI();
```

### Ledger Format

A JSON file keyed by suppression ID:

```json
{
  "SUP-1234": {
    "reason": "vendor prefix fallback for older browsers",
    "target": ["iOS Safari < 17.4", "old Android WebView"],
    "expires": "2026-06-01",
    "ticket": "CSS-1234",
    "owner": "team-frontend"
  }
}
```

### Commands

#### `scan` — Extract suppressions from source

```bash
lint-ledger scan \
  --patterns "src/**/*.{css,scss,ts,tsx}" \
  --output scan-result.json
```

Options:
- `--patterns, -p` — Glob patterns (comma-separated). Default: `**/*.{css,scss,pcss,js,ts,tsx,jsx}`
- `--ignore, -i` — Exclude patterns. Default: `**/node_modules/**,**/dist/**,**/.git/**`
- `--output, -o` — Output file (default: stdout)
- `--cwd` — Working directory (default: `process.cwd()`)

#### `verify` — Reconcile scan results with ledger

```bash
lint-ledger verify \
  --scan scan-result.json \
  --ledger ledger.json \
  --fail-on missing-in-ledger,expired \
  --warn-on unused-in-source
```

Detects:
- **missing-in-ledger** — ID in source but not in ledger
- **unused-in-source** — ID in ledger but not in source
- **expired** — Ledger entry past its `expires` date
- **malformed** — Suppression comment without `waive()` ID

Options:
- `--scan, -s` — Path to scan result JSON (required)
- `--ledger, -l` — Path to ledger JSON (required)
- `--fail-on` — Issue types that cause exit code 1 (comma-separated)
- `--warn-on` — Issue types reported as warnings (comma-separated)
- `--format, -f` — Output format: `json` (default) or `markdown`
- `--output, -o` — Output file (default: stdout)

#### `init-ledger` — Generate ledger template

```bash
lint-ledger init-ledger \
  --scan scan-result.json \
  --output ledger.json

# Merge with existing ledger (preserves existing entries)
lint-ledger init-ledger \
  --scan scan-result.json \
  --output ledger.json \
  --merge existing-ledger.json
```

## CI Integration

### GitHub Actions

```yaml
name: Lint Ledger Check
on: [pull_request]

jobs:
  lint-ledger:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci

      - name: Scan lint suppressions
        run: npx lint-ledger scan --output scan-result.json

      - name: Verify against ledger
        run: |
          npx lint-ledger verify \
            --scan scan-result.json \
            --ledger ledger.json \
            --fail-on missing-in-ledger,expired \
            --warn-on unused-in-source

      - name: Generate report
        if: always()
        run: |
          npx lint-ledger verify \
            --scan scan-result.json \
            --ledger ledger.json \
            --format markdown \
            --output report.md \
            --warn-on missing-in-ledger,unused-in-source,expired,malformed
```

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm lint
```

## License

ISC
