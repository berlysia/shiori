// The entry decision of `pnpm run release`: which of the flows below applies,
// given what git, npm and changesets report. Pure; the rows are the table in
// the design (K5) and are evaluated top to bottom, first match wins.
import { isBumpResidue, IGNORED_PACKAGE_DIRS } from './allowlist.ts';
import { SECTIONS } from './stop-report.ts';
import type { ValidVersion } from './semver.ts';
import type { Flags, Observed, WorkingChange } from './types.ts';

// What `npm view @berlysia/shiori versions --json` and `dist-tags --json` say.
// `unpublished` is E404: the package has never been published.
export type NpmState =
  | {
      readonly kind: 'published';
      readonly versions: readonly string[];
      readonly distTags: Readonly<Record<string, string>>;
    }
  | { readonly kind: 'unpublished' }
  | { readonly kind: 'failed'; readonly error: string };

export function isVersionPublished(npm: NpmState, version: string): boolean {
  return npm.kind === 'published' && npm.versions.includes(version);
}

export type StatusObservation =
  | { readonly kind: 'release'; readonly version: string }
  | { readonly kind: 'none' }
  | { readonly kind: 'failed'; readonly error: string };

export interface EntryObservation {
  readonly flags: Flags;
  readonly head: string;
  readonly headMessage: string;
  readonly workingTree: readonly WorkingChange[];
  // the version in packages/shiori-cli/package.json
  readonly version: Observed<ValidVersion>;
  // the commit of local tag v<version>, if any
  readonly localTag: string | undefined;
  // the commit of tag v<version> on origin, if any
  readonly originTag: Observed<string | undefined>;
  readonly npm: NpmState;
  readonly preMode: boolean;
}

export type EntryDecision =
  | { readonly kind: 'front'; readonly row: 7 | 8 }
  | { readonly kind: 'resume-tag' }
  | { readonly kind: 'after-push' }
  | { readonly kind: 'check-only' }
  | { readonly kind: 'need-status' }
  | {
      readonly kind: 'stop';
      readonly row: number;
      readonly reason: string;
      readonly commands: readonly string[];
      readonly section: string;
      readonly detail?: readonly string[];
    };

type Stop = Extract<EntryDecision, { kind: 'stop' }>;

function stop(
  row: number,
  reason: string,
  commands: readonly string[] = [],
  section: string = SECTIONS.resume,
  detail?: readonly string[],
): Stop {
  return {
    kind: 'stop',
    row,
    reason,
    commands,
    section,
    ...(detail === undefined ? {} : { detail }),
  };
}

const MAX_DETAIL_LINES = 20;

export const RESET_COMMAND = `git reset --hard HEAD && git clean -fd .changeset ${IGNORED_PACKAGE_DIRS.join(' ')}`;

// The two ways out of a tag that exists only locally (row 5), also shown when
// the push of stage 6 is refused. Nothing here is run for the person.
export function pushRetryCommands(version: ValidVersion): string[] {
  const tag = `v${version}`;
  return [
    `test "$(git rev-parse ${tag}^{commit})" = "$(git rev-parse HEAD)" && git push --atomic origin refs/heads/master:refs/heads/master refs/tags/${tag}:refs/tags/${tag}`,
    `git tag -d ${tag} && git reset --hard origin/master`,
  ];
}

export interface DirtyAdvice {
  readonly reason: string;
  readonly commands: readonly string[];
  readonly detail: readonly string[];
}

// What to tell a person whose working tree is dirty. The destructive reset is
// offered only when every change is what an interrupted version bump leaves;
// anything else may be their own work, and is never listed for discarding.
export function adviseOnDirtyTree(
  workingTree: readonly WorkingChange[],
): DirtyAdvice {
  const detail = workingTree
    .slice(0, MAX_DETAIL_LINES)
    .map((change) => `${change.state} ${change.path}`);
  if (workingTree.length > MAX_DETAIL_LINES) {
    detail.push(`... and ${workingTree.length - MAX_DETAIL_LINES} more`);
  }
  if (workingTree.every(isBumpResidue)) {
    return {
      reason:
        'the working tree holds what an interrupted version bump left. The command below discards ALL uncommitted changes in the working tree, so read the list first',
      commands: [RESET_COMMAND],
      detail,
    };
  }
  return {
    reason:
      'the working tree has changes that are not a leftover version bump; commit or stash them, then rerun',
    commands: ['git status --short'],
    detail,
  };
}

