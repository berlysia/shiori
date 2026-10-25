import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CHANGESET_MAX_BYTES,
  HEADINGS,
  checkChangesetDirectory,
  checkUnreleased,
  parseBody,
  parseChangeset,
} from './changeset.ts';

const FM = (bump = 'patch') => `---\n"@berlysia/shiori": ${bump}\n---\n`;

function readmeExample(): string {
  const readme = readFileSync(
    new URL('../../../.changeset/README.md', import.meta.url),
    'utf8',
  );
  const match = /```md\n([\s\S]*?)\n```/.exec(readme);
  assert.ok(match?.[1], 'README.md has an example changeset');
  return `${match[1]}\n`;
}

function errorsOf(text: string) {
  const result = parseChangeset('x', text);
  assert.equal(result.ok, false, 'expected a failure');
  return result.ok ? [] : result.errors;
}

describe('parseChangeset', () => {
  it('accepts the example in .changeset/README.md', () => {
    const result = parseChangeset('readme', readmeExample());
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.bump, 'minor');
      assert.deepEqual(Object.keys(result.sections), ['Added', 'Fixed']);
    }
  });

  it('strips trailing whitespace from entries and reads the bump', () => {
    const result = parseChangeset(
      'a',
      `${FM('minor')}\n### Added\n\n- **X**: y  \n`,
    );
    assert.deepEqual(result, {
      ok: true,
      id: 'a',
      bump: 'minor',
      sections: { Added: ['**X**: y'] },
    });
  });

  it('accepts a single-quoted package name', () => {
    const result = parseChangeset(
      'a',
      "---\n'@berlysia/shiori': patch\n---\n\n### Fixed\n\n- x\n",
    );
    assert.equal(result.ok, true);
  });

  it('accepts two sections', () => {
    const result = parseChangeset(
      'a',
      `${FM()}\n### Fixed\n\n- f\n\n### Added\n\n- a\n`,
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.sections, { Fixed: ['f'], Added: ['a'] });
    }
  });

  it('accepts a tab inside an entry', () => {
    const result = parseChangeset('a', `${FM()}\n### Fixed\n\n- a\tb\n`);
    assert.equal(result.ok, true);
  });

  describe('frontmatter violations', () => {
    const body = '\n### Fixed\n\n- x\n';
    const cases: [string, string][] = [
      [
        'another package',
        `---\n"@berlysia/shiori-vscode": patch\n---\n${body}`,
      ],
      [
        'duplicate key',
        `---\n"@berlysia/shiori": patch\n"@berlysia/shiori": minor\n---\n${body}`,
      ],
      [
        'shiori plus another package',
        `---\n"@berlysia/shiori": patch\n"@berlysia/shiori-daemon": patch\n---\n${body}`,
      ],
      ['capitalised bump', `---\n"@berlysia/shiori": Patch\n---\n${body}`],
      ['unknown bump', `---\n"@berlysia/shiori": foo\n---\n${body}`],
      ['empty bump', `---\n"@berlysia/shiori":\n---\n${body}`],
      ['no frontmatter', `### Fixed\n\n- x\n`],
      ['unclosed frontmatter', `---\n"@berlysia/shiori": patch\n${body}`],
      ['empty changeset', `---\n---\n`],
      ['empty frontmatter with body', `---\n---\n${body}`],
    ];
    for (const [name, text] of cases) {
      it(`rejects ${name}`, () => {
        assert.ok(errorsOf(text).length > 0);
      });
    }
  });

  describe('body violations', () => {
    it('rejects an empty body', () => {
      assert.ok(errorsOf(`${FM()}\n\n\n`).length > 0);
    });

    const cases: [string, string][] = [
      ['unknown heading', '### Notes\n\n- x\n'],
      ['continuation line', '### Added\n\n- x\n  continued\n'],
      ['release heading', '## [9.9.9] - 2026-01-01\n'],
      ['rule line', '### Added\n\n- x\n\n---\n'],
      ['code fence', '### Added\n\n- x\n\n```\n'],
      ['html comment', '### Added\n\n- x\n\n<!-- x -->\n'],
      ['missing space after dash', '### Added\n\n-x\n'],
      ['dash without text', '### Added\n\n- \n'],
      ['entry before heading', '- x\n\n### Added\n\n- y\n'],
      ['duplicate heading', '### Added\n\n- a\n\n### Added\n\n- b\n'],
      ['heading without entries', '### Added\n\n### Fixed\n\n- b\n'],
      ['trailing heading without entries', '### Added\n\n- a\n\n### Fixed\n'],
      ['level-4 heading', '#### Added\n\n- x\n'],
    ];
    for (const [name, body] of cases) {
      it(`rejects ${name}`, () => {
        assert.ok(errorsOf(`${FM()}\n${body}`).length > 0);
      });
    }
  });

  describe('characters', () => {
    const cases: [string, string][] = [
      ['bidi override U+202E', '‮'],
      ['ESC', '\u001b'],
      ['zero-width space U+200B', '​'],
      ['BOM U+FEFF', '﻿'],
      ['NUL', '\u0000'],
      ['line separator U+2028', ' '],
      ['DEL', '\u007f'],
      ['C1 control', '\u0085'],
      ['word joiner U+2060', '⁠'],
    ];
    for (const [name, char] of cases) {
      it(`rejects ${name} in an entry`, () => {
        assert.ok(errorsOf(`${FM()}\n### Fixed\n\n- a${char}b\n`).length > 0);
      });
    }

    it('rejects a leading BOM', () => {
      assert.ok(errorsOf(`﻿${FM()}\n### Fixed\n\n- a\n`).length > 0);
    });

    it('rejects CRLF line endings', () => {
      const text = `${FM()}\n### Fixed\n\n- a\n`.replaceAll('\n', '\r\n');
      assert.ok(errorsOf(text).length > 0);
    });

    it('does not echo the offending characters in reasons', () => {
      const reasons = errorsOf(`${FM()}\n### Fixed\n\n- a\u001b[31mb\n`)
        .map((error) => error.reason)
        .join('\n');
      assert.equal(reasons.includes('\u001b'), false);
    });
  });

  describe('size', () => {
    const prefix = `${FM()}\n### Fixed\n\n- `;
    const sizeError = (errors: { reason: string }[]) =>
      errors.some((error) => /bytes/.test(error.reason));

    function textOfBytes(bytes: number): string {
      // "あ" is 3 bytes, so the filler mixes multi-byte and ASCII characters
      const fixed = Buffer.byteLength(prefix) + 1; // trailing newline
      const rest = bytes - fixed;
      assert.ok(rest >= 3);
      const multi = 'あ'.repeat(Math.floor(rest / 3) - 1);
      const ascii = 'a'.repeat(rest - Buffer.byteLength(multi));
      const text = `${prefix}${multi}${ascii}\n`;
      assert.equal(Buffer.byteLength(text), bytes);
      return text;
    }

    it('accepts exactly 64 KiB', () => {
      assert.equal(CHANGESET_MAX_BYTES, 65536);
      const result = parseChangeset('a', textOfBytes(65536));
      assert.equal(result.ok, true);
    });

    it('rejects 64 KiB + 1 byte', () => {
      const result = parseChangeset('a', textOfBytes(65537));
      assert.equal(result.ok, false);
      if (!result.ok) assert.ok(sizeError(result.errors));
    });
  });

  it('collects frontmatter and body violations together with file line numbers', () => {
    const text = [
      '---', // 1
      '"@berlysia/shiori-vscode": patch', // 2: frontmatter violation
      '---', // 3
      '', // 4
      '### Notes', // 5: body violation
      '', // 6
      '- x', // 7: entry under an unknown heading is still reported once below
      '??', // 8: body violation
      '',
    ].join('\n');
    const errors = errorsOf(text);
    assert.deepEqual(
      errors.map((error) => error.line),
      [2, 5, 8],
    );
  });
});

