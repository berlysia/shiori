// Parsing and validation of changeset files and of CHANGELOG.md's
// `## [Unreleased]` block. Pure: callers read the files.
//
// Failure reasons never quote the input. They end up on a terminal, and the
// input may contain exactly the characters this module rejects.
import { hasForbiddenChar } from './sanitize.ts';

// Keep a Changelog order; the section renderer sorts by it.
export const HEADINGS = [
  'Breaking Changes',
  'Added',
  'Changed',
  'Deprecated',
  'Removed',
  'Fixed',
  'Security',
] as const;

export type Heading = (typeof HEADINGS)[number];
export type Bump = 'patch' | 'minor' | 'major';
export type Sections = Partial<Record<Heading, string[]>>;

export interface ParseError {
  readonly line: number;
  readonly reason: string;
}

export type ParsedBody =
  | { readonly ok: true; readonly sections: Sections }
  | { readonly ok: false; readonly errors: ParseError[] };

export type ParsedChangeset =
  | {
      readonly ok: true;
      readonly id: string;
      readonly bump: Bump;
      readonly sections: Sections;
    }
  | {
      readonly ok: false;
      readonly id: string;
      readonly errors: ParseError[];
    };

export const CHANGESET_MAX_BYTES = 65536;
export const PACKAGE_NAME = '@berlysia/shiori';

const BUMPS: readonly string[] = ['patch', 'minor', 'major'];
const FORBIDDEN_CHARS_REASON =
  'contains a control, bidi or invisible format character, or CR';

function isHeading(name: string): name is Heading {
  return (HEADINGS as readonly string[]).includes(name);
}

function isBlank(line: string): boolean {
  return /^[ \t]*$/.test(line);
}

// lineOffset is the number of file lines before `text`, so reported numbers
// are file line numbers.
export function parseBody(text: string, lineOffset: number): ParsedBody {
  const errors: ParseError[] = [];
  const sections: Sections = {};
  // 'invalid' marks an unknown or repeated heading: its entries are not
  // reported again, the heading itself already is.
  let current: Heading | 'invalid' | null = null;
  let currentLine = 0;
  let currentCount = 0;

  const closeSection = (): void => {
    if (current !== null && current !== 'invalid' && currentCount === 0) {
      errors.push({ line: currentLine, reason: 'heading has no entries' });
    }
  };

  const lines = text.split('\n');
  lines.forEach((rawLine, index) => {
    const line = lineOffset + index + 1;
    let content = rawLine;
    if (hasForbiddenChar(content)) {
      errors.push({ line, reason: FORBIDDEN_CHARS_REASON });
      content = Array.from(content)
        .filter((char) => !hasForbiddenChar(char))
        .join('');
    }
    if (isBlank(content)) return;

    const heading = /^### (\S.*?)[ \t]*$/.exec(content);
    if (heading?.[1] !== undefined) {
      closeSection();
      currentLine = line;
      currentCount = 0;
      const name = heading[1];
      if (!isHeading(name)) {
        errors.push({ line, reason: 'unknown heading' });
        current = 'invalid';
      } else if (sections[name] !== undefined) {
        errors.push({ line, reason: 'heading appears more than once' });
        current = 'invalid';
      } else {
        sections[name] = [];
        current = name;
      }
      return;
    }

    const entry = /^- (.*)$/.exec(content);
    if (entry?.[1] !== undefined) {
      const item = entry[1].trimEnd();
      if (item === '') {
        errors.push({ line, reason: 'entry is empty' });
        return;
      }
      if (current === null) {
        errors.push({ line, reason: 'entry before the first heading' });
        return;
      }
      if (current !== 'invalid') {
        sections[current]?.push(item);
        currentCount += 1;
      }
      return;
    }

    errors.push({
      line,
      reason:
        current === null
          ? 'the first line must be a "### <heading>" line'
          : 'only "### <heading>" lines, "- " entries and blank lines are allowed',
    });
  });
  closeSection();

  if (Object.keys(sections).length === 0 && errors.length === 0) {
    errors.push({ line: lineOffset + 1, reason: 'body has no section' });
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, sections };
}

