---
name: shiori-adopt
description: Convert untracked lint disable comments into tracked shiori annotations — discover candidates, plan refs, add markers, update registry. Use when onboarding existing codebase, when "shiori candidates" finds untracked comments, or user says "adopt", "convert disable comments", "track suppressions", "onboard lint rules". Do NOT use for new suppression addition (use shiori-workflow).
---

# shiori Adopt

## Steps

1. **Discover**: `shiori candidates` — list untracked lint disable comments
2. **Plan ref naming** — choose a prefix and grouping strategy
3. **Add markers**: insert `shiori:` into existing disable comments
4. **Update registry**: `shiori update` — create entries for new annotations
5. **Verify**: `shiori verify` — confirm zero errors

## Ref Naming Strategy

Pick a prefix matching your intent:

| Prefix           | When to use                             |
| ---------------- | --------------------------------------- |
| `DEBT-NNN`       | Technical debt tracking                 |
| `SUP-NNN`        | Lint suppressions                       |
| `LEGACY-NNN`     | Legacy code workarounds                 |
| Issue tracker ID | `JIRA-1234`, `GH-567` for linked issues |

**Grouping**: same rule across files or same workaround reason → one ref. Unrelated suppressions → separate refs.

## Adding Markers

Before:

```typescript
// eslint-disable-next-line no-console
console.log(data);
```

After:

```typescript
// eslint-disable-next-line no-console -- shiori: DEBT-001 expires=2026-06
console.log(data);
```

Set `expires` for temporary suppressions. Omit for accepted long-term patterns.

## After Adoption

Enrich registry entries in `.config/shiori/registry.json`:

- `reason`: why this suppression exists
- `owner`: responsible team/person
- `ticket`: link to tracking issue
- `kind`: category (suppression, workaround, accepted)

Run `shiori health` to see governance score improvement.
