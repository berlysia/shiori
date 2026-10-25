import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasChangelogSection } from '../../../packages/shiori-cli/scripts/check-changelog.ts';
import { insertSection, renderSection } from './changelog.ts';
import {
  HEADINGS,
  parseBody,
  parseChangeset,
  type Heading,
  type ParsedChangeset,
} from './changeset.ts';
import { parseVersion, type ValidVersion } from './semver.ts';
import { withTempDir } from '../testing/test-workspace.ts';

type Success = Extract<ParsedChangeset, { ok: true }>;

function version(text: string): ValidVersion {
  const parsed = parseVersion(text);
  assert.ok(parsed.ok);
  return parsed.version;
}

function changeset(id: string, body: string, bump = 'patch'): Success {
  const parsed = parseChangeset(
    id,
    `---\n"@berlysia/shiori": ${bump}\n---\n\n${body}`,
  );
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return parsed as Success;
}

function sectionOf(ver: string, date: string, changesets: Success[]): string {
  const result = renderSection(version(ver), date, changesets);
  assert.ok(result.ok, JSON.stringify(result));
  return result.section;
}

// A snapshot of the top of CHANGELOG.md at the time of writing, so that the
// golden text does not change when a later release edits the real file.
const CHANGELOG_BEFORE = `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.0] - 2026-10-25

### Added

- **Markdown files are scanned with HTML comment syntax**: \`.md\` and \`.markdown\` files are now read for \`<!-- -->\` comments, so \`<!-- shiori: REF -->\` in Markdown is detected.

## [0.2.2] - 2026-10-02

### Breaking Changes

- **Node.js 22 or later is required**: \`engines.node\` is now \`>=22.0.0\` (was \`>=18.0.0\`).
`;

const CHANGELOG_AFTER = `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.1] - 2026-11-01

### Added

- **Added by a**: a1

### Fixed

- **Fixed by a**: a2
- **Fixed by b**: b1

## [0.3.0] - 2026-10-25

### Added

- **Markdown files are scanned with HTML comment syntax**: \`.md\` and \`.markdown\` files are now read for \`<!-- -->\` comments, so \`<!-- shiori: REF -->\` in Markdown is detected.

## [0.2.2] - 2026-10-02

### Breaking Changes

- **Node.js 22 or later is required**: \`engines.node\` is now \`>=22.0.0\` (was \`>=18.0.0\`).
`;

const A = changeset(
  'a',
  '### Fixed\n\n- **Fixed by a**: a2\n\n### Added\n\n- **Added by a**: a1\n',
);
const B = changeset('b', '### Fixed\n\n- **Fixed by b**: b1\n');

describe('renderSection', () => {
  it('orders headings by Keep a Changelog and entries by changeset id', () => {
    // b is passed first: the id order, not the argument order, decides
    const section = sectionOf('0.3.1', '2026-11-01', [B, A]);
    assert.equal(
      section,
      [
        '## [0.3.1] - 2026-11-01',
        '',
        '### Added',
        '',
        '- **Added by a**: a1',
        '',
        '### Fixed',
        '',
        '- **Fixed by a**: a2',
        '- **Fixed by b**: b1',
      ].join('\n'),
    );
  });

  it('puts all seven headings in the fixed order', () => {
    const shuffled = [
      'Security',
      'Fixed',
      'Breaking Changes',
      'Deprecated',
      'Added',
      'Removed',
      'Changed',
    ];
    const body = shuffled
      .map((name) => `### ${name}\n\n- ${name} entry\n`)
      .join('\n');
    const section = sectionOf('1.0.0', '2026-11-01', [changeset('x', body)]);
    const headings = section
      .split('\n')
      .filter((line) => line.startsWith('### '))
      .map((line) => line.slice(4));
    assert.deepEqual(headings, [...HEADINGS]);
  });

  it('keeps entries that have the same text', () => {
    const one = changeset('one', '### Fixed\n\n- same\n');
    const two = changeset('two', '### Fixed\n\n- same\n');
    const section = sectionOf('0.3.1', '2026-11-01', [one, two]);
    assert.equal(
      section.split('\n').filter((line) => line === '- same').length,
      2,
    );
  });

  it('keeps the written order inside one changeset', () => {
    const one = changeset('one', '### Fixed\n\n- z\n- a\n- m\n');
    const section = sectionOf('0.3.1', '2026-11-01', [one]);
    assert.deepEqual(section.split('\n').slice(-3), ['- z', '- a', '- m']);
  });

  it('refuses a prerelease version', () => {
    assert.equal(
      renderSection(version('0.4.0-rc.0'), '2026-11-01', [A]).ok,
      false,
    );
  });

  it('refuses an empty list of changesets', () => {
    assert.equal(renderSection(version('0.3.1'), '2026-11-01', []).ok, false);
  });

  for (const date of [
    '2026-02-30',
    '2026-1-1',
    '2026-11-01\n',
    '2026-13-01',
    '',
  ]) {
    it(`refuses the date ${JSON.stringify(date)}`, () => {
      assert.equal(renderSection(version('0.3.1'), date, [A]).ok, false);
    });
  }

  it('accepts a leap day', () => {
    assert.equal(renderSection(version('0.3.1'), '2028-02-29', [A]).ok, true);
    assert.equal(renderSection(version('0.3.1'), '2027-02-29', [A]).ok, false);
  });
});

