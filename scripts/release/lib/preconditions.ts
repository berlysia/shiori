// Judgements the front half makes between its steps: what `changeset status`
// means, whether the version bump came out right, whether the release is
// publishable (stage 3), and whether an interrupted release commit is the
// one this script would have made (entry row 6). Each returns reasons; an
// empty list is a pass.
import {
  findViolations,
  isSectionInsertionDiff,
  isVersionLineOnlyDiff,
  isVersionOnlyPackageDiff,
} from './allowlist.ts';
import {
  hasChangelogItems,
  hasChangelogSection,
} from '../../../packages/shiori-cli/scripts/check-changelog.ts';
import {
  isVersionPublished,
  type NpmState,
  type StatusObservation,
} from './entry.ts';
import { PACKAGE_NAME } from './changeset.ts';
import { compareVersions, parseVersion, type ValidVersion } from './semver.ts';
import type { ChangeEntry } from './types.ts';

// `changeset status --output` JSON. Exactly one release must be live: a
// non-`none` `@berlysia/shiori`. Releases of names in the config `ignore` list
// are skipped only when they carry no changeset: changesets 2.29.8 lists an
// ignored package as a changeset-less patch after `pre exit`, and the files it
// would change are undone after `changeset version` and held to the allow
// list. An ignored name with a changeset behind it means the ignore list is
// not in effect, and any other live name is a release nobody asked for.
export function parseStatus(
  text: string,
  ignoredNames: readonly string[],
): StatusObservation {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { kind: 'failed', error: 'changeset status output is not JSON' };
  }
  const releases =
    typeof json === 'object' && json !== null
      ? (json as { releases?: unknown }).releases
      : undefined;
  if (!Array.isArray(releases)) {
    return { kind: 'failed', error: 'changeset status has no "releases" list' };
  }
  let shiori: string | undefined;
  let liveShiori = false;
  for (const release of releases as unknown[]) {
    if (typeof release !== 'object' || release === null) {
      return {
        kind: 'failed',
        error: 'a release in changeset status is not an object',
      };
    }
    const { name, type, newVersion, changesets } = release as Record<
      string,
      unknown
    >;
    if (
      typeof name !== 'string' ||
      typeof type !== 'string' ||
      typeof newVersion !== 'string'
    ) {
      return {
        kind: 'failed',
        error: 'a release in changeset status lacks name, type or newVersion',
      };
    }
    if (type === 'none') continue;
    if (name === PACKAGE_NAME) {
      if (liveShiori) {
        return {
          kind: 'failed',
          error: `changeset status lists ${PACKAGE_NAME} twice`,
        };
      }
      liveShiori = true;
      shiori = newVersion;
    } else if (ignoredNames.includes(name)) {
      if (!Array.isArray(changesets) || changesets.length !== 0) {
        return {
          kind: 'failed',
          error: `changeset status releases the ignored package ${name} with changesets behind it: the ignore list is not in effect`,
        };
      }
    } else {
      return {
        kind: 'failed',
        error: `changeset status releases ${name}, which is neither ${PACKAGE_NAME} nor in the ignore list`,
      };
    }
  }
  return shiori === undefined
    ? { kind: 'none' }
    : { kind: 'release', version: shiori };
}

// After `changeset version`: package.json says the version status announced,
// and pre mode is on exactly for a prerelease.
export function checkVersionApplied(input: {
  readonly expected: ValidVersion;
  readonly actual: string;
  readonly preMode: boolean;
}): string[] {
  const reasons: string[] = [];
  if (input.actual !== input.expected) {
    reasons.push(
      `package.json says ${input.actual} but changeset status announced ${input.expected}`,
    );
  }
  const prerelease = input.expected.includes('-');
  if (prerelease !== input.preMode) {
    reasons.push(
      prerelease
        ? `${input.expected} is a prerelease but pre mode is off`
        : `${input.expected} is stable but pre mode is on`,
    );
  }
  return reasons;
}

export interface PublishInput {
  readonly version: ValidVersion;
  readonly changelog: string;
  readonly npm: NpmState;
  readonly localTag: string | undefined;
  readonly originTag: string | undefined;
}

