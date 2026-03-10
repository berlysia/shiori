---
name: shiori-guide
description: Background knowledge about shiori annotation tracking CLI — syntax, commands, registry, verify issues. Use when encountering "shiori:" markers in code comments, .config/shiori/ registry files, or when user mentions "annotation tracking", "lint suppression governance", "shiori verify", "shiori scan". Do NOT use for step-by-step workflows (use shiori-workflow) or adoption guidance (use shiori-adopt).
---

# shiori — Annotation Tracking CLI

Recovers structured annotations from lint `disable` comments, manages them in a JSON/YAML registry, and verifies consistency in CI.

## Annotation Syntax

First token = tracking ref, remaining tokens = `key=value` pairs:

```
// eslint-disable-next-line no-console -- shiori: SUP-1234 expires=2026-06
// shiori: ADR:0007
// shiori:SUP-1234                          (compact form)
// shiori: SUP-1234 reason="workaround" expires=2026-06
// shiori:                                  (draft — no ref)
```

- `ref=` key is invalid — use positional syntax
- `kind` is registry-only (not in source)

## Scan Classification

| Input                            | Output                  |
| -------------------------------- | ----------------------- |
| Lint directive + `shiori:`       | Annotation with rule    |
| Standalone `shiori:` comment     | Annotation without rule |
| Lint directive without `shiori:` | Candidate (untracked)   |
| Regular comment                  | Ignored                 |

## Data Flow

```
Source Files → scan → Annotations + Candidates
                            ↓
              verify + Registry → Issues (errors/warnings)
```

## Registry (`.config/shiori/registry.json`)

```json
{
  "SUP-1234": {
    "reason": "Legacy API workaround",
    "target": "src/api/client.ts",
    "expires": "2026-06",
    "ticket": "https://example.com/issues/1234",
    "owner": "team-platform",
    "kind": "suppression"
  }
}
```

## Commands

| Category    | Commands                                                                                                   |
| ----------- | ---------------------------------------------------------------------------------------------------------- |
| Workflow    | `init`, `scan`, `verify`, `check`, `update`, `adopt`, `resolve`, `migrate`, `watch`, `draft`, `candidates` |
| Governance  | `health`, `triage`, `report`, `trend`, `delta`                                                             |
| Diagnostics | `doctor` (maturity assessment, upgrade wizard)                                                             |
| Information | `show`, `why`, `jump`, `docs`                                                                              |

## Verify Issue Types

| Type                        | Severity |
| --------------------------- | -------- |
| `missing-in-registry`       | error    |
| `unused-in-source`          | error    |
| `expired`                   | error    |
| `syntax-error`              | error    |
| `ref-format`                | error    |
| `ref-collision`             | error    |
| `unrouted-ref`              | error    |
| `registry-routing-mismatch` | error    |
| `expiring-soon`             | warning  |
| `ref-status-closed`         | warning  |
