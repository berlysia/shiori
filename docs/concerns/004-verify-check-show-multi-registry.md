---
status: Open
---

# Concern 004: verify/check/show commands ADR 010 multi-registry inconsistency

## Summary

The `verify`, `check`, and `show` commands load registry via `loadRegistry()` which only reads the default registry file. When `refPatterns` is configured (ADR 010), refs stored in pattern-specific registry files are invisible to these commands.

This causes:

1. **False positives in verify**: Refs that exist in pattern-specific registries are reported as `missing-in-registry`
2. **Incomplete show output**: `shiori show --ref X` cannot find refs stored outside the default registry
3. **check inherits verify issues**: Since check = scan + verify, it has the same problem

## Affected files

- `src/commands/verify-cli.ts` — loads registry for verification
- `src/commands/check-cli.ts` — loads registry for combined scan+verify
- `src/commands/show-cli.ts` — loads registry for ref lookup

## Recommended approach

- Replace `loadRegistry()` with `loadMultiRegistry()` in all three files
- Verify that `verify()` pure function works correctly with the merged registry
- Add integration tests with multi-registry configuration