describe('insertSection', () => {
  it('matches the golden text for the current CHANGELOG shape', () => {
    const section = sectionOf('0.3.1', '2026-11-01', [A, B]);
    const result = insertSection(CHANGELOG_BEFORE, section, version('0.3.1'));
    assert.deepEqual(result, { ok: true, changelog: CHANGELOG_AFTER });
  });

  it('normalises any run of blank lines after [Unreleased]', () => {
    const section = sectionOf('0.3.1', '2026-11-01', [B]);
    const input = '## [Unreleased]\n\n\n\n## [0.3.0] - 2026-10-25\n';
    const result = insertSection(input, section, version('0.3.1'));
    assert.deepEqual(result, {
      ok: true,
      changelog: `## [Unreleased]\n\n${section}\n\n## [0.3.0] - 2026-10-25\n`,
    });
  });

  it('ends with one newline when [Unreleased] is last', () => {
    const section = sectionOf('0.3.1', '2026-11-01', [B]);
    for (const input of [
      '## [Unreleased]',
      '## [Unreleased]\n',
      '## [Unreleased]\n\n\n',
    ]) {
      const result = insertSection(input, section, version('0.3.1'));
      assert.deepEqual(result, {
        ok: true,
        changelog: `## [Unreleased]\n\n${section}\n`,
      });
    }
  });

  it('fails when [Unreleased] has an entry', () => {
    const section = sectionOf('0.3.1', '2026-11-01', [B]);
    const input = '## [Unreleased]\n\n- pending\n\n## [0.3.0] - 2026-10-25\n';
    assert.equal(insertSection(input, section, version('0.3.1')).ok, false);
  });

  it('fails when the version already has a section', () => {
    const section = sectionOf('0.3.0', '2026-11-01', [B]);
    assert.equal(
      insertSection(CHANGELOG_BEFORE, section, version('0.3.0')).ok,
      false,
    );
  });

  it('fails when an undated heading for the version exists', () => {
    const section = sectionOf('0.3.1', '2026-11-01', [B]);
    const input = '## [Unreleased]\n\n## [0.3.1]\n\n## [0.3.0] - 2026-10-25\n';
    assert.equal(insertSection(input, section, version('0.3.1')).ok, false);
  });

  it('fails on CRLF', () => {
    const section = sectionOf('0.3.1', '2026-11-01', [B]);
    const input = CHANGELOG_BEFORE.replaceAll('\n', '\r\n');
    assert.equal(insertSection(input, section, version('0.3.1')).ok, false);
  });

  it('fails when the section is not for the version', () => {
    const section = sectionOf('0.3.2', '2026-11-01', [B]);
    assert.equal(
      insertSection(CHANGELOG_BEFORE, section, version('0.3.1')).ok,
      false,
    );
  });
});

