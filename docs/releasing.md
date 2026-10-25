# Release Procedure

Publishing `@berlysia/shiori` to npm starts with a tag push: `release.yml` stages the tarball, and it is published only when a maintainer approves it with 2FA. See [ADR-036](decisions/036-staged-npm-publishing.md) for the background to this decision, and [ADR-037](decisions/037-changesets-and-release-command.md) for how the version is decided and how `pnpm run release` works.

## Local prerequisites

`npm trust` and `npm stage` require npm 11.15.0 or later. If your local npm is older, run them as `npx npm@11.20.0 <command>`.

## One-time migration

Do the steps in this order. The order matters.

### 1. Create the environment and the tag ruleset

Create the environment `npm` and allow only the tag pattern `v*`. Do not add required reviewers.

```bash
gh api -X PUT repos/berlysia/shiori/environments/npm \
  -F 'deployment_branch_policy[protected_branches]=false' \
  -F 'deployment_branch_policy[custom_branch_policies]=true'
gh api -X POST repos/berlysia/shiori/environments/npm/deployment-branch-policies \
  -f name='v*' -f type=tag
```

Create a ruleset that restricts creating, updating, and deleting `v*` tags to admins only. `actor_id: 5` refers to the repository admin role.

```bash
echo '{"name":"release tags","target":"tag","enforcement":"active","conditions":{"ref_name":{"include":["refs/tags/v*"],"exclude":[]}},"rules":[{"type":"creation"},{"type":"update"},{"type":"deletion"}],"bypass_actors":[{"actor_id":5,"actor_type":"RepositoryRole","bypass_mode":"always"}]}' \
  | gh api -X POST repos/berlysia/shiori/rulesets --input -
```

### 2. Add npm trust (keep the old configuration)

```bash
npm trust github @berlysia/shiori --file release.yml --repo berlysia/shiori --env npm --allow-stage-publish
npm trust list @berlysia/shiori
```

Note the id and conditions of the old configuration (`publish.yml`) from `npm trust list`.

### 3. Merge the release.yml change

### 4. Rehearse with an rc

1. Write a changeset, then on master run `pnpm run release --pre rc`. It makes a prerelease such as `0.2.2-rc.0`: the bump commit, the tag `v0.2.2-rc.0`, and the push. To rehearse the stable release afterwards, run `pnpm run release --exit-pre`.
2. When the Release workflow succeeds, do the "Checks before approval" described below, then approve and publish it as `next`. Attestations can only be checked after approval, so take the rc through to approval as well.

Treat the rc version as disposable. To retry, add a changeset and run `--pre rc` again to advance `rc.N`. The rc bump commit remains on master and is overwritten by the real bump. An approved rc remains on the `next` dist-tag (as designed).

Items to check:

- The stage is authenticated via OIDC.
- Before approval, the version does not appear in `npm view @berlysia/shiori versions`.
- After approval, `npm view @berlysia/shiori@<version> dist.integrity` matches the validate job log.
- The integrity in `npm stage view` matches the validate job log.
- The GitHub Release is created as a prerelease.

### 5. Revoke the old configuration promptly

Once the rehearsal succeeds, revoke the old trust and set Publishing access on npmjs.com to "Require two-factor authentication and disallow tokens". While the old configuration remains, the direct publish path is still live.

```bash
npm trust revoke @berlysia/shiori --id <id of the old publish.yml configuration>
```

The reason to revoke last is that if you revoke first and the rehearsal reveals a problem, you can no longer return to the old path by reverting the PR.

## Every release

