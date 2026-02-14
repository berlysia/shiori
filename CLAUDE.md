# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

shiori is an annotation tracking and governance CLI tool. It recovers structured annotations (lint violations hidden by `disable` comments) from source code, manages them in a JSON registry, and verifies them in CI. Early development stage (0.0.1), no external users yet.

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

- **types.ts** — All shared types (`ShioriAnnotation`, `Registry`, `VerifyIssue`, etc.)
- **parser.ts** — `parseShioriFields()`: parses `shiori: <ref> [key=value ...]` annotation syntax
- **registry.ts** — Registry loading, validation, saving (JSON and YAML formats, auto-detected by file extension)
- **providers/AnnotationProvider.ts** — Provider interface (pluggable extraction)
- **providers/CommentProvider.ts** — Current implementation: line-based text scanning for lint disable comments

### Commands (`src/commands/`)

Each command has a pure logic module and a CLI wrapper (e.g., `scan.ts` + `scan-cli.ts`). CLI framework: gunshi.

Implemented commands: `init`, `scan`, `verify`, `check`, `update`, `draft`, `candidates`, `show`, `docs`.

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

ADRs are in `docs/decisions/`:

- **001**: External CLI over lint plugin (disable comments are invisible to lint results)
- **002**: Annotation model generalization (suppression → annotation, multiple verbs)
- **003**: `shiori: key=value` syntax migration (from `verb(<id>)` format)
- **004**: `kind` field registry-only migration (from source comments to registry)
- **005**: Draft annotations (`shiori:` with no ref as intentional draft state)
- **006**: Candidate detection and `shiori:ignore` (malformed → syntax-error, auto-detect lint disable candidates)
- **007**: Positional ref syntax (`ref=` replaced by positional first token)
- **008**: Namespace resolution (`parseRef()` and `resolveRefUrl()` for `NAMESPACE:id` refs)
- **009**: `shiori show` command (ref information lookup with registry, source locations, URL)
- **010**: Multi-registry loading (namespace-based registry file splitting)
- **011**: JSON Schema registry validation (proposed)
- **012**: Pattern-based ref resolution (supersedes ADR 008)

## Dogfooding: shiori で自身の開発を追跡

開発中に遭遇した技術的決定・TODO・ワークアラウンドは shiori 自身を使ってコード内アノテーションとレジストリで管理する。

### 使い方

コード内でメモしたいことがあれば `shiori:` アノテーションを書く:

```typescript
// shiori: DEV-001 reason=workaround for X
// eslint-disable-next-line some-rule -- shiori: DEV-002 expires=2026-06
```

レジストリ (`.config/shiori/registry.json`) にエントリを追加して構造化情報を保存する。

### 運用ルール

- ref のプレフィックスは `DEV-` (開発メモ)、`ADR-` (設計決定参照) を使用
- `expires` は期限のあるワークアラウンドに必ず設定
- `pnpm build && shiori verify` で整合性を確認