describe('invariants (K3)', () => {
  const body = (headings: Heading[], items: string[]) =>
    headings
      .map(
        (name) =>
          `### ${name}\n\n${items.map((item) => `- ${item}`).join('\n')}\n`,
      )
      .join('\n');

  const awkward = [
    '**Bold**: text with `code`',
    'snake_case_name and _emphasis_ and *star*',
    'colon: after colon: again',
    '`a`, `b` and ``c``  ',
    '**`shiori scan`**: trailing spaces   ',
    '[link](https://example.com) and <angle> & ampersand',
  ];
  const tables: { name: string; sets: [string, Heading[], string[]][] }[] = [
    { name: 'single heading', sets: [['a', ['Added'], awkward.slice(0, 1)]] },
    {
      name: 'two headings',
      sets: [['a', ['Added', 'Fixed'], awkward.slice(0, 2)]],
    },
    { name: 'all headings', sets: [['a', [...HEADINGS], awkward]] },
    {
      name: 'two changesets, same heading',
      sets: [
        ['a', ['Fixed'], [awkward[0] ?? '']],
        ['b', ['Fixed'], [awkward[1] ?? '']],
      ],
    },
    {
      name: 'identical entries',
      sets: [
        ['a', ['Changed'], ['same']],
        ['b', ['Changed'], ['same']],
      ],
    },
    {
      name: 'five changesets',
      sets: ['e', 'd', 'c', 'b', 'a'].map(
        (id, index): [string, Heading[], string[]] => [
          id,
          [HEADINGS[index] ?? 'Added'],
          awkward.slice(index, index + 1),
        ],
      ),
    },
    {
      name: 'mixed with overlap',
      sets: [
        ['m1', ['Security', 'Added'], awkward.slice(2, 4)],
        ['m2', ['Added', 'Removed'], awkward.slice(3, 5)],
        ['m3', ['Breaking Changes'], awkward.slice(5)],
      ],
    },
    {
      name: 'only trailing-space entries',
      sets: [['a', ['Deprecated'], ['x   ', 'y\t']]],
    },
    { name: 'long entry', sets: [['a', ['Fixed'], ['long '.repeat(500)]]] },
    {
      name: 'dashes and numbers',
      sets: [['a', ['Fixed'], ['- nested dash', '1. numbered', '# hash']]],
    },
    {
      name: 'unicode',
      sets: [['a', ['Added'], ['日本語の項目: **太字**', 'emoji-free café']]],
    },
  ];

  const trimmed = (item: string) => item.trimEnd();

  for (const { name, sets } of tables) {
    it(`holds for ${name}`, () => {
      const changesets = sets.map(([id, headings, items]) =>
        changeset(id, body(headings, items)),
      );
      const ver = version('1.2.3');
      const section = sectionOf('1.2.3', '2026-11-01', changesets);

      // (c) deterministic
      assert.equal(
        section,
        sectionOf('1.2.3', '2026-11-01', [...changesets].reverse()),
      );

      // (a) the check-changelog guard sees the section
      const inserted = insertSection(
        '# Changelog\n\n## [Unreleased]\n',
        section,
        ver,
      );
      assert.ok(inserted.ok);
      assert.equal(hasChangelogSection(inserted.changelog, '1.2.3'), true);

      // (b) read back: the multiset of entries per heading is unchanged
      const [, ...rest] = section.split('\n');
      const readBack = parseBody(rest.join('\n'), 0);
      assert.ok(readBack.ok, JSON.stringify(readBack));
      for (const heading of HEADINGS) {
        const expected = changesets
          .flatMap((c) => c.sections[heading] ?? [])
          .map(trimmed)
          .sort();
        const actual = [...(readBack.sections[heading] ?? [])].sort();
        assert.deepEqual(actual, expected, heading);
      }
    });
  }
});

describe('formatting', () => {
  it('leaves the golden text, .changeset/README.md and config.json unchanged under oxfmt', async () => {
    const root = new URL('../../../', import.meta.url);
    const oxfmt = new URL('node_modules/.bin/oxfmt', root).pathname;
    const config = new URL('.oxfmtrc.json', root).pathname;
    await withTempDir((dir) => {
      writeFileSync(join(dir, 'CHANGELOG.md'), CHANGELOG_AFTER);
      for (const name of ['README.md', 'config.json']) {
        writeFileSync(
          join(dir, name),
          readFileSync(new URL(`.changeset/${name}`, root)),
        );
      }
      execFileSync(
        oxfmt,
        ['--check', '-c', config, 'CHANGELOG.md', 'README.md', 'config.json'],
        { cwd: dir, encoding: 'utf8', stdio: 'pipe' },
      );
    });
  });
});