1. Write a changeset in the pull request that makes a user-visible change: run `pnpm changeset`, or create `.changeset/<name>.md` by hand (format: `.changeset/README.md`). The bump level decides the next version, so nobody types a version number. Running `/changelog` in Claude Code drafts the changesets that are missing for the commits since the previous stable tag. `pnpm run check:changesets` checks them, and CI runs it too.
2. On master, run `pnpm run release` in your usual terminal. It needs a terminal on both stdin and stdout, so it stops at the entry check when started from Claude Code's `!`, which connects neither. It works in these steps:
   1. **Prerequisites**: master is checked out, clean, and equal to `origin/master` after a fetch; `.changeset/config.json` has the expected content; `npm trust list` shows exactly the one trust for `release.yml`; the `npm` environment and the `v*` tag ruleset on GitHub are as described under "One-time migration"; the changesets and the empty `[Unreleased]` block are valid; and `typecheck`, `lint`, `lint:boundaries`, `lint:envelope`, `format:check`, `build` and `test` pass. Nothing is changed in this step.
   2. **Version bump**: `changeset version` raises the version of `@berlysia/shiori` from the changesets, `packages/shiori-cli/src/core/version.ts` follows it, and for a stable release the `## [X.Y.Z] - YYYY-MM-DD` section of CHANGELOG.md is generated from the changeset text (the date is today's local date). The daemon and the VS Code extension are not released with it.
   3. **Publish preconditions**: the version is not on npm, a stable version is newer than `latest`, the tag exists neither locally nor on origin, and a stable version has a CHANGELOG section with at least one item.
   4. **Confirmation**: it prints the version, the dist-tag and the changed files, and asks `[y/N]`.
   5. **Commit and tag**: only the allowed files are committed as `chore: release vX.Y.Z` (hooks are skipped on purpose), then the annotated tag `vX.Y.Z` is made.
   6. **Push**: the GitHub protections are read once more, then `git push --atomic origin refs/heads/master:refs/heads/master refs/tags/vX.Y.Z:refs/tags/vX.Y.Z`. On success it prints that the tag was pushed; the rest is manual (below).

   What a person answers: the one-time password for `npm trust list` (choose "skip 2FA for the next 5 minutes"), and the `[y/N]` in step 4. `N` ends the run with exit code 0 and leaves the version bump in the work tree; the command that discards it is printed.
   - Prerelease: `pnpm run release --pre rc` makes `X.Y.Z-rc.N` (the first one is `X.Y.Z-rc.0`, following the changesets pre mode) from the pending changesets (the changesets and CHANGELOG.md stay as they are). `pnpm run release --exit-pre` leaves pre mode and releases the stable version, whose CHANGELOG section lists every changeset since the previous stable release.
   - The only flags are `--pre <tag>` and `--exit-pre`. Anything else, including a version, is refused before anything changes.
   - When it stops it prints the reason, the commands to try next (they are never run for you), and the section of this document to read. Run `pnpm run release` again after fixing the cause: the script decides where to continue from git, npm and the work tree, so there is no progress file.

3. The pushed tag triggers the Release workflow.

### Wait for the Release workflow

The steps from here on are manual. Automating them is on hold; see [ADR-037](decisions/037-changesets-and-release-command.md) and [docs/plans/release-approve-automation.md](plans/release-approve-automation.md).

Wait for the workflow run of the tag to finish. A version containing `-` (for example `0.3.0-rc.1`) is staged with `--tag next`, and the GitHub Release is also made a prerelease. Then continue with "Checks before approval".

### Resuming an interrupted release

`pnpm run release` reads the state again at every start and tells you what applies. The common stops:

- **The work tree holds a leftover version bump** (entry row 1): the stop lists the files. If the list is only the files of a version bump, the printed `git reset --hard HEAD && git clean -fd ...` discards them and the next run starts over. If the list has anything else, the script prints no destructive command: commit or stash your own changes first.
- **A local tag exists and origin does not have it** (row 5): the push was refused or interrupted. Either send it again with the printed `git push --atomic ...` (after checking that the tag points at HEAD), or undo with `git tag -d vX.Y.Z && git reset --hard origin/master`.
- **A release commit exists without its tag** (row 6): run `pnpm run release` with no flags. It checks that the commit is the one the script would have made, places the tag and pushes. If the check fails, it prints `git reset --hard origin/master`.
- **The tag is on origin and the version is not published** (rows 2 and 4): the release is unfinished. Row 4 asks you to `git switch --detach vX.Y.Z` first. Continue with "Wait for the Release workflow" and the sections after it.
- **The version is published** (row 3): check it with "Post-release checks".

### Verify trust and protections by hand

When the script stops because the npm trust or the GitHub protections did not match, the raw outputs it read are saved under `.tmp/release/` (the stop names the directory). Compare them with what the one-time migration set up:

```bash
npm trust list @berlysia/shiori --json
gh api --method GET repos/berlysia/shiori/environments/npm
gh api --method GET repos/berlysia/shiori/environments/npm/deployment-branch-policies
gh api --method GET repos/berlysia/shiori/rulesets
```

Expected: exactly one trust (`github`, `release.yml`, `berlysia/shiori`, environment `npm`, permission `createStagedPackage`); the environment allows custom branch policies only, with the single policy `v*` of type `tag`; and an active tag ruleset on `refs/tags/v*` (no exclusions) that blocks creation, update and deletion, with only the repository admin role able to bypass. Fix the setting, then run `pnpm run release` again.

### Checks before approval

With the automatic stage triggered by a tag, this is the only content check by a human.

```bash
npm stage list @berlysia/shiori
npm stage view <id>
npm stage download <id>
```

Check the following.

- The version matches the tag.
- The file list contains nothing unexpected.
- The integrity matches the "Print tarball integrity" log line of the validate job.

### Approval

```bash
npm stage approve <id>
```

It asks for 2FA. You can also approve from the npmjs.com UI.

Right after staging, you cannot approve until npm's automated review (malware scan) finishes, and you get `E409 ... can't be approved yet because automated review hasn't finished`. Wait a few minutes and run it again.

### Post-release checks

```bash
npm view @berlysia/shiori dist-tags
npm view @berlysia/shiori@<version> dist.integrity
```

Provenance (`dist.attestations`) is not generated while the repository is private. After making it public, check that it is attached with `npm view @berlysia/shiori@<version> dist.attestations`.

## Handling failures

- **Only npm-stage failed**: confirm with `npm stage list @berlysia/shiori` that it has not been staged, then re-run the failed job of that run. Artifacts are retained for 7 days; after that you cannot re-run.
- **The workflow needs a fix**: a re-run uses the definition at the tag's commit. To use the fixed workflow, bump the patch version and release again with a new tag. The GitHub Release for each tag remains as a separate entity.
- **Staged by mistake**: `npm stage reject <id>`.
- **A mistaken publish is found after approval**: `npm deprecate @berlysia/shiori@<version> "<reason>"`.