describe('parseBody', () => {
  it('numbers lines from the offset', () => {
    const result = parseBody('### Added\n\n- ok\n??\n', 10);
    assert.equal(result.ok, false);
    if (!result.ok)
      assert.deepEqual(
        result.errors.map((e) => e.line),
        [14],
      );
  });

  it('returns the entries of each heading in order', () => {
    const result = parseBody('### Fixed\n- a\n- b\n\n### Added\n- c\n', 0);
    assert.deepEqual(result, {
      ok: true,
      sections: { Fixed: ['a', 'b'], Added: ['c'] },
    });
  });

  it('keeps the heading order constant in the Keep a Changelog order', () => {
    assert.deepEqual(
      [...HEADINGS],
      [
        'Breaking Changes',
        'Added',
        'Changed',
        'Deprecated',
        'Removed',
        'Fixed',
        'Security',
      ],
    );
  });
});

describe('checkUnreleased', () => {
  it('accepts an empty [Unreleased] before a release heading', () => {
    const changelog =
      '# Changelog\n\n## [Unreleased]\n\n## [0.3.0] - 2026-10-25\n\n- x\n';
    assert.deepEqual(checkUnreleased(changelog), { ok: true });
  });

  it('rejects an entry under [Unreleased] and names its line', () => {
    const changelog =
      '# Changelog\n\n## [Unreleased]\n\n- foo\n\n## [0.3.0] - 2026-10-25\n';
    const result = checkUnreleased(changelog);
    assert.equal(result.ok, false);
    if (!result.ok)
      assert.deepEqual(
        result.errors.map((e) => e.line),
        [5],
      );
  });

  it('rejects two [Unreleased] headings', () => {
    const changelog = '## [Unreleased]\n\n## [Unreleased]\n';
    assert.equal(checkUnreleased(changelog).ok, false);
  });

  it('rejects a missing [Unreleased]', () => {
    assert.equal(checkUnreleased('## [0.3.0] - 2026-10-25\n').ok, false);
  });

  it('accepts [Unreleased] at the end of the file', () => {
    assert.deepEqual(checkUnreleased('# Changelog\n\n## [Unreleased]\n\n'), {
      ok: true,
    });
    assert.deepEqual(checkUnreleased('# Changelog\n\n## [Unreleased]'), {
      ok: true,
    });
  });

  it('rejects CR', () => {
    const changelog = '## [Unreleased]\r\n\r\n## [0.3.0] - 2026-10-25\r\n';
    assert.equal(checkUnreleased(changelog).ok, false);
  });
});