function parseFrontmatter(
  lines: readonly string[],
  errors: ParseError[],
): { bump: Bump | undefined; closingLine: number } | undefined {
  if (lines[0] !== '---') {
    errors.push({ line: 1, reason: 'the file must start with a "---" line' });
    return undefined;
  }
  const closing = lines.indexOf('---', 1);
  if (closing === -1) {
    errors.push({ line: 1, reason: 'frontmatter is not closed' });
    return undefined;
  }

  let bump: Bump | undefined;
  let seen = false;
  const frontmatter = lines.slice(1, closing);
  if (frontmatter.length === 0) {
    errors.push({ line: 2, reason: 'frontmatter is empty (no release)' });
  }
  frontmatter.forEach((raw, index) => {
    const line = index + 2;
    if (hasForbiddenChar(raw)) {
      errors.push({ line, reason: FORBIDDEN_CHARS_REASON });
    }
    const keyed = /^(["'])([^"']+)\1:[ \t]*(.*?)[ \t]*$/.exec(raw);
    if (keyed === null) {
      errors.push({ line, reason: 'unsupported frontmatter line' });
      return;
    }
    if (keyed[2] !== PACKAGE_NAME) {
      errors.push({ line, reason: `only ${PACKAGE_NAME} may be listed` });
      return;
    }
    if (seen) {
      errors.push({ line, reason: 'duplicate package key' });
      return;
    }
    seen = true;
    const value = keyed[3] ?? '';
    if (!BUMPS.includes(value)) {
      errors.push({ line, reason: 'bump must be patch, minor or major' });
      return;
    }
    bump = value as Bump;
  });
  if (!seen && frontmatter.length > 0 && errors.length === 0) {
    errors.push({ line: 2, reason: `${PACKAGE_NAME} is not listed` });
  }
  return { bump, closingLine: closing + 1 };
}

export function parseChangeset(id: string, text: string): ParsedChangeset {
  const errors: ParseError[] = [];
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > CHANGESET_MAX_BYTES) {
    errors.push({
      line: 1,
      reason: `file is ${bytes} bytes; the limit is ${CHANGESET_MAX_BYTES} bytes`,
    });
  }

  const lines = text.split('\n');
  const frontmatter = parseFrontmatter(lines, errors);
  let sections: Sections | undefined;
  if (frontmatter !== undefined) {
    const body = parseBody(
      lines.slice(frontmatter.closingLine).join('\n'),
      frontmatter.closingLine,
    );
    if (body.ok) sections = body.sections;
    else errors.push(...body.errors);
  } else {
    // Without a frontmatter the body cannot be located, but a forbidden
    // character in the file is still worth reporting.
    lines.forEach((raw, index) => {
      if (hasForbiddenChar(raw)) {
        errors.push({ line: index + 1, reason: FORBIDDEN_CHARS_REASON });
      }
    });
  }

  if (errors.length > 0 || frontmatter?.bump === undefined || !sections) {
    return { ok: false, id, errors };
  }
  return { ok: true, id, bump: frontmatter.bump, sections };
}

export type UnreleasedCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: ParseError[] };

const UNRELEASED = '## [Unreleased]';

export function checkUnreleased(changelog: string): UnreleasedCheck {
  const errors: ParseError[] = [];
  const rawLines = changelog.split('\n');

  const crLine = rawLines.findIndex((line) => line.includes('\r'));
  if (crLine !== -1) {
    errors.push({ line: crLine + 1, reason: 'CHANGELOG.md contains CR' });
  }
  const lines = rawLines.map((line) => line.replace(/\r$/, ''));

  const headings = lines.flatMap((line, index) =>
    line === UNRELEASED ? [index] : [],
  );
  if (headings.length === 0) {
    errors.push({ line: 1, reason: `no "${UNRELEASED}" heading` });
    return { ok: false, errors };
  }
  if (headings.length > 1) {
    errors.push({
      line: (headings[1] ?? 0) + 1,
      reason: `"${UNRELEASED}" appears more than once`,
    });
    return { ok: false, errors };
  }

  const start = headings[0] ?? 0;
  const nextHeading = lines.findIndex(
    (line, index) => index > start && line.startsWith('## ['),
  );
  const end = nextHeading === -1 ? lines.length : nextHeading;
  for (let index = start + 1; index < end; index += 1) {
    if (!isBlank(lines[index] ?? '')) {
      errors.push({
        line: index + 1,
        reason: `"${UNRELEASED}" must be empty; changes belong in .changeset/`,
      });
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

// ---------------------------------------------------------------------------
// the check that CI and the release command share
// ---------------------------------------------------------------------------

export interface ChangesetDirectoryEntry {
  // the file name in .changeset/
  readonly name: string;
  // 'file' for a regular file; a symlink or directory is 'other'
  readonly kind: 'file' | 'other';
  readonly size: number;
  // the text; undefined when the file was not read (not a regular file, or too large)
  readonly text: string | undefined;
}

// `<file>:<line>: <reason>` lines, not yet sanitized. The caller reads the
// directory; entries other than `*.md` (config.json, pre.json) are skipped here.
export function checkChangesetDirectory(
  entries: readonly ChangesetDirectoryEntry[],
  changelog: string,
): string[] {
  const violations: string[] = [];
  for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    // Only *.md is a changeset. README.md, config.json and pre.json are not.
    if (!entry.name.endsWith('.md') || entry.name === 'README.md') continue;
    const file = `.changeset/${entry.name}`;
    if (entry.kind !== 'file') {
      violations.push(`${file}:1: not a regular file`);
      continue;
    }
    if (entry.size > CHANGESET_MAX_BYTES) {
      violations.push(`${file}:1: larger than ${CHANGESET_MAX_BYTES} bytes`);
      continue;
    }
    const parsed = parseChangeset(
      entry.name.slice(0, -'.md'.length),
      entry.text ?? '',
    );
    if (!parsed.ok) {
      for (const error of parsed.errors) {
        violations.push(`${file}:${error.line}: ${error.reason}`);
      }
    }
  }
  const unreleased = checkUnreleased(changelog);
  if (!unreleased.ok) {
    for (const error of unreleased.errors) {
      violations.push(`CHANGELOG.md:${error.line}: ${error.reason}`);
    }
  }
  return violations;
}
