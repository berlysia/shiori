# shiori

Annotation tracking and governance tool.

## Purpose

`shiori` is a governance layer that recovers structured annotations — lint violations hidden by `disable` comments and other tracked exceptions — from source code, manages them in a registry, and verifies them in CI.

When developers use `stylelint-disable-next-line` or `eslint-disable-next-line`, those violations disappear from lint results entirely. This tool brings them back under organizational control by:

- Scanning source code for `shiori:` annotations (in lint disable comments and standalone)
- Requiring each annotation to carry a tracking reference (e.g. `shiori: SUP-1234`)
- Supporting annotation classification via `kind` field in the registry: `waive`, `design`, `compat`, `risk`, `migrate` (and custom kinds)
- Verifying references against a JSON or YAML registry with reason, ownership, and expiration
- Generating human-readable (Markdown) and machine-readable (JSON, SARIF, JSONL) reports

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

## Quick Start

```bash
# 1. Install
pnpm add -D @berlysia/shiori

# 2. Initialize (scans source, creates registry)
shiori init

# 3. Review and fill in registry entries
#    Edit .config/shiori/registry.json — add reason, owner, expires

# 4. Check annotations against registry
shiori check

# 5. Fix issues
shiori update          # adds missing refs to registry
shiori check           # re-verify

# 6. Add to CI
shiori check --fail-on missing-in-registry,expired
```

Workflow: `init` → `check` → `update` → `check` → CI

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

A JSON or YAML file keyed by annotation ref (format auto-detected by file extension):

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

#### `init` — Initialize shiori in a project

```bash
shiori init
shiori init --registry custom-registry.yaml
shiori init -p "src/**/*.ts"
```

Scans source files, creates a config directory, generates a registry template, and updates `.gitignore`. Run once to set up shiori in your project.

#### `check` — Scan and verify in one step

```bash
shiori check
shiori check --fail-on missing-in-registry,expired
shiori check --save-scan
shiori check -f markdown -o report.md
```

One-shot command that scans source and verifies against the registry. Recommended for both development and CI.

Options:

- `--patterns, -p` — Glob patterns (comma-separated)
- `--ignore, -i` — Exclude patterns (comma-separated)
- `--registry, -r` — Path to registry file (auto-detected from config)
- `--fail-on` — Issue types that cause exit code 1 (comma-separated)
- `--warn-on` — Issue types reported as warnings (comma-separated)
- `--format, -f` — Output format: `json` (default), `markdown`, `sarif`, `summary`, `jsonl`
- `--output, -o` — Output file (default: stdout)
- `--save-scan` — Also save scan result to `.config/shiori/scan-result.json`
- `--cwd` — Working directory (default: `process.cwd()`)
- `--config, -c` — Path to config directory

#### `update` — Add new refs to the registry

```bash
shiori update
shiori update --registry custom-registry.yaml
shiori update --dry-run
```

Scans source and adds any new refs to the registry as stub entries. Fill in reason, owner, and expires after running.

Options:

- `--scan, -s` — Path to scan result JSON (default: auto-detect or stdin)
- `--registry, -r` — Path to registry file (auto-detected from config)
- `--dry-run, -n` — Preview changes without writing to registry
- `--cwd` — Working directory (default: `process.cwd()`)
- `--config, -c` — Path to config directory

#### `scan` — Extract annotations from source

```bash
shiori scan \
  --patterns "src/**/*.{css,scss,ts,tsx}" \
  --output scan-result.json
```

Options:

- `--patterns, -p` — Glob patterns (comma-separated). Default: `**/*.{css,scss,pcss,js,ts,tsx,jsx}`
- `--ignore, -i` — Exclude patterns. Default: `**/node_modules/**,**/dist/**,**/.git/**,**/tests/**,**/test/**,**/__tests__/**,**/*.test.*,**/*.spec.*,**/.config/**` (see [ADR 015](docs/decisions/015-scan-false-positive-prevention.md))
- `--output, -o` — Output file (default: auto-save to `.config/shiori/scan-result.json` when TTY, stdout when piped)
- `--cwd` — Working directory (default: `process.cwd()`)
- `--config, -c` — Path to config directory (YAML/JSON auto-detected). Default: `<cwd>/.config/shiori`
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
- **syntax-error** — Annotation with `shiori:` marker but invalid syntax
- **ref-format** — Annotation ref has invalid format
- **ref-collision** — Ref defined in multiple registry files
- **unrouted-ref** — Annotation ref does not match any configured routing pattern
- **registry-routing-mismatch** — Registry entry in a file that does not match its routing pattern

Options:

