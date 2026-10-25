# Take the release version from CHANGELOG.md instead of bumpp's prompt

A stable release enters the version twice. The `/changelog` step writes `## [X.Y.Z] - YYYY-MM-DD` into CHANGELOG.md, and then bumpp asks for the version again in an interactive prompt. `packages/shiori-cli/scripts/check-changelog.ts` runs through bumpp's `--execute` and checks afterwards that the two values match. The version has two sources, and the guard only ties them together after the fact.

## Direction (option A, not decided)

The `release` script reads the first `## [X.Y.Z]` heading below `## [Unreleased]` and uses it as the version. It rewrites the version files, commits, tags, and pushes without a prompt. A prerelease takes an argument such as `--preid rc` and derives `X.Y.Z-rc.N` from the same heading. The guard then reduces to "stop when there is no heading".

Rejected for now:

- changesets: adds a changeset file per change and duplicates the `/changelog` drafting from commit bodies.
- release-please: picks the bump from commit types, so a human cannot choose it (0.2.2 required Node 22 but shipped as a patch). It also does not do the user-visible-only cut that `/changelog` does.

## Check before replacing bumpp

List what bumpp 12.3.0 does in `pnpm run release` today, so that nothing is lost when it is replaced:

- which files it rewrites (`packages/shiori-cli/package.json`, `packages/shiori-cli/src/core/version.ts`) and how it finds the version string in `version.ts`
- the commit message (`chore: release vX.Y.Z`), the tag name, and whether the tag is annotated or signed
- push behavior: the remote, the branch, `--follow-tags` or separate pushes
- when `--execute` runs relative to the file rewrite and the commit, and what happens to the working tree when it fails
- checks it makes before bumping (clean working tree, current branch) and its defaults when no config file exists (this repo has none)
- how it numbers prereleases (`--preid rc` → `X.Y.Z-rc.N`)

The release workflow and the npm stage flow (`docs/releasing.md`, ADR-036) depend on the tag name and the version in `package.json`. They should not need changes, but check them against the new script.

## Reduce the approval step to the 2FA prompt

After the tag push, a human still waits for npm's automated review and compares values by hand before `npm stage approve`. The approval itself stays: it is the only human gate from ADR-036, so a hijacked tag push cannot publish without 2FA. Everything before it can be one command (for example `pnpm release:approve`):

1. Find the stage id for the tag's version in `npm stage list @berlysia/shiori`.
2. Read the integrity from the "Print tarball integrity" line of the validate job log (`gh run view --log`), and compare it, the version, and the file list with `npm stage view <id>`.
3. While approve returns `E409 ... automated review hasn't finished`, wait and retry.
4. Run `npm stage approve <id>` only when every comparison matches; otherwise stop and print the mismatch.

Check before writing it: whether `npm stage view` output is stable enough to parse (or has a JSON mode), and how many minutes the automated review usually takes.

## Related

- The master ruleset (required checks `check` and `compat`) lets the admin role bypass it so that the release push to master goes through. A script that replaces bumpp keeps the same push path.
