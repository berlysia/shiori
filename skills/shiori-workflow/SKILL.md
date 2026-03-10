---
name: shiori-workflow
description: Step-by-step workflows for shiori CLI — project setup, adding suppressions, reviewing health, PR delta, CI integration. Use when setting up shiori, onboarding a codebase, or user says "setup shiori", "add to CI", "annotation workflow", "PR review annotations". Do NOT use for background reference (use shiori-guide) or bulk adoption (use shiori-adopt).
---

# shiori Workflows

## Setup (New Project)

1. `shiori init` — create `.config/shiori/` with config and empty registry
2. `shiori scan` — discover annotations and untracked candidates
3. `shiori adopt` — convert candidates to tracked annotations (see `/shiori-adopt`)
4. `shiori verify` — confirm all annotations have registry entries
5. Add `shiori check` to CI (`shiori doctor --upgrade` generates workflow templates)

## Adding a Suppression

```typescript
// eslint-disable-next-line no-console -- shiori: PROJ-123 expires=2026-06 reason="temporary debug logging"
console.log(debugInfo);
```

Then run `shiori update` to sync registry from source, or manually edit `.config/shiori/registry.json`.

## Reviewing Health

```bash
shiori health              # Score (0-100) + insights
shiori triage              # Prioritized action list (see /shiori-triage)
shiori report --format md  # Full governance report
```

## PR Review with Delta

```bash
shiori delta --base main   # Added/removed/unchanged annotations vs base branch
```

## Resolving Annotations

```bash
shiori resolve --ref PROJ-123   # Remove from source and registry
```

## CI Patterns

```yaml
# Basic gate
- run: npx shiori check

# PR comment
- run: npx shiori delta --base ${{ github.event.pull_request.base.sha }} --format markdown

# Health badge
- run: npx shiori report --format badge
```

## Ref Naming

| Prefix     | Use Case                     |
| ---------- | ---------------------------- |
| `PROJ-NNN` | Issue tracker link           |
| `ADR:NNNN` | Architecture Decision Record |
| `DEV-NNN`  | Developer workarounds        |

Namespace prefixes (e.g., `JIRA:PROJ-123`) are resolved to URLs via configured patterns.
