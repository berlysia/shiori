# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-03-11

### Added

#### New Commands (11)

- `shiori health` — One-command governance health assessment with score (0–100), expired/expiring-soon counts, and optional trend history
- `shiori report` — Comprehensive governance report with rule/kind/owner breakdowns and actionable insights
- `shiori doctor` — Diagnostic checks (Node.js version, config, registry, git blame, .gitignore) with `--maturity` assessment (Level 0–4) and `--upgrade` wizard
- `shiori triage` — Prioritized governance issue triage with `--owner`, `--kind`, `--expired-only` filtering and action recommendations
- `shiori trend` — Governance score trend analysis from historical report JSON snapshots (`--history <dir>`)
- `shiori delta` — Annotation change detection between base and head scan results, with `--added-only` filter and `--format markdown` for PR comments
- `shiori adopt` — Batch adoption of candidate lint disable comments into the registry, with `--dry-run` and `--batch`/`--interactive` modes
- `shiori resolve` — Remove resolved annotations from source code and/or registry, with freshness validation and `--dry-run`
- `shiori why` — Annotation context lookup: registry details, source locations, resolved URL, inline reasoning
- `shiori migrate` — Migrate annotations between syntax formats
- `shiori docs` — Show shiori documentation and quick-start guides

#### HTML Governance Dashboard

- Self-contained HTML report (`report --format html`) with zero external dependencies and dark-mode styling
- Diff overlay visualization (`--diff-base <path>`) showing added/removed/unchanged annotations
- Annotation provenance view (`--provenance`) displaying git blame author, commit hash, and date per annotation
- Chronicle timeline (`--timeline`) combining provenance, expiration, and external status events into a lifecycle view
- Live dashboard mode (`watch --dashboard`) with auto-refresh HTML output and `--open` for browser launch

#### Governance Maturity Model

- 5-level maturity assessment (Level 0–4): Not initialized → Basic setup → CI integrated → Visible governance → Continuous monitoring
- Signal-based level detection (config, CI workflow, badge, snapshot history, scheduled workflow)
- `doctor --maturity --upgrade` wizard for guided level advancement with `--dry-run` and `--yes` modes
- Artifacts-only badge mode for Level 2→3 advancement without Gist/PAT requirement

#### Provenance & Timeline

- Git blame integration (`src/core/provenance.ts`) for annotation introduction tracking
- Batch git blame optimization — file-level processing reduces process spawns from O(annotations) to O(files)
- Annotation Chronicle (`src/core/chronicle.ts`) with 4-level degradation: provenance + ref-status + expiration + registry-only
- External ref status command protocol (`--ref-status-command`) for checking ticket/issue status via JSONL I/O (ADR 023)

#### Workspace / Monorepo Support

- Monorepo workspace detection (pnpm-workspace.yaml, npm workspaces)
- `--workspace` flag for `check` command enabling cross-package annotation scanning
- Per-package scan results with root-relative path normalization (ADR 022)

#### New Verify Issue Types

- `expiring-soon` — Annotations approaching their expiration date (configurable threshold via `--expiring-threshold`)
- `ref-status-closed` — External ticket/issue already closed but annotation still present
- `unrouted-ref` — Ref not matching any configured `refPatterns`
- `registry-routing-mismatch` — Ref routed to different registry file than where it is registered

#### Report Formats

- `--format html` — Self-contained HTML governance dashboard
- `--format badge` — Shields.io endpoint JSON for governance score badges
- `--format markdown` — Markdown report with insights and breakdowns (for delta PR comments)

#### CI Workflows & Recipes

- `shiori-badge.yml` — Generate and publish governance score badge
- `shiori-pr-comment.yml` — Auto-comment PRs with annotation change summary (delta)
- `shiori-pr-description.yml` — Auto-populate PR description with governance delta
- `shiori-expires-alert.yml` — Scheduled alerts for expiring annotations
- `shiori-base.yml` — Reusable workflow base template
- 13 recipes in `docs/recipes/`: governance badge, PR delta comments, PR description, HTML artifacts dashboard, GitHub Checks gate, issue auto-creation, Slack notification, scheduled governance orchestrator, local dashboard, alert-to-ref bridge, PR onboarding snippet, VSCode tasks

#### Init Enhancements

- `--starter <template>` for pre-configured registry templates (adr, risk, migration, custom)
- `--ci` flag for GitHub Actions workflow template generation (basic, sarif, delta-pr-comment, checks-gate, badge, badge-gist)
- State-adaptive Next Steps guidance based on scan results (candidates → adopt, zero results → starter suggestion)

#### Dogfooding

- 10 self-tracking `shiori:` annotations (DEV-001 through DEV-010) with registry entries
- CI-integrated governance verification, health checks, and HTML report generation as artifacts

#### Architecture & Core

- `src/core/registry-router.ts` — Pattern-based registry routing (extracted from commands layer)
- `src/core/provenance.ts` — Git blame metadata extraction with batch optimization
- `src/core/chronicle.ts` — Timeline event builder combining provenance, expiration, and external status
- `src/core/ref-status.ts` — External ref status command I/O protocol
- `src/core/workspace.ts` — Workspace detection and per-package scan result merging
- `src/core/report-files.ts` — Report JSON loading with runtime shape validation
- `src/core/snapshot.ts` — Snapshot I/O utilities
- `src/core/cli-context.ts` — Shared CLI context builders (config + registry loading, scan patterns, routed save)
- `src/core/emoji.ts` — Unified emoji helpers
- ADR 022: Workspace governance (`--workspace` flag design)
- ADR 023: Annotation Chronicle (provenance × ref-status × registry timeline)

### Changed

- Pre-commit formatting hook (husky + lint-staged)
- Extract shared `isNodeError()` type guard to `src/core/errors.ts`
- `ReportResult`, `ReportInsight`, `BreakdownEntry` types promoted from `commands/report.ts` to `core/types.ts`
- `routeRegistryByPattern()` moved from `commands/registry-generator.ts` to `core/registry-router.ts` (core → commands dependency direction fix)
- `scanWorkspaces()` moved from `core/` to `commands/` (layer violation fix)
- CLI boilerplate unified via shared context builders (`cli-context.ts`, `cli-output.ts`)
- Path resolution standardized (`path.join` → `path.resolve`) for absolute/relative path consistency
- `engines.node` set to `>=18.0.0`
- dependency-cruiser boundary rules expanded to cover composition modules (doctor, init-steps, scan-workspaces)

### Performance

- Batch git blame by file reduces process spawns from O(annotations) to O(files)

### Fixed

- Absolute/relative path mixing in scan result interpretation (Concern 005/006)
- `escapeRegExp` duplicate code consolidated
- Registry routing pattern integrity checks preventing silent misroutes
- Scan freshness validation in `resolve --apply` preventing stale operations

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
