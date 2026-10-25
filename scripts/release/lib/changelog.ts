// Renders a stable release's CHANGELOG.md section from changesets and inserts
// it under `## [Unreleased]`. Pure: the date and the file text come from the
// caller.
import { hasChangelogSection } from '../../../packages/shiori-cli/scripts/check-changelog.ts';
import {
  HEADINGS,
  checkUnreleased,
  type ParsedChangeset,
} from './changeset.ts';
import type { ValidVersion } from './semver.ts';

type ValidChangeset = Extract<ParsedChangeset, { ok: true }>;

export type RenderResult =
  | { readonly ok: true; readonly section: string }
  | { readonly ok: false; readonly reason: string };

export type InsertResult =
  | { readonly ok: true; readonly changelog: string }
  | { readonly ok: false; readonly reason: string };

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// Calendar arithmetic instead of `new Date`: lib/ takes every input, the clock
// included, from its caller (layers.test.ts forbids `new Date(`).
function isRealDate(text: string): boolean {
  const match = DATE_PATTERN.exec(text);
  if (match === null) return false;
  const [year, month, day] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [
    31,
    leap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= (daysInMonth[month - 1] ?? 0)
  );
}

// Code-unit order, not localeCompare: the order must not depend on the locale
// of the machine that cuts the release.
function compareIds(left: ValidChangeset, right: ValidChangeset): number {
  if (left.id < right.id) return -1;
  return left.id > right.id ? 1 : 0;
}

export function renderSection(
  version: ValidVersion,
  date: string,
  changesets: readonly ValidChangeset[],
): RenderResult {
  if (version.includes('-')) {
    return {
      ok: false,
      reason: 'a prerelease version has no CHANGELOG section',
    };
  }
  if (!isRealDate(date)) {
    return {
      ok: false,
      reason: 'date must be a real calendar date, YYYY-MM-DD',
    };
  }
  if (changesets.length === 0) {
    return { ok: false, reason: 'there are no changesets to render' };
  }

  // Ascending id, not git history: ids are random words, and history order
  // changes with rename, squash and shallow clones.
  const ordered = [...changesets].sort(compareIds);
  const blocks: string[] = [`## [${version}] - ${date}`];
  for (const heading of HEADINGS) {
    const items = ordered.flatMap(
      (changeset) => changeset.sections[heading] ?? [],
    );
    if (items.length === 0) continue;
    blocks.push(
      [`### ${heading}`, '', ...items.map((item) => `- ${item}`)].join('\n'),
    );
  }
  return { ok: true, section: blocks.join('\n\n') };
}

export function insertSection(
  changelog: string,
  section: string,
  version: ValidVersion,
): InsertResult {
  const unreleased = checkUnreleased(changelog);
  if (!unreleased.ok) {
    const first = unreleased.errors[0];
    return {
      ok: false,
      reason: `CHANGELOG.md is not ready for a section (line ${first?.line ?? 1}: ${first?.reason ?? 'invalid'})`,
    };
  }
  if (!section.startsWith(`## [${version}] - `)) {
    return { ok: false, reason: 'the section is not for this version' };
  }
  const lines = changelog.split('\n');
  if (lines.some((line) => line.startsWith(`## [${version}]`))) {
    return {
      ok: false,
      reason: `CHANGELOG.md already has a heading for ${version}`,
    };
  }

  const start = lines.indexOf('## [Unreleased]');
  const next = lines.findIndex(
    (line, index) => index > start && line.startsWith('## ['),
  );
  const head = lines.slice(0, start + 1).join('\n');
  const result =
    next === -1
      ? `${head}\n\n${section}\n`
      : `${head}\n\n${section}\n\n${lines.slice(next).join('\n')}`;

  if (!hasChangelogSection(result, version)) {
    return {
      ok: false,
      reason: 'the inserted section is not recognised by the release guard',
    };
  }
  return { ok: true, changelog: result };
}
