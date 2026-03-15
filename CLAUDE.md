# CLAUDE.md

## Project Overview

shiori is an annotation tracking and governance CLI tool. It recovers structured annotations (lint violations hidden by `disable` comments) from source code, manages them in a JSON registry, and verifies them in CI. Current version: 0.1.1.

## Commands

```bash
pnpm install          # Install dependencies
pnpm build            # TypeScript compilation (tsc → dist/)
pnpm test             # Run all tests (node:test with --experimental-strip-types)
pnpm typecheck        # Type check without emitting (tsc --noEmit)
pnpm lint             # Lint with oxlint
pnpm format           # Format with prettier
pnpm format:check     # Check formatting
```

Run a single test file:

```bash
node --experimental-strip-types --test tests/parser.test.ts
```

Requires Node.js >= 22.6.0.

## Architecture

### Data Flow

```
Source Files → CommentProvider.scan() → ShioriAnnotation[]
                                              ↓
                              verify() + Registry → VerifyResult (issues, summary)
```

### Core Modules (`src/core/`)

- **types.ts** — Shared types (`ShioriAnnotation`, `Registry`, `VerifyIssue`, etc.)
- **parser.ts** — `parseShioriFields()`: `shiori: <ref> [key=value ...]` syntax parsing
- **registry.ts** — Registry load/validate/save (JSON, YAML, auto-detected by extension)
- **providers/AnnotationProvider.ts** — Provider interface
- **providers/CommentProvider.ts** — Line-based text scanning for lint disable comments

### Commands (`src/commands/`)

Pattern: `scan.ts` (logic) + `scan-cli.ts` (CLI wrapper). Framework: gunshi. Commands (21):

- **Workflow**: `init`, `scan`, `verify`, `check`, `update`, `adopt`, `resolve`, `migrate`, `watch`, `draft`, `candidates`
- **Governance & Insights**: `health`, `triage`, `report`, `trend`, `delta`
- **Diagnostics**: `doctor`
- **Information**: `show`, `why`, `jump`, `docs`

### CommentProvider Classification Paths

- **Path A**: Lint directive + `shiori:` → Full annotation with rule
- **Path B**: Standalone `shiori:` comment → Annotation without rule
- **Path C**: Lint directive without `shiori:` → Candidate (detected for potential tracking)
- **Path D**: Regular comment → Ignored

### Annotation Syntax (ADR 003, ADR 007)

Positional ref syntax: first token is the tracking reference, remaining tokens are `key=value` pairs:

```typescript
// eslint-disable-next-line no-console -- shiori: SUP-1234 expires=2026-06
// shiori: ADR:0007
// shiori:SUP-1234              // compact form
```

`ref=` key is not valid (produces parse error). `kind` field is registry-only (not in source comments). See ADR 004.

### Design Decisions

ADRs in `docs/decisions/` (001-024). Read specific ADRs when relevant to current task.
Key ADRs for annotation parsing: 003 (key=value syntax), 005 (drafts), 006 (candidates), 007 (positional ref).

## Dogfooding (`shiori verify` で自己追跡)

レジストリ: `.config/shiori/registry.json`

- ref プレフィックス: `DEV-` (開発メモ), `ADR-` (設計決定参照)
- `expires` は期限付きワークアラウンドに必須
- 整合性確認: `pnpm build && shiori verify`
