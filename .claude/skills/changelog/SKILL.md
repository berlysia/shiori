---
name: changelog
description: Draft the CHANGELOG.md section for an upcoming stable release of @berlysia/shiori from the commits since the last stable tag, reading commit bodies for user impact. Use before `pnpm run release` for a non-prerelease version, when the user says "/changelog 0.2.2", "CHANGELOG を書いて", or when the release guard reports a missing section. Do NOT use for rc/beta prereleases, which need no section.
---

# Draft a CHANGELOG section

`pnpm run release` stops before the release commit when CHANGELOG.md has no `## [X.Y.Z] - YYYY-MM-DD` section for a stable version (`packages/shiori-cli/scripts/check-changelog.ts`). This skill writes that section. The user reviews it and commits it before releasing.

## Inputs

- Target version: from the argument (`/changelog 0.2.2`). If absent, ask. It must not contain `-`; prereleases need no section.
- Base: the latest stable tag, `git tag --list 'v*' --sort=-v:refname | grep -v -- - | head -1`. Prerelease tags are skipped, so a stable section covers every change since the previous stable release, including what shipped in its rc/beta builds.

## Steps

1. Read every commit in `<base>..HEAD` with its full body: `git log --format='%H%n%s%n%b%n----' <base>..HEAD`. The bodies carry `intent:`, `decision:`, `constraint:`, and `learned:` lines that state user impact the subject omits.
2. Keep only changes a user of the published package can observe:
   - CLI behavior, output formats, exit codes, flags, and messages
   - files that `shiori init` generates, and the composite action under `actions/`
   - package requirements: Node.js, VS Code engine, peer tools
   - security fixes
3. Drop the rest without listing it: observatory snapshots, formatting, the repo's own CI and release tooling, dev dependencies, internal refactors, and test-only changes. When unsure, read the diff (`git show <sha>`) and keep the entry only if a user would notice it.
4. Write the section in English, in the style of the existing sections:
   - Heading `## [X.Y.Z] - <today, YYYY-MM-DD>`, inserted directly below `## [Unreleased]`. Move any entries already under `[Unreleased]` into it.
   - Subsections in this order, only those that have entries: `### Breaking Changes`, `### Added`, `### Changed`, `### Deprecated`, `### Removed`, `### Fixed`, `### Security`.
   - One bullet per change. Say what changed for the user and what they may need to do. Put requirements that can break a setup (a higher minimum version, a newer runner) under Breaking Changes or Changed with the concrete version.
   - Cite ADR numbers when a commit names one. Do not cite commit hashes.
5. Show the user the inserted section and the commits you dropped, grouped by reason, so they can check the cut. Do not commit unless the user asks. The release guard only checks that the heading exists.