- `--scan, -s` — Path to scan result JSON (default: `.config/shiori/scan-result.json` or stdin)
- `--registry, -r` — Path to registry file (auto-detected from config)
- `--fail-on` — Issue types that cause exit code 1 (comma-separated)
- `--warn-on` — Issue types reported as warnings (comma-separated)
- `--format, -f` — Output format: `json` (default), `markdown`, `sarif`, `summary`, `jsonl`
- `--output, -o` — Output file (default: stdout)
- `--cwd` — Working directory (default: `process.cwd()`)
- `--config, -c` — Path to config directory

#### `draft` — List draft annotations

```bash
shiori draft \
  --scan scan-result.json \
  --output drafts.json
```

Lists annotations that have a `shiori:` marker but no ref (intentional drafts awaiting a tracking reference).

Options:

- `--scan, -s` — Path to scan result JSON (default: auto-detect or stdin)
- `--output, -o` — Output file (default: stdout)
- `--cwd` — Working directory (default: `process.cwd()`)
- `--config, -c` — Path to config directory

#### `candidates` — List candidate annotations

```bash
shiori candidates \
  --scan scan-result.json \
  --format markdown \
  --output candidates.md
```

Lists lint disable comments and other patterns detected as potential shiori management candidates (no `shiori:` marker).

Options:

- `--scan, -s` — Path to scan result JSON (default: auto-detect or stdin)
- `--format, -f` — Output format: `json` (default) or `markdown`
- `--output, -o` — Output file (default: stdout)
- `--cwd` — Working directory (default: `process.cwd()`)
- `--config, -c` — Path to config directory

#### `show` — Show information about a specific ref

```bash
shiori show --ref JIRA-123
shiori show --ref SUP-1234 -s scan-result.json -r registry.json
```

Looks up a ref and displays its registry entry, source locations, and resolved URL (if namespace is configured). Exit code `0` if found, `1` if not found.

Options:

- `--ref` — The ref to look up (required)
- `--scan, -s` — Path to scan result JSON (default: auto-detect or stdin)
- `--registry, -r` — Path to registry file (auto-detected from config)
- `--cwd` — Working directory (default: `process.cwd()`)
- `--config, -c` — Path to config directory

#### `jump` — Resolve ref to source location

```bash
shiori jump --ref SUP-1234
shiori jump --ref SUP-1234 --all
```

Prints `file:line` output for terminal-based jump workflows (`less +{line} {file}` etc.). Exit code `0` if found, `1` if not found.

Options:

- `--ref` — The ref to resolve (required)
- `--all` — Print all matching locations (default: first only)
- `--scan, -s` — Path to scan result JSON (default: auto-detect or stdin)
- `--cwd` — Working directory (default: `process.cwd()`)
- `--config, -c` — Path to config directory

#### `watch` — Refresh scan result on save

```bash
shiori watch
shiori watch --sync-registry
shiori watch --once
```

Watches files and refreshes `.config/shiori/scan-result.json` whenever files are saved. With `--sync-registry`, it also merges newly found refs into the registry.

Options:

- `--patterns, -p` — Glob patterns (comma-separated)
- `--ignore, -i` — Exclude patterns (comma-separated)
- `--once` — Run one refresh and exit (for scripts/CI)
- `--sync-registry` — Also merge refs into registry on each refresh
- `--registry, -r` — Registry path override (used with `--sync-registry`)
- `--output, -o` — Scan-result output path override
- `--debounce-ms` — Debounce interval (default: `250`)
- `--cwd` — Working directory (default: `process.cwd()`)
- `--config, -c` — Path to config directory

#### `docs` — Show documentation

```bash
shiori docs
```

Displays the full README documentation in the terminal.

## Configuration

See [docs/configuration.md](docs/configuration.md) for the full configuration reference, including scan patterns, candidate detection, and pattern-based ref resolution.

## Programmatic API

shiori exposes typed exports for editor extensions, CI tooling, and custom integrations. See [docs/api.md](docs/api.md) for the full API reference.

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

      - name: Check annotations
        run: npx shiori check --fail-on missing-in-registry,expired

      - name: Generate report
        if: always()
        run: npx shiori check -f markdown -o report.md
```

## Requirements

- **Runtime (npm package users):** Node.js >= 18.0.0
- **Development:** Node.js >= 22.6.0 (required for `--experimental-strip-types` in tests)

## Development

```bash
pnpm install
pnpm build
pnpm test          # Requires Node.js >= 22.6.0
pnpm typecheck
pnpm lint
pnpm link:local    # Install `shiori` command globally from local source
pnpm unlink:local  # Remove the global link
```

## License

[MIT](LICENSE)