// Stage 3, and again on a resume from row 6.
export function checkPublishable(input: PublishInput): string[] {
  const { version } = input;
  const reasons: string[] = [];
  const stable = !version.includes('-');
  if (stable) {
    if (!hasChangelogSection(input.changelog, version)) {
      reasons.push(
        `CHANGELOG.md has no "## [${version}] - YYYY-MM-DD" section`,
      );
    } else if (!hasChangelogItems(input.changelog, version)) {
      reasons.push(`the CHANGELOG.md section for ${version} has no "- " item`);
    }
  }
  if (input.npm.kind === 'failed') {
    reasons.push(
      'npm view failed; cannot tell whether the version is published',
    );
  } else if (isVersionPublished(input.npm, version)) {
    reasons.push(`${version} is already published on npm`);
  } else if (stable && input.npm.kind === 'published') {
    const latest = input.npm.distTags['latest'];
    const parsed = latest === undefined ? undefined : parseVersion(latest);
    if (parsed?.ok && compareVersions(version, parsed.version) <= 0) {
      reasons.push(
        `${version} is not newer than the latest dist-tag ${latest}`,
      );
    }
  }
  if (input.localTag !== undefined)
    reasons.push(`tag v${version} already exists locally`);
  if (input.originTag !== undefined)
    reasons.push(`tag v${version} already exists on origin`);
  return reasons;
}

export interface ResumeInput {
  readonly version: ValidVersion;
  readonly headMessage: string;
  readonly headParent: string | undefined;
  readonly originMaster: string | undefined;
  // the version in HEAD's package.json
  readonly headPackageVersion: string;
  // the diff of HEAD against its parent (git diff-tree)
  readonly headChanges: readonly ChangeEntry[];
  readonly packageJson: {
    readonly before: string | undefined;
    readonly after: string | undefined;
  };
  readonly versionTs: {
    readonly before: string | undefined;
    readonly after: string | undefined;
  };
  // only read for a stable version
  readonly changelog: {
    readonly before: string | undefined;
    readonly after: string | undefined;
  };
}

// Entry row 6: a release commit exists but its tag does not. The state could
// have been made by anything that can write to the repository, so the commit
// is held to the same shape stage 2 produces before the tag is placed on it.
export function checkResume(input: ResumeInput): string[] {
  const reasons: string[] = [];
  const stable = !input.version.includes('-');
  if (
    input.headParent === undefined ||
    input.headParent !== input.originMaster
  ) {
    reasons.push('the parent of HEAD is not origin/master');
  }
  if (input.headMessage !== `chore: release v${input.version}`) {
    reasons.push('the HEAD commit message does not name this version');
  }
  if (input.headPackageVersion !== input.version) {
    reasons.push(
      `package.json at HEAD says ${input.headPackageVersion}, not ${input.version}`,
    );
  }
  for (const violation of findViolations(
    input.headChanges,
    stable ? 'stable' : 'prerelease',
  )) {
    reasons.push(
      `the release commit contains a change outside the allow list: ${violation}`,
    );
  }
  const touched = (path: string) =>
    input.headChanges.some((change) => change.path === path);
  if (
    touched('packages/shiori-cli/package.json') &&
    !isVersionOnlyPackageDiff(input.packageJson.before, input.packageJson.after)
  ) {
    reasons.push('package.json changed in more than its version');
  }
  if (
    touched('packages/shiori-cli/src/core/version.ts') &&
    !isVersionLineOnlyDiff(input.versionTs.before, input.versionTs.after)
  ) {
    reasons.push('version.ts changed in more than its VERSION line');
  }
  if (stable) {
    const heading = `## [${input.version}] - `;
    if (
      !isSectionInsertionDiff(input.changelog.before, input.changelog.after) ||
      !(input.changelog.after ?? '').includes(`\n${heading}`)
    ) {
      reasons.push(
        'CHANGELOG.md changed in more than one new section for this version',
      );
    }
  }
  return reasons;
}
