// The set of changes a release commit may contain, the restore of packages
// that changeset's `ignore` should have skipped, and the pre mode commands.
// Pure: git output is parsed elsewhere (observe.ts) and applied elsewhere
// (release.ts); the one function that takes a file system (removeUntracked)
// takes it as an argument.
import { posix } from 'node:path';
import type { ChangeEntry, ChangeState, FsApi, Flags } from './types.ts';

export const PACKAGE_JSON = 'packages/shiori-cli/package.json';
export const VERSION_TS = 'packages/shiori-cli/src/core/version.ts';
export const CHANGELOG = 'CHANGELOG.md';
export const PRE_JSON = '.changeset/pre.json';
// The directories of the packages in .changeset/config.json "ignore". The
// config is checked against its expected value in stage 1, so these cannot
// drift from it unnoticed.
export const IGNORED_PACKAGE_DIRS: readonly string[] = [
  'packages/shiori-daemon',
  'packages/shiori-vscode',
];

const CHANGESET_FILE = /^\.changeset\/([a-z0-9-]+)\.md$/;

export type ReleaseKind = 'stable' | 'prerelease';

function isChangesetFile(path: string): boolean {
  return CHANGESET_FILE.test(path) && path !== '.changeset/README.md';
}

// Why a change is outside the allow list, or undefined when it is allowed.
export function violationOf(
  change: ChangeEntry,
  kind: ReleaseKind,
): string | undefined {
  const { path, state } = change;
  const stable = kind === 'stable';
  const allowed =
    (path === PACKAGE_JSON && state === 'M') ||
    (path === VERSION_TS && state === 'M') ||
    (path === CHANGELOG && state === 'M' && stable) ||
    (isChangesetFile(path) && state === 'D' && stable) ||
    // '??': a new pre.json is untracked until it is staged
    (path === PRE_JSON &&
      (state === 'A' || state === 'M' || state === 'D' || state === '??'));
  return allowed ? undefined : `${state} ${path}`;
}

export function findViolations(
  changes: readonly ChangeEntry[],
  kind: ReleaseKind,
): string[] {
  return changes.flatMap((change) => {
    const violation = violationOf(change, kind);
    return violation === undefined ? [] : [violation];
  });
}

// ---------------------------------------------------------------------------
// ignored packages
// ---------------------------------------------------------------------------

export interface RestorePlan {
  readonly checkout: string[];
  readonly remove: string[];
}

function insideDir(path: string, dir: string): boolean {
  // Normalized, so "packages/shiori-daemon/../../x" is outside; the raw `..`
  // check keeps a path that merely normalizes back inside out of the plan.
  if (path.split('/').includes('..')) return false;
  const normalized = posix.normalize(path);
  return normalized.startsWith(`${dir}/`);
}

export function planIgnoredRestore(
  changes: readonly ChangeEntry[],
  dirs: readonly string[] = IGNORED_PACKAGE_DIRS,
): RestorePlan {
  const checkout: string[] = [];
  const remove: string[] = [];
  for (const change of changes) {
    if (!dirs.some((dir) => insideDir(change.path, dir))) continue;
    if (change.state === '??') remove.push(change.path);
    else if (change.state === 'M' || change.state === 'D') {
      checkout.push(change.path);
    }
  }
  return { checkout, remove };
}

// The planned changes are gone after the restore; what is left is checked
// against the allow list.
export function afterRestore(
  changes: readonly ChangeEntry[],
  plan: RestorePlan,
): ChangeEntry[] {
  const restored = new Set([...plan.checkout, ...plan.remove]);
  return changes.filter((change) => !restored.has(change.path));
}

export type RemoveResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