function describeDirty(workingTree: readonly WorkingChange[]): Stop {
  const advice = adviseOnDirtyTree(workingTree);
  return stop(
    1,
    advice.reason,
    advice.commands,
    SECTIONS.resume,
    advice.detail,
  );
}

// Rows 0 to 7, and the part of row 8 onward that needs no status. Returns
// need-status when only `changeset status` can say more (rows 3 and 8 to 11).
export function decideEntry(
  observed: EntryObservation,
  status?: StatusObservation,
): EntryDecision {
  // row 0: an observation failed
  if (observed.version.kind === 'error') {
    return stop(
      0,
      'the package version could not be read',
      [],
      SECTIONS.resume,
      [observed.version.error],
    );
  }
  if (observed.originTag.kind === 'error') {
    return stop(
      0,
      'git ls-remote failed; cannot tell whether the tag is on origin',
      [],
      SECTIONS.resume,
      [observed.originTag.error],
    );
  }
  if (observed.npm.kind === 'failed') {
    return stop(
      0,
      'npm view failed; cannot tell whether the version is published',
      [],
      SECTIONS.resume,
      [observed.npm.error],
    );
  }
  const version = observed.version.value;
  const tag = `v${version}`;
  const originCommit = observed.originTag.value;
  const published = isVersionPublished(observed.npm, version);
  const { flags, head, localTag } = observed;

  // row 1: before any other row, so a dirty tree never reaches a push command
  if (observed.workingTree.length > 0)
    return describeDirty(observed.workingTree);

  if (originCommit !== undefined && !published) {
    // row 2
    if (originCommit === head) return { kind: 'after-push' };
    // row 4
    return stop(
      4,
      `release ${tag} is unfinished: the tag is on origin at another commit and ${version} is not published`,
      [`git switch --detach ${tag}`, 'pnpm run release'],
    );
  }
  // row 3: published, so the tag is only worth looking at with no flags
  if (originCommit !== undefined && published && flags.mode === 'normal') {
    if (status === undefined) return { kind: 'need-status' };
    if (status.kind === 'none') return { kind: 'check-only' };
    // a release in status: a new one is pending, so row 8 below decides
  }
  // row 5
  if (originCommit === undefined && localTag !== undefined) {
    return stop(
      5,
      `local tag ${tag} exists but origin does not have it: the push was refused or interrupted`,
      pushRetryCommands(version),
    );
  }
  // row 6
  if (
    originCommit === undefined &&
    localTag === undefined &&
    !published &&
    observed.headMessage === `chore: release ${tag}`
  ) {
    if (flags.mode !== 'normal') {
      return stop(
        6,
        'a release commit is waiting for its tag (resuming): rerun without flags',
        ['pnpm run release'],
      );
    }
    return { kind: 'resume-tag' };
  }
  // row 7
  if (flags.mode !== 'normal') return { kind: 'front', row: 7 };

  // rows 8 to 11 read `changeset status`
  if (status === undefined) return { kind: 'need-status' };
  if (status.kind === 'failed') {
    return stop(11, 'changeset status failed', [], SECTIONS.resume, [
      status.error,
    ]);
  }
  if (status.kind === 'release') return { kind: 'front', row: 8 };
  if (observed.preMode) {
    return stop(
      9,
      'in pre mode and every changeset is already consumed: add a changeset, or release the stable version with --exit-pre',
      ['pnpm run release --exit-pre'],
      SECTIONS.everyRelease,
    );
  }
  return stop(
    10,
    'there is nothing to release: no pending changeset',
    [],
    SECTIONS.everyRelease,
  );
}