describe('checkChangesetDirectory', () => {
  const clean = '# C\n\n## [Unreleased]\n\n## [0.3.0] - 2026-10-25\n';
  const good = `${FM()}\n### Fixed\n\n- ok\n`;
  const file = (name: string, text = good) => ({
    name,
    kind: 'file' as const,
    size: Buffer.byteLength(text),
    text,
  });

  it('passes valid changesets and ignores README.md, config.json and pre.json', () => {
    assert.deepEqual(
      checkChangesetDirectory(
        [
          file('a-b.md'),
          file('README.md', '# x'),
          file('config.json', '{}'),
          file('pre.json', '{}'),
        ],
        clean,
      ),
      [],
    );
  });
  it('reports file and line, in name order', () => {
    const violations = checkChangesetDirectory(
      [file('b.md', 'nope'), file('a.md', `${FM()}\n- x\n`)],
      clean,
    );
    assert.match(violations[0] ?? '', /^\.changeset\/a\.md:\d+: /);
    assert.match(
      violations[violations.length - 1] ?? '',
      /^\.changeset\/b\.md:\d+: /,
    );
  });
  it('reports a symlink or directory and an oversized file without reading them', () => {
    const violations = checkChangesetDirectory(
      [
        { name: 'link.md', kind: 'other', size: 0, text: undefined },
        {
          name: 'big.md',
          kind: 'file',
          size: CHANGESET_MAX_BYTES + 1,
          text: undefined,
        },
      ],
      clean,
    );
    assert.deepEqual(violations, [
      '.changeset/big.md:1: larger than 65536 bytes',
      '.changeset/link.md:1: not a regular file',
    ]);
  });
  it('reports an entry under [Unreleased]', () => {
    const violations = checkChangesetDirectory(
      [],
      '## [Unreleased]\n\n- hand\n',
    );
    assert.match(violations[0] ?? '', /^CHANGELOG\.md:3: /);
  });
});