// Removes one untracked file below an ignored package directory. The path
// comes from git, but a symlink in the way would turn this into deleting
// something outside the repository, so the file's own type and the real
// location of its parent are checked right before the removal.
export async function removeUntracked(
  fs: FsApi,
  root: string,
  relativePath: string,
  dir: string,
): Promise<RemoveResult> {
  const absolute = posix.join(root, relativePath);
  const stat = await fs.lstat(absolute);
  if (stat === undefined) return { ok: true };
  if (stat.isSymbolicLink) {
    return { ok: false, reason: 'refused to remove a symlink' };
  }
  if (!stat.isFile) return { ok: false, reason: 'not a regular file' };
  const realDir = await fs.realpath(posix.join(root, dir));
  const realParent = await fs.realpath(posix.dirname(absolute));
  if (realParent !== realDir && !realParent.startsWith(`${realDir}/`)) {
    return { ok: false, reason: 'resolves outside the package directory' };
  }
  await fs.rm(absolute);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// commit gates
// ---------------------------------------------------------------------------

// The state a working tree change has once staged: untracked becomes added.
function stagedForm(change: ChangeEntry): ChangeEntry {
  return change.state === '??' ? { path: change.path, state: 'A' } : change;
}

const key = (change: ChangeEntry): string => `${change.state} ${change.path}`;

export interface SetComparison {
  readonly same: boolean;
  readonly missing: string[];
  readonly extra: string[];
}

// `expected` is in working tree form; `actual` is what git reports staged or
// committed. The comparison is of whole sets, so a missing change fails as
// well as an extra one.
export function compareChangeSets(
  actual: readonly ChangeEntry[],
  expected: readonly ChangeEntry[],
): SetComparison {
  const actualKeys = new Set(actual.map(key));
  const expectedKeys = new Set(expected.map(stagedForm).map(key));
  const missing = [...expectedKeys].filter((item) => !actualKeys.has(item));
  const extra = [...actualKeys].filter((item) => !expectedKeys.has(item));
  return { same: missing.length === 0 && extra.length === 0, missing, extra };
}

// ---------------------------------------------------------------------------
// pre mode
// ---------------------------------------------------------------------------

export interface PreState {
  readonly active: boolean;
  readonly tag?: string;
}

export type PrePlan =
  | { readonly ok: true; readonly commands: string[][] }
  | { readonly ok: false; readonly reason: string };

export function planPreCommands(pre: PreState, flags: Flags): PrePlan {
  if (flags.mode === 'normal') return { ok: true, commands: [] };
  if (flags.mode === 'exit-pre') {
    return pre.active
      ? { ok: true, commands: [['exit']] }
      : { ok: false, reason: '--exit-pre needs pre mode, which is not active' };
  }
  if (!pre.active) return { ok: true, commands: [['enter', flags.tag]] };
  if (pre.tag === flags.tag) return { ok: true, commands: [] };
  return {
    ok: true,
    commands: [['exit'], ['enter', flags.tag]],
  };
}

// ---------------------------------------------------------------------------
// content judges: is a change what a version bump writes, and nothing else?
// ---------------------------------------------------------------------------

function parseObject(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

// package.json differs from the base in `version` only.
export function isVersionOnlyPackageDiff(
  before: string | undefined,
  after: string | undefined,
): boolean {
  if (before === undefined || after === undefined) return false;
  const a = parseObject(before);
  const b = parseObject(after);
  if (a === undefined || b === undefined) return false;
  const { version: beforeVersion, ...restBefore } = a;
  const { version: afterVersion, ...restAfter } = b;
  // key order counts too: the bump rewrites a value in place
  return (
    typeof beforeVersion === 'string' &&
    typeof afterVersion === 'string' &&
    JSON.stringify(restBefore) === JSON.stringify(restAfter) &&
    JSON.stringify(Object.keys(a)) === JSON.stringify(Object.keys(b))
  );
}

const VERSION_LINE = /^export const VERSION = '[^']+';$/;

// version.ts differs from the base on VERSION lines only.
export function isVersionLineOnlyDiff(
  before: string | undefined,
  after: string | undefined,
): boolean {
  if (before === undefined || after === undefined) return false;
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length !== b.length) return false;
  return a.every((line, index) => {
    const other = b[index];
    return (
      line === other ||
      (VERSION_LINE.test(line) &&
        other !== undefined &&
        VERSION_LINE.test(other))
    );
  });
}

const SECTION_HEADING = /^## \[[^\]]+\] - \d{4}-\d{2}-\d{2}$/;

// CHANGELOG.md gained one section directly below `## [Unreleased]`.
export function isSectionInsertionDiff(
  before: string | undefined,
  after: string | undefined,
): boolean {
  if (before === undefined || after === undefined) return false;
  const a = before.split('\n');
  const b = after.split('\n');
  const heading = a.indexOf('## [Unreleased]');
  if (heading === -1 || b[heading] !== '## [Unreleased]') return false;
  // keep the blank line that follows the heading on both sides
  const head = heading + 2;
  const tail = a.length - head;
  if (b.length <= a.length || tail < 0) return false;
  if (a.slice(0, head).join('\n') !== b.slice(0, head).join('\n')) return false;
  if (a.slice(head).join('\n') !== b.slice(b.length - tail).join('\n')) {
    return false;
  }
  const inserted = b.slice(head, b.length - tail);
  if (!SECTION_HEADING.test(inserted[0] ?? '')) return false;
  return !inserted.slice(1).some((line) => line.startsWith('## '));
}

// All of the above for one change: true when the change is exactly the kind a
// version bump leaves behind. Changes under ignored packages count only for
// their package.json (the one file the pre mode defect rewrites).
export function isBumpResidue(change: {
  readonly path: string;
  readonly state: ChangeState;
  readonly before: string | undefined;
  readonly after: string | undefined;
}): boolean {
  const { path, state, before, after } = change;
  if (path === PRE_JSON) {
    return state === 'A' || state === 'M' || state === 'D' || state === '??';
  }
  if (path === PACKAGE_JSON) {
    return state === 'M' && isVersionOnlyPackageDiff(before, after);
  }
  if (path === VERSION_TS) {
    return state === 'M' && isVersionLineOnlyDiff(before, after);
  }
  if (path === CHANGELOG) {
    return state === 'M' && isSectionInsertionDiff(before, after);
  }
  if (isChangesetFile(path)) return state === 'D';
  return IGNORED_PACKAGE_DIRS.some(
    (dir) => path === `${dir}/package.json` && state === 'M',
  );
}
