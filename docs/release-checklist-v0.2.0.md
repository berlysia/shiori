# Release Checklist: v0.2.0

## Quality Gates

All must pass before publishing:

- [ ] `pnpm test` — all test suites pass
- [ ] `pnpm typecheck` — zero type errors across all packages
- [ ] `pnpm lint` — zero lint violations
- [ ] `pnpm format:check` — formatting consistent

## CHANGELOG Completeness

Verify every shipped feature/fix has a CHANGELOG entry under `## [0.2.0]`:

- [ ] **Breaking Changes**: Exit code values changed (ADR 027 Phase 2b) — `1` → `2` for usage errors, `1` → `3` for environment errors
- [ ] **Changed**: Exit code constants (`ExitCode.SUCCESS`, `GOVERNANCE_VIOLATION`, `USAGE_ERROR`, `ENVIRONMENT_ERROR`)
- [ ] **Changed**: Exit code policy metadata with `doctor --check-exit-policies` self-verification
- [ ] **Changed**: Passthrough commands no longer set non-zero exit codes for non-governance conditions
- [ ] **Fixed**: Passthrough command exit code correction (ADR 027 Phase 2a)
- [ ] **Fixed**: Unzip injection prevention hardening
- [ ] **Fixed**: Command injection risk in GH Actions workflow templates
- [ ] **Security**: `execSync` → `execFileSync` with array arguments

### v0.1.2 features included in this release

- [ ] New commands: `fix`, `guide`, `summary`, `aggregate`, `weekly-report`
- [ ] CI Trust Bridge: fix preview in PR comments (EP-0121)
- [ ] Onboarding Guidance (EP-0127): auto-detection, step-by-step guidance
- [ ] Output formats: `--format markdown`, `--format json` for `fix` command
- [ ] Workspace structure: pnpm workspace monorepo migration

## ADR Consistency

- [ ] ADR 027 (Exit Code Policy) status is `accepted` and content matches implementation
- [ ] ADR 028 (Command Output Schema Versioning) is consistent with current output formats
- [ ] No ADRs in `proposed` status that should have been updated for this release

## Dogfooding Verification

- [ ] `pnpm build && shiori verify` passes against `.config/shiori/registry.json`
- [ ] `shiori health` score is acceptable (no unexpected regressions)
- [ ] `shiori doctor` reports no diagnostic failures
- [ ] `shiori doctor --check-exit-policies` confirms all commands have consistent exit code policies

## Package Publishing

- [ ] `packages/shiori-cli/package.json` version is `0.2.0`
- [ ] `pnpm clean && pnpm build` produces clean dist
- [ ] `npm pack --dry-run` in `packages/shiori-cli/` — verify included files are correct
- [ ] `npm publish` from `packages/shiori-cli/` (or `pnpm publish --filter @berlysia/shiori`)

## Post-Publish Verification

- [ ] `npm info @berlysia/shiori` shows version `0.2.0`
- [ ] `npx @berlysia/shiori --version` outputs `0.2.0`
- [ ] Git tag `v0.2.0` created and pushed
