# Automate the back half of `pnpm run release` (run wait to post-publish checks)

`pnpm run release` runs through the tag push. The steps after it are manual: waiting for the Release run, checking the staged tarball, `npm stage approve`, and the post-publish checks (`docs/releasing.md`, from "Wait for the Release workflow"). The reasoning behind the split, and why this part is on hold, is in [ADR-037](../decisions/037-changesets-and-release-command.md).

## Start condition

Start after the front half (stages 1 to 6) has gone through a real release up to the push. Decide then whether to split `release.ts` (1226 lines when the front half was finished, over the planned 800-line threshold) into one file per stage before adding the back half.

## Work

1. **`release.yml`**: in the validate job, replace the "Print tarball integrity" step with a "Print the release manifest" step. Compute sha512 from the uploaded tgz and write `## Release manifest`, `- tag:`, `- version:`, `- distTag:`, one blank line, and a one-row `| # | name | file | integrity |` table to stdout and `$GITHUB_STEP_SUMMARY`. Give the jobs the display names `Validate and pack`, `Stage on npm` and `GitHub Release`. Do not add a `manifest.json` to the artifact. The dist-tag stays derived from the tag name in the npm-stage shell step; a structural test fixes that `v1.0.0` gives `latest` and `v1.0.0-rc.0` and `v1.0.0-beta.2` give `next`.
2. **`scripts/release/print-manifest.ts`**: the entry point that formats the manifest, using the same lib functions as the back-half parser.
3. **`scripts/release/workflow-structure.test.ts`**: fix job and step names, the manifest format, the dist-tag derivation, the permissions of each job (only npm-stage has `id-token: write`), `persist-credentials: false`, and action SHA pins.
4. **Back half in `enterAfterPush` (`scripts/release/release-after-push.ts`)**: replace the temporary stops of entry rows 2 and 3.
   - Verify the commit of tag `vV` again on resume: equal to HEAD, equal to or an ancestor of origin/master, message `chore: release vV`, diff against the parent inside the allowlist, `package.json` version V.
   - Select the Release run with `gh run list --workflow release.yml --commit <sha> --event push`. Wait up to 3 minutes for zero results, stop on two or more, use `gh run watch` while it runs, and detect re-runs by `run_attempt` and the set of job ids.
   - Select the log section by step and by the exact line `## Release manifest`; zero, two or more matches, or a wrong format, is a shape mismatch.
   - Select the stage from `npm stage list @berlysia/shiori --json`: exactly one item with the matching name and version, a UUID id and the expected `tag`. Zero waits; two or more stop; a missing `tag` is a shape mismatch.
   - Check the downloaded tarball: sha512 equal to the log, one gzip member, regular files and directories only under `package/`, files limited to `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md` and `dist/src/**`, and `name`, `version`, `bin`, `dependencies` and `engines` equal to the tag commit's `packages/shiori-cli/package.json` with no install lifecycle script.
   - Re-check trust, print the run URL, version, dist-tag, stage id and integrity, and ask y/N. `N` and EOF exit 0. On `y`, re-read that the stage is still `staged` with the same integrity, then run `npm stage approve <id>` on the TTY. Retry every 30 seconds up to 20 times only on `E409`, reading the published state before each retry.
   - Post-publish checks: `dist-tags[dist-tag] === V`, `dist.integrity` equal to the log, `dist.attestations` subject digest equal to the log when present, and `gh release view vV`. Re-read every 30 seconds for up to 5 minutes, and do not undo the publish on a mismatch.
5. **Exit codes of entry rows 2 and 3**: decide them again when the temporary stops are replaced.
6. **Trust re-check at stage 9**: when it returns `eotp`, the stage stays on npm and re-running `pnpm run release` returns to stage 9. Write this into the user-facing message.
7. **Provenance note in `docs/releasing.md`**: "Provenance is not generated while the repository is private" has not been confirmed against the repository's current visibility and an actual release. Confirm it and fix the note.

## Trust criterion for the back half

Until the back half has passed one stable release through the post-publish check with no mismatch, keep the manual steps in `docs/releasing.md` as the source of truth. On the first release, answer `N` at the approve prompt, compare the script's result with the manual comparison, and re-run to approve only when they agree.
