---
status: Open
---

# Concern 002: Programmatic API documentation

## Summary

`package.json` exports 3 entry points for programmatic use, but there is no dedicated documentation for library consumers (e.g., VSCode extension developers per ADR 021).

## Exported entry points

- `.` → `src/core/types.ts` (ShioriAnnotation, Registry types)
- `./core/ref-pattern` → `src/core/ref-pattern.ts` (matchRefPattern, resolveRefUrl)
- `./commands/show` → `src/commands/show.ts` (showRef lookup)

## Recommended approach

- Create `docs/api.md` with usage examples for each export
- Include TypeScript code samples showing import and usage
- Document expected inputs, outputs, and error conditions
- Reference ADR 021 (VSCode extension) as primary consumer use case
