---
status: Open
---

# Concern 003: update/watch commands use loadRegistry instead of loadMultiRegistry

## Summary

The `update` and `watch` commands call `loadRegistry()` which only reads the default registry file. When `refPatterns` is configured (ADR 010), pattern-specific registry files are ignored. This causes:

1. **Ref collision risk**: Generated refs may collide with existing refs in pattern-specific registries
2. **Data loss on save**: `saveRegistry()` overwrites the default file without merging pattern-specific entries

The `migrate` command was already fixed to use `loadMultiRegistry()`.

## Affected files

- `src/commands/update-cli.ts` — uses `loadRegistry()` for reading existing refs
- `src/commands/watch-cli.ts` — re-runs scan+update cycle, inherits the same issue

## Recommended approach

- Replace `loadRegistry()` with `loadMultiRegistry()` in both files
- Use `routeRegistryByPattern()` when saving (same pattern as `migrate-cli.ts`)
- Add tests verifying multi-registry roundtrip for update workflow
