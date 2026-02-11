# shiori

Annotation tracking and governance tool.

## Purpose

`shiori` is a governance layer that recovers structured annotations — lint violations hidden by `disable` comments and other tracked exceptions — from source code, manages them in a registry, and verifies them in CI.

When developers use `stylelint-disable-next-line` or `eslint-disable-next-line`, those violations disappear from lint results entirely. This tool brings them back under organizational control by:

- Scanning source code for `shiori:` annotations (in lint disable comments and standalone)
- Requiring each annotation to carry a tracking reference (e.g. `shiori: SUP-1234`)
- Supporting annotation classification via `kind` field in the registry: `waive`, `design`, `compat`, `risk`, `migrate` (and custom kinds)
- Verifying references against a JSON registry with reason, ownership, and expiration
- Generating human-readable (Markdown) and machine-readable (JSON) reports

## Annotation Syntax

Annotations use the `shiori:` prefix. The first token is the tracking reference (positional ref); additional fields use `key=value` syntax.

```
shiori: <ref> [expires=<date>] [reason=<text>]
shiori:<ref>                    // compact form
```

### Fields

| Field     | Required | Description                                                       |
| --------- | -------- | ----------------------------------------------------------------- |
| ref       | **Yes**  | Tracking reference (positional, e.g. `SUP-1234`, `JIRA:PROJ-123`) |
| `expires` | No       | Expiration date (`YYYY-MM-DD` or `YYYY-MM`)                       |
| `reason`  | No       | Free-text description                                             |

> **Note:** The `kind` field (annotation classification: `waive`, `design`, `compat`, `risk`, `migrate`, etc.) is managed in the registry, not in source comments. See [ADR 004](docs/decisions/004-kind-registry-only.md).

See [ADR 007](docs/decisions/007-positional-ref-syntax.md) for the positional ref syntax rationale.

## Why Not a Lint Plugin?

- `disable` comments make violations invisible to lint results. A plugin cannot reliably observe or report suppressed violations.
- Plugins can enforce comment formatting (e.g., requiring an ID), but **registry reconciliation, expiry detection, and inventory audits** are organizational concerns that bloat a plugin.
- This tool operates as an external CLI that handles extraction, reconciliation, and reporting — complementary to (not replacing) lint rules.

## Architecture: Provider Design

Annotation extraction is abstracted behind an `AnnotationProvider` interface, making the tool independent of any specific lint tool's internals.

```
┌─────────────┐     ┌──────────────────────┐     ┌─────────────────────┐
│ Source Files │────▶│  AnnotationProvider   │────▶│ ShioriAnnotation[]  │
└─────────────┘     │  (pluggable)          │     └─────────────────────┘
                    └──────────────────────┘
                              │
                    ┌─────────┼─────────┐
                    ▼         ▼         ▼
             CommentProvider  (future)  (future)
             (shiori: prefix)  ESLint   Remote
                              native    registry
                              suppress.
```

**Current:** `CommentProvider` — line-based text scanning for `shiori:` annotations in `stylelint-disable-*`, `eslint-disable-*`, and standalone comments.

**Future providers** (not yet implemented):

- ESLint native suppressions (`eslint-suppressions.json`)
- External JSON suppressions
- Remote registry APIs

## Usage

### Comment Convention

Each tracked comment must include a `shiori:` annotation with a tracking reference. Place the annotation after the `--` separator in lint disable comments, or as a standalone comment.

**Lint disable comments (ESLint / stylelint):**

```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- shiori: SUP-5678 expires=2026-12-31
const data: any = fetchLegacyAPI();

// eslint-disable-next-line no-console -- shiori: NOTE-1
console.log('debug output');

// eslint-disable-next-line no-var -- shiori: MIG-1 expires=2026-12-31
var legacy = true;
```

```css
/* stylelint-disable-next-line plugin/baseline -- shiori: SUP-1234 expires=2026-06-01 */
.foo {
  display: flex;
}
```

**Standalone annotations (no lint directive):**

```typescript
// shiori: ADR:0007
// shiori:SUP-1234
```

### Registry Format

A JSON file keyed by annotation ref:

```json
{
  "SUP-1234": {
    "reason": "vendor prefix fallback for older browsers",
    "target": ["iOS Safari < 17.4", "old Android WebView"],
    "expires": "2026-06-01",
    "ticket": "CSS-1234",
    "owner": "team-frontend",
    "kind": "compat"
  }
}
```

### Commands

#### `scan` — Extract annotations from source

```bash
shiori scan \
  --patterns "src/**/*.{css,scss,ts,tsx}" \
  --output scan-result.json
```

Options:

- `--patterns, -p` — Glob patterns (comma-separated). Default: `**/*.{css,scss,pcss,js,ts,tsx,jsx}`
- `--ignore, -i` — Exclude patterns. Default: `**/node_modules/**,**/dist/**,**/.git/**`
- `--output, -o` — Output file (default: stdout)
- `--cwd` — Working directory (default: `process.cwd()`)
- `--provider` — Annotation provider. Default: `comment`

#### `verify` — Reconcile scan results with registry

```bash
shiori verify \
  --scan scan-result.json \
  --registry registry.json \
  --fail-on missing-in-registry,expired \
  --warn-on unused-in-source
```

Detects:

- **missing-in-registry** — ref in source but not in registry
- **unused-in-source** — ref in registry but not in source
- **expired** — Registry entry past its `expires` date
- **malformed** — Annotation without `ref` field

Options:

- `--scan, -s` — Path to scan result JSON (required)
- `--registry, -r` — Path to registry JSON (required)
- `--fail-on` — Issue types that cause exit code 1 (comma-separated)
- `--warn-on` — Issue types reported as warnings (comma-separated)
- `--format, -f` — Output format: `json` (default) or `markdown`
- `--output, -o` — Output file (default: stdout)

#### `init-registry` — Generate registry template

```bash
shiori init-registry \
  --scan scan-result.json \
  --output registry.json

# Merge with existing registry (preserves existing entries)
shiori init-registry \
  --scan scan-result.json \
  --output registry.json \
  --merge existing-registry.json
```

## CI Integration

### GitHub Actions

```yaml
name: Annotation Registry Check
on: [pull_request]

jobs:
  shiori:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci

      - name: Scan annotations
        run: npx shiori scan --output scan-result.json

      - name: Verify against registry
        run: |
          npx shiori verify \
            --scan scan-result.json \
            --registry registry.json \
            --fail-on missing-in-registry,expired \
            --warn-on unused-in-source

      - name: Generate report
        if: always()
        run: |
          npx shiori verify \
            --scan scan-result.json \
            --registry registry.json \
            --format markdown \
            --output report.md \
            --warn-on missing-in-registry,unused-in-source,expired,malformed
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
