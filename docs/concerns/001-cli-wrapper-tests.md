---
status: Open
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

### Remaining

- `check-cli.ts`, `verify-cli.ts`, `scan-cli.ts`, `update-cli.ts`
- `show-cli.ts`, `jump-cli.ts`, `candidates-cli.ts`, `draft-cli.ts`, `docs-cli.ts`
