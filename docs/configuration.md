# Configuration Reference

shiori is configured via a YAML or JSON file at `.config/shiori/config.yaml` (or `.yml` / `.json`). All fields are optional.

## File Location

Config files are searched in priority order:

1. `.config/shiori/config.yaml` (canonical)
2. `.config/shiori/config.yml` (common abbreviation)
3. `.config/shiori/config.json` (backward compatibility)

The first file found is used. If none exist, built-in defaults apply.

You can override the config directory with the `--config` CLI flag on supported commands.

## Full Example

```yaml
# .config/shiori/config.yaml

scan:
  patterns:
    - '**/*.{js,ts,tsx,jsx}'
    - '**/*.{css,scss,pcss}'
  ignore:
    - '**/node_modules/**'
    - '**/dist/**'
    - '**/.git/**'

paths:
  scanResult: '.config/shiori/scan-result.json'
  registry: '.config/shiori/registry.json'

candidates:
  eslint: true
  stylelint: true
  typescript: false
  keywords: false

verify:
  expiringThresholdDays: 14

refPatterns:
  - match: 'JIRA-{id}'
    urlTemplate: 'https://jira.example.com/browse/{id}'
    registryFile: '.config/shiori/registry-jira.json'
  - match: 'ADR-{id}'
    urlTemplate: 'docs/decisions/{id}.md'
```

## Settings

### `scan`

Default glob patterns for source file scanning.

| Key        | Type       | Default                                              | Description              |
| ---------- | ---------- | ---------------------------------------------------- | ------------------------ |
| `patterns` | `string[]` | `["**/*.{css,scss,pcss,js,ts,tsx,jsx}"]`             | Glob patterns to scan    |
| `ignore`   | `string[]` | `["**/node_modules/**", "**/dist/**", "**/.git/**"]` | Glob patterns to exclude |

These defaults can be overridden per-invocation with `--patterns` / `--ignore` CLI flags.

### `paths`

File paths relative to the project root.

| Key          | Type     | Default                             | Description              |
| ------------ | -------- | ----------------------------------- | ------------------------ |
| `scanResult` | `string` | `".config/shiori/scan-result.json"` | Path to scan result file |
| `registry`   | `string` | `".config/shiori/registry.json"`    | Path to registry file    |

### `candidates`

Controls which comment patterns are detected as candidates (lint disable comments without `shiori:` annotation).

**Built-in tools:**

| Tool         | Matchers                            | Default            |
| ------------ | ----------------------------------- | ------------------ |
| `eslint`     | `disable-next-line`, `disable-line` | `true` (enabled)   |
| `stylelint`  | `disable-next-line`, `disable-line` | `true` (enabled)   |
| `typescript` | `ts-ignore`, `ts-expect-error`      | `false` (disabled) |
| `keywords`   | `todo`, `fixme`, `hack`, `xxx`      | `false` (disabled) |

**Boolean shorthand** enables or disables all matchers for a tool:

```yaml
candidates:
  eslint: true # all eslint matchers enabled
  keywords: false # all keyword matchers disabled
```

**Per-matcher control** overrides individual matchers:

```yaml
candidates:
  eslint:
    disable-next-line: true
    disable-line: false
```

**Custom matchers** can be added via `_matchers`:

```yaml
candidates:
  my-tool:
    _matchers:
      my-directive:
        pattern: "\\bmy-tool-disable\\s+(.*)"
        rules: csv
        separator: '--'
```

Matcher config fields:

| Field       | Type                  | Description                                         |
| ----------- | --------------------- | --------------------------------------------------- |
| `pattern`   | `string`              | Regex pattern. Capture group 1 = rest after keyword |
| `rules`     | `"csv"` \| `"single"` | Rule extraction mode (optional)                     |
| `separator` | `string`              | Separator between rules and meta parts (optional)   |
| `text`      | `boolean`             | Store captured text in candidate output (optional)  |

### `verify`

Options for the `verify` and `check` commands.

| Key                     | Type     | Default | Description                                               |
| ----------------------- | -------- | ------- | --------------------------------------------------------- |
| `expiringThresholdDays` | `number` | `14`    | Days before expiration to trigger `expiring-soon` warning |

This setting can be overridden per-invocation with the `--expiring-threshold` CLI flag.

```yaml
verify:
  expiringThresholdDays: 30 # Alert 30 days before expiration
```

### `refPatterns`

Pattern-based ref resolution for URL generation and multi-registry routing. Each entry matches refs by pattern and optionally provides a URL template or dedicated registry file.

| Field          | Type     | Required | Description                                         |
| -------------- | -------- | -------- | --------------------------------------------------- |
| `match`        | `string` | Yes      | Pattern to match (e.g. `"JIRA-{id}"`, `"ADR-{id}"`) |
| `urlTemplate`  | `string` | No       | URL template with `{id}` placeholder                |
| `registryFile` | `string` | No       | Per-pattern registry file path (JSON or YAML)       |
| `entrySchema`  | `string` | No       | Reserved for future JSON Schema validation          |

The `{id}` placeholder in `match` captures the variable part of a ref. Patterns without `{id}` match exactly.

```yaml
refPatterns:
  - match: 'JIRA-{id}'
    urlTemplate: 'https://jira.example.com/browse/{id}'
    registryFile: '.config/shiori/registry-jira.json'
  - match: 'LEGACY-WORKAROUND'
    # Exact match, no {id} capture
```

## Related

- [README](../README.md) — Quick start and command reference
- [ADR 012](decisions/012-pattern-based-ref-resolution.md) — Pattern-based ref resolution design
- [ADR 004](decisions/004-kind-registry-only.md) — `kind` field registry-only rationale
