---
status: Closed
resolved_at: 2026-02-27
resolved_by: engineer
---

# Concern 001: CLI wrapper layer test coverage

## Summary

The 9 `*-cli.ts` files lack direct unit tests. They are partially covered by `cli-e2e.test.ts` (36 tests), but argument parsing, validation, and error formatting logic in each wrapper is not individually tested.

## Affected files

- `src/commands/init-cli.ts` (242 lines — most complex)
- `src/commands/watch-cli.ts` (238 lines)
- `src/commands/check-cli.ts` (186 lines)
- `src/commands/verify-cli.ts` (138 lines)
- `src/commands/scan-cli.ts` (123 lines)
- `src/commands/update-cli.ts` (120 lines)
- `src/commands/show-cli.ts` (82 lines)
- `src/commands/jump-cli.ts` (81 lines)
- `src/commands/candidates-cli.ts` (81 lines)
- `src/commands/draft-cli.ts` (64 lines)
- `src/commands/docs-cli.ts` (34 lines)

## Recommended approach

- Prioritize by complexity: `init-cli.ts` and `watch-cli.ts` first
- Test argument parsing and flag validation directly (unit tests)
- Test error output formatting (stderr messages, exit codes)
- Existing E2E tests cover happy paths; focus on error paths and edge cases

## Progress

### Completed

- **`init-cli.ts`** (13 tests in `tests/init-cli.test.ts`):
  - Fresh directory initialization (config + registry + .gitignore creation)
  - Existing config skip (config.yaml, config.yml, config.json variants)
  - Existing registry skip
  - Existing .gitignore entry skip
  - Custom --registry flag
  - Idempotent double init
  - No annotations found (empty dir, files without annotations)
  - --patterns and --ignore flags
  - Summary output format (stderr structure)

- **`watch-cli.ts`** (16 tests in `tests/watch-cli.test.ts`):
  - --debounce-ms validation (non-numeric, boundary 0, large value, default)
  - CLI framework limitation: negative values parsed as separate flags
  - --once mode (refresh and exit, annotation count)
  - --sync-registry mode (merge new refs, up-to-date, stderr messages)
  - --output flag (custom path, nested directory creation)
  - --cwd flag
  - stderr output format (timestamp, counts)

- **`check-cli.ts`** (7 tests in `tests/check-cli.test.ts`):
  - --fail-on / --warn-on / --format validation (invalid values → exit 1)
  - Registry not found error
  - Successful check with no issues (exit 0, JSON output)
  - Verify errors cause exit code 1 (missing-in-registry)
  - --output file writing

- **`verify-cli.ts`** (7 tests in `tests/verify-cli.test.ts`):
  - --fail-on / --warn-on / --format validation (invalid values → exit 1)
  - Registry not found error
  - Scan result file not found error
  - Successful verify with no issues (exit 0, JSON output)
  - Verify errors cause exit code 1 (missing-in-registry)

- **`scan-cli.ts`** (5 tests in `tests/scan-cli.test.ts`):
  - --provider validation (invalid value → exit 1)
  - --output file writing
  - Pipe mode (non-TTY: stdout JSON, stderr stats)
  - --patterns flag (custom patterns)
  - No matching files (empty results)

- **`update-cli.ts`** (4 tests in `tests/update-cli.test.ts`):
  - Registry not found error
  - Scan result file not found error
  - Successful update with new refs (registry modified, stderr count)
  - --dry-run flag (preview without writing)

- **`show-cli.ts`** (2 tests in `tests/show-cli.test.ts`):
  - Ref not found (exit 1, JSON with empty sourceLocations)
  - Successful ref lookup (exit 0, JSON with registryEntry and sourceLocations)

- **`jump-cli.ts`** (3 tests in `tests/jump-cli.test.ts`):
  - Ref not found (exit 1, stderr error message)
  - Successful jump (first location as file:line)
  - --all flag (multiple locations)

- **`candidates-cli.ts`** (2 tests in `tests/candidates-cli.test.ts`):
  - JSON output with candidates
  - --format markdown output

- **`draft-cli.ts`** (2 tests in `tests/draft-cli.test.ts`):
  - JSON output with draft annotations
  - --output file writing

- **`docs-cli.ts`** (1 test in `tests/docs-cli.test.ts`):
  - README.md content output to stdout

### Summary

All 11 CLI wrapper files covered with dedicated tests. Total: 57 tests across 11 test files (init:13, watch:16, check:7, verify:7, scan:5, update:4, show:2, jump:3, candidates:2, draft:2, docs:1).
