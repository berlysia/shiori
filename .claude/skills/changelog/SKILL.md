---
name: changelog
description: Draft changesets for the user-visible changes of @berlysia/shiori that have none yet, from the commits since the last stable tag, reading commit bodies for user impact. Use before `pnpm run release`, when the user says "/changelog", "changeset を書いて", "CHANGELOG を書いて", or when `pnpm run check:changesets` or the release stops because a change has no changeset. Takes no version argument. Do NOT use to edit CHANGELOG.md itself; `pnpm run release` generates its sections.
---

# Draft changesets

`pnpm run release` picks the next version from the pending changesets in `.changeset/` and generates the `## [X.Y.Z] - YYYY-MM-DD` section of CHANGELOG.md from their text. Nobody types a version. This skill writes the changesets that are missing: for every user-visible change since the last stable tag that has no changeset, it drafts one. The user reviews the drafts and commits them.

## Inputs

- No version argument. The version follows from the bump levels in the changesets. If the user passes a version anyway, say that it is not used, then continue.
- Base: the latest stable tag, `git tag --list 'v*' --sort=-v:refname | grep -v -- - | head -1`. Prerelease tags are skipped, so the changes cover everything since the previous stable release, including what shipped in its rc/beta builds.
- The format: read `.changeset/README.md` first. It is the contract that `pnpm run check:changesets` enforces.

## Steps

1. Read every commit in `<base>..HEAD` with its full body: `git log --format='%H%n%s%n%b%n----' <base>..HEAD`. The bodies carry `intent:`, `decision:`, `constraint:`, and `learned:` lines that state user impact the subject omits.
2. Read the changesets already in `.changeset/` and keep a change out of the drafts when one of them already describes it.
3. Keep only changes a user of the published package can observe:
   - CLI behavior, output formats, exit codes, flags, and messages
   - files that `shiori init` generates, the composite action under `actions/`, and the VS Code extension
   - package requirements: Node.js, VS Code engine, peer tools
   - security fixes
4. Drop the rest without listing it: observatory snapshots, formatting, the repo's own CI and release tooling, dev dependencies, internal refactors, and test-only changes. When unsure, read the diff (`git show <sha>`) and keep the entry only if a user would notice it.
5. Write one changeset per change or per closely related group, as `.changeset/<two-or-three-lowercase-words>.md`, in English:
   - Frontmatter: exactly `"@berlysia/shiori": patch|minor|major`. Choose the level the change deserves; a requirement that can break a setup (a higher minimum Node.js) is at least `minor`, or `major` after 1.0.
   - Body: `### <heading>` lines and `- ` entries only. Headings, in this order when several are used: `Breaking Changes`, `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`. Each heading has at least one entry, and appears once per file.
   - One entry is one line. Say what changed for the user and what they may need to do. Put requirements that can break a setup under `Breaking Changes` or `Changed` with the concrete version.
   - Cite ADR numbers when a commit names one. Do not cite commit hashes.
6. Run `pnpm run check:changesets`. Fix what it reports.
7. Show the user the drafts and the commits you dropped, grouped by reason, so they can check the cut. Do not commit unless the user asks.
