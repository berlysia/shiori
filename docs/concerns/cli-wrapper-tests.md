# Concern: CLI wrapper layer test coverage

## Status

Open

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
