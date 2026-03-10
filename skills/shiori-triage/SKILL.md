---
name: shiori-triage
description: Triage and prioritize shiori annotations — health scoring, priority ordering, trend analysis, maturity assessment. Use when assessing governance health, deciding which annotations to fix first, generating reports, or user says "triage", "prioritize annotations", "health check", "governance report", "maturity level". Do NOT use for adding or converting annotations (use shiori-workflow or shiori-adopt).
---

# shiori Triage

## Quick Assessment

```bash
shiori health       # Score 0-100 with level (healthy/warning/critical) + insights
shiori triage       # Prioritized list ordered by urgency
shiori report       # Full governance report (--format json|markdown|badge|html)
```

## Triage Priority Order

1. **Expired** — past `expires` date, address immediately
2. **Expiring soon** — approaching expiration, plan resolution
3. **Syntax errors** — malformed annotations, fix syntax
4. **Missing in registry** — annotations without entries, add them
5. **Closed refs** — referenced tickets closed, resolve or update

## Decision Matrix

| Factor     | High priority         | Low priority     |
| ---------- | --------------------- | ---------------- |
| Expiration | Past / within 30 days | 6+ months        |
| Severity   | Error-level           | Warning-level    |
| Owner      | Unowned / departed    | Active owner     |
| Kind       | Workaround, hack      | Accepted pattern |
| Age        | 1+ year               | Recently added   |

## Trend & Delta

```bash
shiori trend                    # Score over time (needs CI snapshots)
shiori delta --base main        # Annotation changes vs base branch
```

## Maturity Assessment

```bash
shiori doctor --maturity        # Level 0-4 assessment
shiori doctor --upgrade         # Recommended next steps + CI template generation
```

Levels: 0 (not initialized) → 1 (basic setup) → 2 (CI integrated) → 3 (visible governance) → 4 (continuous monitoring).
