# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Pre-commit formatting hook (husky + lint-staged)

### Changed

- Extract shared `isNodeError()` type guard to `src/core/errors.ts`

## [0.0.1] - 2026-02-17

### Added

- Core annotation parser (`shiori: <ref> [key=value ...]` syntax)
- CommentProvider for line-based scanning of lint disable comments
- Registry management (JSON and YAML formats, auto-detected by extension)
- Multi-registry loading with namespace-based splitting
- Pattern-based ref resolution (`refPatterns` config)
- Configuration system (`.config/shiori/config.yaml`)
- 10 CLI commands: `init`, `scan`, `verify`, `check`, `update`, `draft`, `candidates`, `show`, `jump`, `watch`
- Output formatters: JSON (default), SARIF, summary text, JSONL
- CLI validation with user-friendly error messages and action hints
- Multi-language comment syntax support (JS/TS, CSS/SCSS, Python, Ruby, SQL, Lua, HTML/XML)
- Candidate detection for untracked lint disable comments
- Draft annotation support (`shiori:` with no ref)
- `shiori:ignore` for excluding comments from tracking
- GitHub Actions CI (Node 18/20/22 matrix) and release workflow
- 21 Architecture Decision Records (ADRs)
