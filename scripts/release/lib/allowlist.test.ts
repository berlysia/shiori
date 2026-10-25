import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  afterRestore,
  compareChangeSets,
  findViolations,
  isBumpResidue,
  isSectionInsertionDiff,
  isVersionLineOnlyDiff,
  isVersionOnlyPackageDiff,
  planIgnoredRestore,
  planPreCommands,
  removeUntracked,
} from './allowlist.ts';
import type { ChangeEntry, ChangeState, FileStat, FsApi } from './types.ts';

const change = (state: ChangeState, path: string): ChangeEntry => ({
  state,
  path,
});
const PKG = 'packages/shiori-cli/package.json';
const VER = 'packages/shiori-cli/src/core/version.ts';

describe('findViolations', () => {
  const stableSet = [
    change('M', PKG),
    change('M', VER),
    change('M', 'CHANGELOG.md'),
    change('D', '.changeset/a-b-c.md'),
  ];

  it('accepts the stable set', () => {
    assert.deepEqual(findViolations(stableSet, 'stable'), []);
  });

  it('rejects CHANGELOG.md and changeset removals for a prerelease', () => {
    assert.deepEqual(findViolations(stableSet, 'prerelease'), [
      'M CHANGELOG.md',
      'D .changeset/a-b-c.md',
    ]);
  });

  it('accepts pre.json as A, M and D in both kinds, and untracked (a new file before staging)', () => {
    for (const state of ['A', 'M', 'D', '??'] as const) {
      for (const kind of ['stable', 'prerelease'] as const) {
        assert.deepEqual(
          findViolations([change(state, '.changeset/pre.json')], kind),
          [],
        );
      }
    }
  });

  const rejected: ChangeEntry[] = [
    change('M', 'packages/shiori-cli/.fallowrc.json'),
    change('??', 'notes.txt'),
    change('D', '.changeset/README.md'),
    change('D', '.changeset/Foo.md'),
    change('A', '.changeset/x.md'),
    change('D', 'CHANGELOG.md'),
    change('T', PKG),
  ];
  for (const entry of rejected) {
    it(`rejects ${entry.state} ${entry.path}`, () => {
      assert.deepEqual(findViolations([entry], 'stable'), [
        `${entry.state} ${entry.path}`,
      ]);
    });
  }
});

describe('planIgnoredRestore', () => {
  it('checks out modified ignored packages and passes the check afterwards', () => {
    const changes = [
      change('M', 'packages/shiori-daemon/package.json'),
      change('M', 'packages/shiori-vscode/package.json'),
      change('M', PKG),
    ];
    const plan = planIgnoredRestore(changes);
    assert.deepEqual(plan.checkout, [
      'packages/shiori-daemon/package.json',
      'packages/shiori-vscode/package.json',
    ]);
    assert.deepEqual(plan.remove, []);
    assert.deepEqual(findViolations(afterRestore(changes, plan), 'stable'), []);
  });

  it('removes untracked files', () => {
    const plan = planIgnoredRestore([
      change('??', 'packages/shiori-daemon/new.txt'),
    ]);
    assert.deepEqual(plan.remove, ['packages/shiori-daemon/new.txt']);
  });

  it('leaves a path that climbs out of the directory out of the plan and flags it', () => {
    const changes = [change('M', 'packages/shiori-daemon/../../x')];
    const plan = planIgnoredRestore(changes);
    assert.deepEqual(plan, { checkout: [], remove: [] });
    assert.equal(
      findViolations(afterRestore(changes, plan), 'stable').length,
      1,
    );
  });
});

class MemoryFs implements FsApi {
  removed: string[] = [];
  stats: Record<string, FileStat>;
  real: Record<string, string>;
  constructor(stats: Record<string, FileStat>, real: Record<string, string>) {
    this.stats = stats;
    this.real = real;
  }
  readFile(): Promise<string> {
    throw new Error('unused');
  }
  writeFile(): Promise<void> {
    throw new Error('unused');
  }
  readdir(): Promise<string[]> {
    throw new Error('unused');
  }
  mkdir(): Promise<void> {
    throw new Error('unused');
  }
  async lstat(path: string): Promise<FileStat | undefined> {
    return this.stats[path];
  }
  async realpath(path: string): Promise<string> {
    return this.real[path] ?? path;
  }
  async rm(path: string): Promise<void> {
    this.removed.push(path);
  }
}

const FILE: FileStat = {
  isFile: true,
  isDirectory: false,
  isSymbolicLink: false,
  size: 1,
};

describe('removeUntracked', () => {
  const rel = 'packages/shiori-daemon/new.txt';
  it('removes a regular file inside the directory', async () => {
    const fs = new MemoryFs({ [`/r/${rel}`]: FILE }, {});
    assert.deepEqual(
      await removeUntracked(fs, '/r', rel, 'packages/shiori-daemon'),
      {
        ok: true,
      },
    );
    assert.deepEqual(fs.removed, [`/r/${rel}`]);
  });

  it('refuses a symlink and leaves its target alone', async () => {
    const fs = new MemoryFs(
      { [`/r/${rel}`]: { ...FILE, isFile: false, isSymbolicLink: true } },
      { [`/r/${rel}`]: '/etc/passwd' },
    );
    const result = await removeUntracked(
      fs,
      '/r',
      rel,
      'packages/shiori-daemon',
    );
    assert.equal(result.ok, false);
    assert.deepEqual(fs.removed, []);
  });

  it('refuses a file whose parent resolves outside the package', async () => {
    const fs = new MemoryFs(
      { '/r/sub/new.txt': FILE },
      {
        '/r/packages/shiori-daemon': '/r/packages/shiori-daemon',
        '/r/sub': '/outside',
      },
    );
    const result = await removeUntracked(
      fs,
      '/r',
      'sub/new.txt',
      'packages/shiori-daemon',
    );
    assert.equal(result.ok, false);
    assert.deepEqual(fs.removed, []);
  });
});

