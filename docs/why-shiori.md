# Why shiori?

## The Structural Risk Hidden by lint disable Comments

When you write `eslint-disable-next-line` or `stylelint-disable-next-line`, that violation **disappears completely** from the lint results. CI stays green, and even if a PR reviewer notices the comment, they cannot tell "why it was suppressed", "when it will be resolved", or "who is responsible".

One or two suppressions may not be a problem. But as the codebase grows, disable comments quietly multiply, and eventually become **a breeding ground for technical debt that nobody can see in full**.

shiori brings these "invisible violations" back under organizational management.

## Why Not a lint Plugin?

### A Structural Limit: Suppressed Violations Cannot Be Observed

Looking at how lint tools process `disable` comments makes it clear why a plugin cannot solve this.

```
Source code
  ↓
[Parse & run rules] → Detect violations
  ↓
[Apply disable directives] → Remove the matching violations
  ↓
Lint result (list of violations)  ← This is all a plugin can see
```

In ESLint, `applyDisableDirectives()` is called inside `linter.verify()` and removes the violations that correspond to disable comments from the result array. What a plugin (a custom rule) receives is the result after removal, so it has **no way to know what was suppressed**.

In other words, a plugin structurally cannot:

- Get the list of suppressed violations
- Verify the reason or expiry of a suppression
- Detect "suppressions not registered in the registry"

### Mismatched Responsibilities: Organizational Concerns That Would Bloat a Plugin

Even if a plugin could enforce a comment format (for example, requiring an ID on `disable` comments), most of the functionality governance needs goes beyond a plugin's responsibility:

| Capability                        | Possible in a plugin? | Reason                                                                                           |
| --------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------ |
| Enforcing comment format          | ✅ Possible           | It can be handled as an AST node                                                                 |
| Cross-checking against a registry | ❌ Inappropriate      | Loading and matching an external JSON/YAML is outside a rule's responsibility                    |
| Detecting expiry                  | ❌ Inappropriate      | Date comparison and expiry notification are outside a rule's responsibility                      |
| Inventory (detecting unused ones) | ❌ Impossible         | A ref that is in the registry but not in the source cannot be found by scanning the source alone |
| Cross-cutting report generation   | ❌ Impossible         | Lint works per file. It structurally cannot aggregate across the whole project                   |
| SARIF / Markdown output           | ❌ Inappropriate      | Supporting varied output formats is outside a lint tool's responsibility                         |
| Spanning multiple lint tools      | ❌ Impossible         | An ESLint plugin cannot see stylelint's suppressions                                             |

Packing these into a plugin would cost the simplicity and maintainability of a lint rule.

### Lint-Tool Independent: Not Tied to Versions or Internal APIs

Major version upgrades of lint tools (such as the flat config migration from ESLint v8 to v9) force breaking changes on plugins. shiori scans the source code directly as text, so it does not depend on any lint tool's internal API. It handles the disable comments of ESLint, stylelint, and Biome alike.

## Choosing an External CLI

shiori is an independent CLI that runs **outside** the lint tools. This design gives you:

- **Direct source scanning**: Reliably recovers violations hidden by disable
- **Registry management**: Links a reason, owner, and expiry to each annotation
- **CI integration**: One `shiori check` completes scanning and verification, and it can be adopted immediately with GitHub Actions
- **Multiple output formats**: JSON, Markdown, SARIF, and summary, chosen to suit the purpose
- **Spanning lint tools**: ESLint and stylelint are managed uniformly with the same command

### Complementing lint Rules

shiori does **not replace** lint rules.

```
┌─────────────────────────────────┐
│           lint rules            │  Enforce the format of disable comments
│  (e.g. require-shiori-ref)      │  "No disable without an ID"
└──────────┬──────────────────────┘
           │ complements
┌──────────▼──────────────────────┐
│           shiori CLI            │  Recover annotations that carry an ID
│                                 │  Registry matching, expiry management, reports
└─────────────────────────────────┘
```

Enforcing "every disable comment must carry a `shiori:` annotation" with a lint rule, and having shiori recover and manage those annotations, is the most sensible division of labor.

## CI Governance in 5 Minutes

```bash
pnpm add -D @berlysia/shiori   # 1. Install
shiori init --ci basic          # 2. Initialize + generate the CI workflow
shiori check                    # 3. Verify annotations
shiori update                   # 4. Add new refs to the registry
git push                        # 5. CI verifies governance automatically
```

To bring the lint disable comments scattered across an existing project under management in one go:

```bash
shiori scan && shiori adopt --apply
```

`shiori adopt` inserts `shiori:` annotations into untracked disable comments and generates the registry entries automatically.

## Governance as Documentation: Structuring the "Why" of Code

A shiori annotation is more than a management tag. It structures the **decisions, exceptions, and context** in the code and makes them work as part of the documentation.

### What Annotations Point To

The tracking reference (ref) in `shiori:` is not limited to issue tickets:

| Use              | Example            | Meaning                                      |
| ---------------- | ------------------ | -------------------------------------------- |
| Bug tracking     | `shiori: SUP-1234` | Tracking ticket for a workaround             |
| Design decision  | `shiori: ADR:0007` | Reference to an architecture decision record |
| Development note | `shiori: DEV-001`  | Record of a technical decision or TODO       |
| Migration plan   | `shiori: MIG-042`  | Marker for a migration target                |
| Risk acceptance  | `shiori: RISK-003` | Record of a conscious risk acceptance        |

You can structurally link the "why is the code like this" to external documents and management systems.

### Before / After

**Without shiori** — suppression is invisible noise:

```typescript
// eslint-disable-next-line no-constant-condition
while (true) {
  /* ... */
}

const raw: Config = JSON.parse(content) as Config;
```

A reviewer can see that the cast exists, but cannot tell _why_ it is needed, _who_ is responsible, or _when_ it should be resolved.

**With shiori** — every exception is trackable and auditable:

```typescript
// eslint-disable-next-line no-constant-condition -- shiori: DEV-001 reason="infinite loop pattern"
while (true) {
  /* ... */
}

// shiori: DEV-007 reason="config cast without schema validation" expires=2026-06
const raw: Config = JSON.parse(content) as Config;
```

The registry holds the structured metadata:

```json
{
  "DEV-007": {
    "reason": "Config file parsed from JSON cast without schema validation",
    "expires": "2026-06",
    "owner": "berlysia",
    "kind": "type-assertion"
  }
}
```

## Vision: The Governance Experience in the Editor

The next step shiori aims for is to **blend governance information naturally into the act of reading code**.

Hover over a `shiori:` annotation and the registry's reason, expiry, owner, and external links appear immediately — we are designing an IDE integration that reduces the distance between code and context to zero, without switching to a terminal.

```
┌─────────────────────────────────────────────────────┐
│ // shiori: DEV-007 expires=2026-06                  │
│         ▼ hover                                     │
│ ┌─────────────────────────────────────────────────┐ │
│ │ DEV-007 (type-assertion)                        │ │
│ │ Config cast without schema validation           │ │
│ │ Owner: berlysia | Expires: 2026-06              │ │
│ │ Ticket: EP-0011 → [Open in browser]             │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

shiori delivers "annotations that can be read as part of the documentation", aiming to reconcile code quality with developer experience.

## Learn More

- [README](../README.md) — Command reference and CI integration guide
- [ADR 001](decisions/001-external-cli-over-lint-plugin.md) — Details of the design decision to choose an external CLI
- [ADR 002](decisions/002-annotation-model-generalization.md) — Generalizing the annotation model
- [Configuration](configuration.md) — Configuration reference
- [API Reference](api.md) — Programmatic API
