# Release Procedure

Publishing `@berlysia/shiori` to npm starts with a tag push: `release.yml` stages the tarball, and it is published only when a maintainer approves it with 2FA. See [ADR-036](decisions/036-staged-npm-publishing.md) for the background to this decision.

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

1. On master, run `pnpm run release --preid rc` and choose a prerelease such as `0.2.2-rc.1`. This performs the bump commit, the tag `v0.2.2-rc.1`, and the push.
2. When the Release workflow succeeds, do the "Checks before approval" described below, then approve and publish it as `next`. Attestations can only be checked after approval, so take the rc through to approval as well.

Treat the rc version as disposable. To retry, advance `rc.N`. The rc bump commit remains on master and is overwritten by the real bump. An approved rc remains on the `next` dist-tag (as designed).

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

1. For a stable release (a version without `-`), first write a `## [X.Y.Z] - YYYY-MM-DD` section in CHANGELOG.md and commit it. Running `/changelog X.Y.Z` in Claude Code reads the commits since the previous stable tag, including their bodies, and drafts only the user-visible changes. Check the content before committing. It is not needed for prereleases.
2. On master, run `pnpm run release`. After passing the quality checks, build, and tests, [bumpp](https://github.com/antfu-collective/bumpp) interactively asks for the next version and rewrites `packages/shiori-cli/package.json` and `packages/shiori-cli/src/core/version.ts`. Next, it checks whether the section for a stable release exists in CHANGELOG.md. If the section is missing, it stops before committing and prints the command to revert the bump. Once the check passes, it commits (`chore: release vX.Y.Z`), creates the tag `vX.Y.Z`, and pushes. bumpp does not publish to npm.
   - Create a prerelease with `pnpm run release --preid rc` (for example `0.2.2-rc.1`).
   - The pushed tag triggers the Release workflow. The tag is created from the version, so it does not diverge from the validate match check.
3. Wait for the Release workflow to finish. A version containing `-` (for example `0.3.0-rc.1`) is staged with `--tag next`, and the GitHub Release is also made a prerelease.

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