describe('compareChangeSets', () => {
  it('fails when a change is missing', () => {
    const result = compareChangeSets(
      [change('M', PKG), change('M', VER)],
      [change('M', PKG), change('M', VER), change('M', 'CHANGELOG.md')],
    );
    assert.equal(result.same, false);
    assert.deepEqual(result.missing, ['M CHANGELOG.md']);
  });

  it('fails when a change is extra', () => {
    const result = compareChangeSets(
      [change('M', PKG), change('A', '.fallowrc.json')],
      [change('M', PKG)],
    );
    assert.deepEqual(result.extra, ['A .fallowrc.json']);
  });

  it('treats an untracked expected file as added once staged', () => {
    const result = compareChangeSets(
      [change('A', '.changeset/pre.json')],
      [change('??', '.changeset/pre.json')],
    );
    assert.equal(result.same, true);
  });
});

describe('planPreCommands', () => {
  const rc = { mode: 'pre', tag: 'rc' } as const;
  it('enters when not in pre mode', () => {
    assert.deepEqual(planPreCommands({ active: false }, rc), {
      ok: true,
      commands: [['enter', 'rc']],
    });
  });
  it('does nothing for the same tag', () => {
    assert.deepEqual(planPreCommands({ active: true, tag: 'rc' }, rc), {
      ok: true,
      commands: [],
    });
  });
  it('exits then enters for another tag', () => {
    assert.deepEqual(planPreCommands({ active: true, tag: 'beta' }, rc), {
      ok: true,
      commands: [['exit'], ['enter', 'rc']],
    });
  });
  it('exits for --exit-pre in pre mode and fails outside it', () => {
    assert.deepEqual(
      planPreCommands({ active: true, tag: 'rc' }, { mode: 'exit-pre' }),
      { ok: true, commands: [['exit']] },
    );
    assert.equal(
      planPreCommands({ active: false }, { mode: 'exit-pre' }).ok,
      false,
    );
  });
  it('does nothing without flags', () => {
    assert.deepEqual(
      planPreCommands({ active: true, tag: 'rc' }, { mode: 'normal' }),
      {
        ok: true,
        commands: [],
      },
    );
  });
});

describe('content judges', () => {
  const pkg = (extra: Record<string, unknown> = {}, version = '0.3.0') =>
    JSON.stringify({ name: 'x', version, ...extra }, null, 2);

  it('accepts a package.json that differs in version only', () => {
    assert.equal(isVersionOnlyPackageDiff(pkg(), pkg({}, '0.3.1')), true);
  });
  it('rejects an added dependency or script', () => {
    assert.equal(
      isVersionOnlyPackageDiff(
        pkg(),
        pkg({ dependencies: { a: '1' } }, '0.3.1'),
      ),
      false,
    );
    assert.equal(
      isVersionOnlyPackageDiff(
        pkg({ scripts: {} }),
        pkg({ scripts: { postinstall: 'x' } }),
      ),
      false,
    );
  });
  it('rejects text that is not a JSON object', () => {
    assert.equal(isVersionOnlyPackageDiff('[', pkg()), false);
    assert.equal(isVersionOnlyPackageDiff(undefined, pkg()), false);
  });

  const ver = (v: string, other = 'a') =>
    `// c\nexport const VERSION = '${v}';\nexport const OTHER = '${other}';\n`;
  it('accepts a VERSION line change and rejects another line', () => {
    assert.equal(isVersionLineOnlyDiff(ver('0.3.0'), ver('0.3.1')), true);
    assert.equal(isVersionLineOnlyDiff(ver('0.3.0'), ver('0.3.1', 'b')), false);
  });

  const log = '# C\n\n## [Unreleased]\n\n## [0.3.0] - 2026-10-01\n\n- a\n';
  const grown =
    '# C\n\n## [Unreleased]\n\n## [0.3.1] - 2026-11-01\n\n### Fixed\n\n- x\n\n## [0.3.0] - 2026-10-01\n\n- a\n';
  it('accepts a section inserted below Unreleased', () => {
    assert.equal(isSectionInsertionDiff(log, grown), true);
  });
  it('rejects an edit of an older section or an inserted non-section', () => {
    assert.equal(
      isSectionInsertionDiff(log, grown.replace('- a', '- b')),
      false,
    );
    assert.equal(
      isSectionInsertionDiff(
        log,
        log.replace('## [Unreleased]\n', '## [Unreleased]\n\n- hand\n'),
      ),
      false,
    );
  });

  it('classifies a change as residue', () => {
    assert.equal(
      isBumpResidue({
        path: PKG,
        state: 'M',
        before: pkg(),
        after: pkg({}, '0.3.1'),
      }),
      true,
    );
    assert.equal(
      isBumpResidue({
        path: 'packages/shiori-vscode/src/x.ts',
        state: 'M',
        before: '',
        after: 'x',
      }),
      false,
    );
  });
});
