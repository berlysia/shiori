# ADR 007: Positional Ref Syntax

## Status

Accepted

## Context

ADR 003 established the `shiori: ref=<ID>` key=value syntax. However, `ref` is the most frequently used field, and requiring the `ref=` prefix is redundant. The bare ref shorthand (`shiori:SUP-1234`) works only for a single token and cannot be combined with additional fields (e.g., `shiori:SUP-1234 expires=2026-06` is not supported).

Since this project has no external users (v0.0.1), breaking changes are acceptable.

## Decision

**Replace `ref=<ID>` with positional ref syntax: the first non-`key=value` token is treated as the ref.**

The `ref` key is no longer valid in key=value pairs and produces a parse error.

### New Syntax

```
shiori: <ref> [key=value ...]
shiori:<ref>                    // compact form
```

Within lint disable comments:

```ts
// eslint-disable-next-line no-console -- shiori: SUP-1234 expires=2026-06
```

Standalone:

```ts
// shiori: ADR:0007
// shiori:SUP-1234
```

### Parse Rules

1. Trim input and check for empty
2. Examine the first token (up to the first whitespace). If it does not contain `=`, treat it as a positional ref; the remainder is parsed as key=value pairs
3. If a `ref` key appears in key=value pairs, emit error `"'ref' is not a valid key; use positional syntax"` and skip the value
4. If no positional ref is found (first token has `=` or input is empty), ref defaults to `''`

### Examples

| Input                      | ref        | fields          | errors                     |
| -------------------------- | ---------- | --------------- | -------------------------- |
| `SUP-1234 expires=2026-06` | `SUP-1234` | expires=2026-06 | none                       |
| `SUP-1234`                 | `SUP-1234` |                 | none                       |
| `ref=SUP-1234`             | (empty)    |                 | `'ref' is not a valid key` |
| `expires=2026-06`          | (empty)    | expires=2026-06 | none                       |
| (empty)                    | (empty)    |                 | none                       |

## Rationale

- **Reduced verbosity**: The most common operation (specifying a tracking ref) no longer requires `ref=`
- **Unified shorthand**: Previously, bare ref (`shiori:SUP-1234`) was a special case that could not take additional fields. Now positional ref is the standard form and naturally supports `shiori: SUP-1234 expires=2026-06`
- **No backward compatibility needed**: v0.0.1 with zero external users

### Rejected Alternative: Keep `ref=` as Deprecated

Supporting both `ref=` and positional ref would add parser complexity and ambiguity (what if both are present?). Since there are no users to migrate, clean removal is preferred.

## Consequences

- Breaking change to annotation syntax (acceptable at v0.0.1)
- Simpler, more ergonomic annotation writing
- Bare ref shorthand (`shiori:<ID>`) becomes a special case of compact positional ref (no behavioral change)
- All existing fixtures and tests must update `ref=VALUE` to positional `VALUE`
- ADR 003 syntax table is superseded by this ADR for the `ref` field
