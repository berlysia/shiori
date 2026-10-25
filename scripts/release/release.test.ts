// The release flow against a real git repository and a bare remote, with the
// changeset binary real and npm, gh and the quality checks faked.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { parseFlags } from './release.ts';
import {
  withReleaseFixture,
  type ReleaseFixture,
} from './testing/test-workspace.ts';

const PKG = 'packages/shiori-cli/package.json';
const TRUST = JSON.parse(
  readFileSync(new URL('./fixtures/trust-list.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

function pkgVersion(f: ReleaseFixture, pkg = 'shiori-cli'): string {
  return (
    JSON.parse(f.read(`packages/${pkg}/package.json`)) as { version: string }
  ).version;
}

function text(result: { out: string[]; err: string[] }): string {
  return [...result.out, ...result.err].join('\n');
}

// A run that stops before any change leaves HEAD, the work tree, the tags
// and origin as they were.
async function assertUnchanged(
  f: ReleaseFixture,
  run: () => Promise<{ code: number; out: string[]; err: string[] }>,
  expectedCode = 1,
): Promise<{ code: number; out: string[]; err: string[] }> {
  const before = f.snapshot();
  const result = await run();
  assert.equal(result.code, expectedCode, text(result));
  assert.equal(f.snapshot(), before, text(result));
  return result;
}

function pushChangelog(f: ReleaseFixture, changelog: string): void {
  f.write('CHANGELOG.md', changelog);
  f.git('add', '-A');
  f.git('commit', '-m', 'docs: edit changelog');
  f.git('push', 'origin', 'master');
}

function writeHook(dir: string, name: string, body: string): void {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

describe('parseFlags', () => {
  it('accepts no flags, --pre <tag> and --exit-pre', () => {
    assert.deepEqual(parseFlags([]), { mode: 'normal' });
    assert.deepEqual(parseFlags(['--pre', 'rc']), { mode: 'pre', tag: 'rc' });
    assert.deepEqual(parseFlags(['--exit-pre']), { mode: 'exit-pre' });
  });
  for (const argv of [
    ['--yes'],
    ['--pre'],
    ['--pre', 'RC'],
    ['--pre', 'rc1'],
    ['--pre', 'a/b'],
    ['--pre', 'rc', '--exit-pre'],
    ['patch'],
  ]) {
    it(`rejects ${argv.join(' ')}`, () => {
      assert.equal(typeof parseFlags(argv), 'string');
    });
  }
});

describe('release: a stable patch', () => {
  it('commits, tags (annotated) and pushes; daemon and vscode keep their versions', async () => {
    await withReleaseFixture(async (f) => {
      f.addChangeset('quiet-owl', 'patch', 'Fixed', 'something broke no more');
      f.tools.answers.push('y');
      const result = await f.release([]);
      assert.equal(result.code, 0, text(result));
      assert.match(text(result), /v0\.3\.1 was pushed/);
      assert.deepEqual(f.originTags(), ['v0.3.0', 'v0.3.1']);
      assert.equal(f.originHead(), f.git('rev-parse', 'HEAD').stdout.trim());
      assert.equal(
        f.git('log', '-1', '--format=%s').stdout.trim(),
        'chore: release v0.3.1',
      );
      assert.equal(f.git('cat-file', '-t', 'v0.3.1').stdout.trim(), 'tag');
      assert.equal(
        f.git('rev-parse', 'v0.3.1^{commit}').stdout,
        f.git('rev-parse', 'HEAD').stdout,
      );
      assert.match(
        f.read('CHANGELOG.md'),
        /## \[0\.3\.1\] - 2026-11-01\n\n### Fixed\n\n- something broke no more/,
      );
      assert.match(
        f.read('packages/shiori-cli/src/core/version.ts'),
        /VERSION = '0\.3\.1'/,
      );
      assert.equal(pkgVersion(f), '0.3.1');
      assert.equal(pkgVersion(f, 'shiori-daemon'), '0.1.0');
      assert.equal(pkgVersion(f, 'shiori-vscode'), '0.1.0');
      const changed = f
        .git('diff-tree', '--no-commit-id', '--name-status', '-r', 'HEAD')
        .stdout.trim()
        .split('\n')
        .sort();
      assert.deepEqual(changed, [
        'D\t.changeset/quiet-owl.md',
        'M\tCHANGELOG.md',
        'M\tpackages/shiori-cli/package.json',
        'M\tpackages/shiori-cli/src/core/version.ts',
      ]);
    });
  });

  it('N: exits 0, leaves the bump in the work tree, prints the undo, and origin is unchanged', async () => {
    await withReleaseFixture(async (f) => {
      f.addChangeset('quiet-owl', 'patch', 'Fixed', 'x');
      const originBefore = f.originHead();
      f.tools.answers.push('n');
      const result = await f.release([]);
      assert.equal(result.code, 0, text(result));
      assert.equal(f.originHead(), originBefore);
      assert.deepEqual(f.originTags(), ['v0.3.0']);
      assert.equal(pkgVersion(f), '0.3.1');
      assert.match(text(result), /git reset --hard HEAD/);
    });
  });

  it('after N, the next run says the tree holds a leftover bump (row 1) and offers the reset', async () => {
    await withReleaseFixture(async (f) => {
      f.addChangeset('quiet-owl', 'patch', 'Fixed', 'x');
      f.tools.answers.push('n');
      await f.release([]);
      const result = await f.release([]);
      assert.equal(result.code, 1);
      assert.match(text(result), /\(row 1\)/);
      assert.match(text(result), /try: git reset --hard HEAD && git clean -fd/);
    });
  });
});

describe('release: pre mode', () => {
  it('--pre rc: a prerelease commit with pre.json, no CHANGELOG section, daemon and vscode untouched', async () => {
    await withReleaseFixture(async (f) => {
      f.addChangeset('big-fox', 'minor', 'Added', 'a new thing');
      f.tools.answers.push('y');
      const rc = await f.release(['--pre', 'rc']);
      assert.equal(rc.code, 0, text(rc));
      assert.deepEqual(f.originTags(), ['v0.3.0', 'v0.4.0-rc.0']);
      assert.equal(pkgVersion(f), '0.4.0-rc.0');
      assert.equal(pkgVersion(f, 'shiori-daemon'), '0.1.0');
      assert.equal(pkgVersion(f, 'shiori-vscode'), '0.1.0');
      assert.doesNotMatch(f.read('CHANGELOG.md'), /0\.4\.0/);
      assert.ok(
        f.git('ls-files', '.changeset/big-fox.md').stdout.includes('big-fox'),
      );
      assert.ok(
        f
          .git('show', '--name-only', '--format=', 'HEAD')
          .stdout.includes('.changeset/pre.json'),
      );
    });
  });

  it('--pre rc then --exit-pre releases the stable version with every rc changeset', async () => {
    await withReleaseFixture(async (f) => {
      f.addChangeset('big-fox', 'minor', 'Added', 'a new thing');
      f.tools.answers.push('y');
      assert.equal((await f.release(['--pre', 'rc'])).code, 0);
      // published, so the entry does not read it as an unfinished release (row 2)
      f.tools.npmVersions.push('0.4.0-rc.0');
      f.tools.answers.push('y');
      const stable = await f.release(['--exit-pre']);
      assert.equal(stable.code, 0, text(stable));
      assert.deepEqual(f.originTags(), ['v0.3.0', 'v0.4.0', 'v0.4.0-rc.0']);
      assert.equal(pkgVersion(f), '0.4.0');
      assert.match(
        f.read('CHANGELOG.md'),
        /## \[0\.4\.0\] - 2026-11-01\n\n### Added\n\n- a new thing/,
      );
      assert.equal(pkgVersion(f, 'shiori-daemon'), '0.1.0');
      assert.equal(pkgVersion(f, 'shiori-vscode'), '0.1.0');
      assert.equal(f.git('ls-files', '.changeset/big-fox.md').stdout, '');
    });
  });

  it('--pre rc without a changeset stops before pre.json is written', async () => {
    await withReleaseFixture(async (f) => {
      const result = await assertUnchanged(f, () => f.release(['--pre', 'rc']));
      assert.match(text(result), /no pending changeset/);
      assert.equal(
        f.tools.calls.some((c) => c.includes('pre enter')),
        false,
      );
    });
  });

  it('--exit-pre outside pre mode stops and changes nothing', async () => {
    await withReleaseFixture(async (f) => {
      f.addChangeset('big-fox', 'minor', 'Added', 'x');
      await assertUnchanged(f, () => f.release(['--exit-pre']));
    });
  });

  it('--pre rc in pre mode with no new changeset stops at the version check and changes nothing', async () => {
    await withReleaseFixture(async (f) => {
      f.addChangeset('big-fox', 'minor', 'Added', 'x');
      f.tools.answers.push('y');
      await f.release(['--pre', 'rc']);
      f.tools.npmVersions.push('0.4.0-rc.0');
      const result = await assertUnchanged(f, () => f.release(['--pre', 'rc']));
      assert.match(text(result), /stopped at stage 2/);
    });
  });
});

describe('release: the entry', () => {
  it('stops when GIT_DIR points at another repository', async () => {
    await withReleaseFixture(async (f) => {
      f.tools.gitEnv = { GIT_DIR: join(f.remote) };
      const result = await f.release([]);
      assert.equal(result.code, 1);
      assert.match(text(result), /other than the one in the current directory/);
      f.tools.gitEnv = {};
      assert.equal(f.git('status', '--porcelain=v1').stdout, '');
    });
  });

  it('stops without a terminal', async () => {
    await withReleaseFixture(async (f) => {
      f.addChangeset('quiet-owl', 'patch', 'Fixed', 'x');
      await assertUnchanged(f, () => f.release([], { tty: false }));
    });
  });

  for (const argv of [
    ['--yes'],
    ['--pre'],
    ['--pre', 'RC'],
    ['--pre', 'rc1'],
    ['--pre', 'a/b'],
    ['--pre', 'rc', '--exit-pre'],
    ['patch'],
  ]) {
    it(`flags ${argv.join(' ')} exit 1 and change nothing`, async () => {
      await withReleaseFixture(async (f) => {
        await assertUnchanged(f, () => f.release(argv));
        assert.deepEqual(f.tools.calls, []);
      });
    });
  }

  it('row 10: nothing to release exits 0', async () => {
    await withReleaseFixture(async (f) => {
      // published, but origin has no tag for it: row 3 does not apply
      f.git('push', 'origin', ':refs/tags/v0.3.0');
      f.git('tag', '-d', 'v0.3.0');
      const result = await f.release([]);
      assert.equal(result.code, 0, text(result));
      assert.match(text(result), /\(row 10\)/);
    });
  });

  it('row 3 (published, nothing pending) is a provisional success', async () => {
    await withReleaseFixture(async (f) => {
      const result = await f.release([]);
      assert.equal(result.code, 0, text(result));
      assert.match(text(result), /\(row 3\)/);
    });
  });

  it('rows 2 and 3 are provisional stops that point at the manual steps', async () => {
    await withReleaseFixture(async (f) => {
      f.addChangeset('quiet-owl', 'patch', 'Fixed', 'x');
      f.tools.answers.push('y');
      assert.equal((await f.release([])).code, 0);
      const row2 = await f.release([]);
      assert.equal(row2.code, 1);
      assert.match(text(row2), /Checks before approval/);

      f.tools.npmVersions.push('0.3.1');
      f.tools.npmLatest = '0.3.1';
      const row3 = await f.release([]);
      assert.equal(row3.code, 0, text(row3));
      assert.match(text(row3), /Post-release checks/);
    });
  });

  it('row 1: unrelated changes get no destructive command', async () => {
    await withReleaseFixture(async (f) => {
      f.write('notes.txt', 'mine');
      const result = await assertUnchanged(f, () => f.release([]));
      assert.match(text(result), /\(row 1\)/);
      assert.doesNotMatch(text(result), /git reset|git clean/);
    });
  });
});

describe('release: stage 1 stops and changes nothing', () => {
  it('branch is not master', async () => {
    await withReleaseFixture(async (f) => {
      f.addChangeset('quiet-owl', 'patch', 'Fixed', 'x');
      f.git('switch', '-c', 'other');
      const result = await assertUnchanged(f, () => f.release([]));
      assert.match(text(result), /not master/);
    });
  });

  it('HEAD is one commit behind origin/master', async () => {
    await withReleaseFixture(async (f) => {
      f.addChangeset('quiet-owl', 'patch', 'Fixed', 'x');
      f.write('later.txt', 'x');
      f.git('add', '-A');
      f.git('commit', '-m', 'later');
      f.git('push', 'origin', 'master');
      f.git('reset', '--hard', 'HEAD~1');
      const result = await assertUnchanged(f, () => f.release([]));
      assert.match(text(result), /not origin\/master/);
    });
  });

  it('HEAD is one commit ahead of origin/master', async () => {
    await withReleaseFixture(async (f) => {
      f.addChangeset('quiet-owl', 'patch', 'Fixed', 'x');
      f.write('a.txt', 'a');
      f.git('add', '-A');
      f.git('commit', '-m', 'wip');
      const result = await assertUnchanged(f, () => f.release([]));
      assert.match(text(result), /not origin\/master/);
    });
  });

  it('a quality check fails', async () => {
    await withReleaseFixture(async (f) => {
      f.addChangeset('quiet-owl', 'patch', 'Fixed', 'x');
      f.tools.failQuality = 'test';
      const result = await assertUnchanged(f, () => f.release([]));
      assert.match(text(result), /pnpm test failed/);
    });
  });

  it('a quality check leaves the work tree changed', async () => {
    await withReleaseFixture(async (f) => {
      f.addChangeset('quiet-owl', 'patch', 'Fixed', 'x');
      f.tools.onQuality['build'] = () => f.write('stray.txt', 'x');
      const before = f.git('rev-parse', 'HEAD').stdout;
      const result = await f.release([]);
      assert.equal(result.code, 1);
      assert.match(text(result), /changed the working tree/);
      assert.equal(f.git('rev-parse', 'HEAD').stdout, before);
      assert.deepEqual(f.originTags(), ['v0.3.0']);
    });
  });

  const trustCases: [string, () => ReleaseFixture['tools']['trust']][] = [
    [
      'two trust entries',
      () => ({
        code: 0,
        stdout: JSON.stringify([TRUST, { ...TRUST, file: 'publish.yml' }]),
        stderr: '',
      }),
    ],
    ['trust exits non-zero', () => ({ code: 1, stdout: 'boom', stderr: '' })],
    ['trust prints nothing', () => ({ code: 0, stdout: '', stderr: '' })],
  ];
  for (const [name, trust] of trustCases) {
    it(name, async () => {
      await withReleaseFixture(async (f) => {
        f.addChangeset('quiet-owl', 'patch', 'Fixed', 'x');
        f.tools.trust = trust();
        const result = await assertUnchanged(f, () => f.release([]));
        assert.match(text(result), /raw output saved under/);
        assert.match(text(result), /Verify trust and protections by hand/);
      });
    });
  }

  it('EOTP in stderr says so and shows no evidence location', async () => {
    await withReleaseFixture(async (f) => {
      f.addChangeset('quiet-owl', 'patch', 'Fixed', 'x');
      f.tools.trust = { code: 1, stdout: '', stderr: 'npm error code EOTP' };
      const result = await assertUnchanged(f, () => f.release([]));
      assert.match(text(result), /one-time password/);
      assert.doesNotMatch(text(result), /raw output saved under/);
    });
  });

  it('the environment allows every branch', async () => {
    await withReleaseFixture(async (f) => {
      f.addChangeset('quiet-owl', 'patch', 'Fixed', 'x');
      const base = JSON.parse(
        readFileSync(
          new URL('./fixtures/gh-environment.json', import.meta.url),
          'utf8',
        ),
      ) as Record<string, unknown>;
      f.tools.ghOverrides['environments/npm'] = {
        code: 0,
        stdout: JSON.stringify({
          ...base,
          deployment_branch_policy: {
            protected_branches: false,
            custom_branch_policies: false,
          },
        }),
      };
      const result = await assertUnchanged(f, () => f.release([]));
      assert.match(text(result), /environment "npm": mismatch/);
    });
  });

  it('the tag ruleset lets a user bypass', async () => {
    await withReleaseFixture(async (f) => {
      f.addChangeset('quiet-owl', 'patch', 'Fixed', 'x');
      const detail = JSON.parse(
        readFileSync(
          new URL('./fixtures/gh-ruleset-detail.json', import.meta.url),
          'utf8',
        ),
      ) as Record<string, unknown>;
      f.tools.ghOverrides['rulesets/24324650'] = {
        code: 0,
        stdout: JSON.stringify({
          ...detail,
          bypass_actors: [
            { actor_id: 7, actor_type: 'User', bypass_mode: 'always' },
          ],
        }),
      };
      const result = await assertUnchanged(f, () => f.release([]));
      assert.match(text(result), /tag ruleset: mismatch/);
    });
  });

  it('a gh call fails', async () => {
    await withReleaseFixture(async (f) => {
      f.addChangeset('quiet-owl', 'patch', 'Fixed', 'x');
      f.tools.ghOverrides['rulesets'] = { code: 1, stdout: '' };
      await assertUnchanged(f, () => f.release([]));
    });
  });

  it('config.json lets changelog load a module', async () => {
    await withReleaseFixture(async (f) => {
      f.addChangeset('quiet-owl', 'patch', 'Fixed', 'x');
      const config = JSON.parse(f.read('.changeset/config.json')) as Record<
        string,
        unknown
      >;
      f.write(
        '.changeset/config.json',
        JSON.stringify({ ...config, changelog: './x.js' }),
      );
      f.git('add', '-A');
      f.git('commit', '-m', 'config');
      f.git('push', 'origin', 'master');
      const result = await assertUnchanged(f, () => f.release([]));
      assert.match(text(result), /\.changeset\/config\.json: mismatch/);
    });
  });

  it('origin is another repository', async () => {
    await withReleaseFixture(async (f) => {
      f.addChangeset('quiet-owl', 'patch', 'Fixed', 'x');
      f.tools.originUrl = 'https://github.com/someone/shiori.git';
      await assertUnchanged(f, () => f.release([]));
    });
  });

  it('[Unreleased] holds a hand-written entry', async () => {
    await withReleaseFixture(async (f) => {
      f.addChangeset('quiet-owl', 'patch', 'Fixed', 'x');
      pushChangelog(
        f,
        '# Changelog\n\n## [Unreleased]\n\n- hand written\n\n## [0.3.0] - 2026-10-25\n\n### Fixed\n\n- an old fix\n',
      );
      const result = await assertUnchanged(f, () => f.release([]));
      assert.match(text(result), /must be empty/);
    });
  });
});

describe('release: stage 2 stops leave the bump and print the undo', () => {
  it('status contains a release for a name that is not in ignore', async () => {
    await withReleaseFixture(async (f) => {
      f.addChangeset('quiet-owl', 'patch', 'Fixed', 'x');
      f.tools.statusOutput = JSON.stringify({
        changesets: [],
        releases: [
          {
            name: '@berlysia/shiori',
            type: 'patch',
            oldVersion: '0.3.0',
            changesets: ['quiet-owl'],
            newVersion: '0.3.1',
          },
          {
            name: '@berlysia/other',
            type: 'patch',
            oldVersion: '0.1.0',
            changesets: [],
            newVersion: '0.1.1',
          },
        ],
      });
      // --pre rc: `changeset pre enter` has already written pre.json when the
      // status is read, so there is something to revert
      f.tools.answers.push('y');
      const result = await f.release(['--pre', 'rc']);
      assert.equal(result.code, 1);
      assert.match(text(result), /stopped at/);
      assert.match(text(result), /@berlysia\/other/);
      assert.match(text(result), /try: git reset --hard HEAD/);
      assert.deepEqual(f.originTags(), ['v0.3.0']);
    });
  });

  it('a hand-written section for the new version already exists', async () => {
    await withReleaseFixture(async (f) => {
      f.addChangeset('quiet-owl', 'patch', 'Fixed', 'x');
      pushChangelog(
        f,
        '# Changelog\n\n## [Unreleased]\n\n## [0.3.1] - 2026-10-30\n\n### Fixed\n\n- early\n\n## [0.3.0] - 2026-10-25\n\n### Fixed\n\n- an old fix\n',
      );
      const result = await f.release([]);
      assert.equal(result.code, 1);
      assert.match(text(result), /stage 2/);
      assert.match(text(result), /try: git reset --hard HEAD/);
      assert.deepEqual(f.originTags(), ['v0.3.0']);
    });
  });
});

describe('release: stage 3 stops', () => {
  it('the version is already published', async () => {
    await withReleaseFixture(async (f) => {
      f.addChangeset('quiet-owl', 'patch', 'Fixed', 'x');
      f.tools.npmVersions = ['0.3.0', '0.3.1'];
      const result = await f.release([]);
      assert.equal(result.code, 1);
      assert.match(text(result), /already published/);
    });
  });

  it('a stable version is not newer than latest', async () => {
    await withReleaseFixture(async (f) => {
      f.addChangeset('quiet-owl', 'patch', 'Fixed', 'x');
      f.tools.npmLatest = '0.3.1';
      const result = await f.release([]);
      assert.equal(result.code, 1);
      assert.match(text(result), /not newer than the latest/);
    });
  });

  it('the tag exists locally', async () => {
    await withReleaseFixture(async (f) => {
      f.addChangeset('quiet-owl', 'patch', 'Fixed', 'x');
      f.git('tag', 'v0.3.1', 'HEAD~1');
      const result = await f.release([]);
      assert.equal(result.code, 1);
      assert.match(text(result), /already exists locally/);
    });
  });

  it('the tag exists on origin', async () => {
    await withReleaseFixture(async (f) => {
      f.addChangeset('quiet-owl', 'patch', 'Fixed', 'x');
      f.git('tag', 'v0.3.1', 'HEAD~1');
      f.git('push', 'origin', 'v0.3.1');
      f.git('tag', '-d', 'v0.3.1');
      const result = await f.release([]);
      assert.equal(result.code, 1);
      assert.match(text(result), /already exists on origin/);
    });
  });
});

describe('release: stage 5', () => {
  it('a file staged by someone else stops before the commit and the tag', async () => {
    await withReleaseFixture(async (f) => {
      f.addChangeset('quiet-owl', 'patch', 'Fixed', 'x');
      const head = f.git('rev-parse', 'HEAD').stdout;
      f.tools.onPrompt = () => {
        f.write('notes.txt', 'x');
        f.git('add', 'notes.txt');
      };
      f.tools.answers.push('y');
      const result = await f.release([]);
      assert.equal(result.code, 1);
      assert.match(text(result), /No commit was made/);
      assert.equal(f.git('rev-parse', 'HEAD').stdout, head);
      assert.equal(f.git('tag', '--list', 'v0.3.1').stdout, '');
    });
  });

  it('a post-commit hook that amends the commit stops before the tag', async () => {
    await withReleaseFixture(async (f) => {
      f.addChangeset('quiet-owl', 'patch', 'Fixed', 'x');
      const hooks = join(f.dir, 'hooks');
      writeHook(
        hooks,
        'post-commit',
        `if [ ! -f '${join(f.dir, 'amended')}' ]; then touch '${join(f.dir, 'amended')}'; echo x > extra.txt; git add extra.txt; git commit --amend --no-edit --no-verify >/dev/null; fi`,
      );
      f.git('config', 'core.hooksPath', hooks);
      f.tools.answers.push('y');
      const result = await f.release([]);
      assert.equal(result.code, 1, text(result));
      assert.match(text(result), /does not hold exactly the release changes/);
      assert.match(text(result), /try: git reset --hard origin\/master/);
      assert.equal(f.git('tag', '--list', 'v0.3.1').stdout, '');
      assert.deepEqual(f.originTags(), ['v0.3.0']);
    });
  });

  it('a pre-commit hook that stages .fallowrc.json does not run', async () => {
    await withReleaseFixture(async (f) => {
      f.addChangeset('quiet-owl', 'patch', 'Fixed', 'x');
      const hooks = join(f.dir, 'hooks');
      writeHook(
        hooks,
        'pre-commit',
        `touch '${join(f.dir, 'hook-ran')}'; echo x > .fallowrc.json; git add .fallowrc.json`,
      );
      f.git('config', 'core.hooksPath', hooks);
      f.tools.answers.push('y');
      const result = await f.release([]);
      assert.equal(result.code, 0, text(result));
      assert.equal(existsSync(join(f.dir, 'hook-ran')), false);
      const changed = f
        .git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD')
        .stdout.trim()
        .split('\n');
      assert.equal(changed.length, 4);
      assert.equal(changed.includes('.fallowrc.json'), false);
    });
  });
});

describe('release: stage 6', () => {
  it('a refused push leaves origin unchanged and prints the retry; the next run stops at row 5', async () => {
    await withReleaseFixture(async (f) => {
      f.addChangeset('quiet-owl', 'patch', 'Fixed', 'x');
      writeHook(join(f.remote, 'hooks'), 'pre-receive', 'exit 1');
      const originBefore = f.originHead();
      f.tools.answers.push('y');
      const result = await f.release([]);
      assert.equal(result.code, 1, text(result));
      assert.equal(f.originHead(), originBefore);
      assert.deepEqual(f.originTags(), ['v0.3.0']);
      assert.equal(
        f.git('log', '-1', '--format=%s').stdout.trim(),
        'chore: release v0.3.1',
      );
      assert.ok(f.git('tag', '--list', 'v0.3.1').stdout.includes('v0.3.1'));
      assert.match(
        text(result),
        /git push --atomic origin refs\/heads\/master:refs\/heads\/master refs\/tags\/v0\.3\.1:refs\/tags\/v0\.3\.1/,
      );
      assert.match(
        text(result),
        /git tag -d v0\.3\.1 && git reset --hard origin\/master/,
      );

      const again = await f.release([]);
      assert.equal(again.code, 1);
      assert.match(text(again), /\(row 5\)/);
    });
  });

  it('a ruleset that stopped being safe before the push stops without pushing', async () => {
    await withReleaseFixture(async (f) => {
      f.addChangeset('quiet-owl', 'patch', 'Fixed', 'x');
      const originBefore = f.originHead();
      f.tools.onPrompt = () => {
        f.tools.ghOverrides['rulesets/24324650'] = {
          code: 0,
          stdout: '{"target":"tag"}',
        };
      };
      f.tools.answers.push('y');
      const result = await f.release([]);
      assert.equal(result.code, 1, text(result));
      assert.equal(f.originHead(), originBefore);
      assert.match(text(result), /tag ruleset: mismatch/);
      assert.match(text(result), /git push --atomic/);
    });
  });
});

describe('release: row 6 (a release commit without its tag)', () => {
  async function leaveCommitWithoutTag(f: ReleaseFixture): Promise<void> {
    f.addChangeset('quiet-owl', 'patch', 'Fixed', 'x');
    writeHook(join(f.remote, 'hooks'), 'pre-receive', 'exit 1');
    f.tools.answers.push('y');
    await f.release([]);
    f.git('tag', '-d', 'v0.3.1');
    spawnSync('rm', ['-f', join(f.remote, 'hooks', 'pre-receive')]);
  }

  it('resumes at the tag and pushes', async () => {
    await withReleaseFixture(async (f) => {
      await leaveCommitWithoutTag(f);
      const result = await f.release([]);
      assert.equal(result.code, 0, text(result));
      assert.deepEqual(f.originTags(), ['v0.3.0', 'v0.3.1']);
      assert.equal(f.originHead(), f.git('rev-parse', 'HEAD').stdout.trim());
      assert.equal(f.git('cat-file', '-t', 'v0.3.1').stdout.trim(), 'tag');
    });
  });

  it('refuses a commit whose package.json gained a postinstall script', async () => {
    await withReleaseFixture(async (f) => {
      await leaveCommitWithoutTag(f);
      const manifest = JSON.parse(f.read(PKG)) as Record<string, unknown>;
      f.write(
        PKG,
        `${JSON.stringify({ ...manifest, scripts: { postinstall: 'echo x' } }, null, 2)}\n`,
      );
      f.git('add', '-A');
      f.git('commit', '--amend', '--no-edit');
      const result = await f.release([]);
      assert.equal(result.code, 1, text(result));
      assert.match(text(result), /not the one this script would have made/);
      assert.match(text(result), /try: git reset --hard origin\/master/);
      assert.equal(f.git('tag', '--list', 'v0.3.1').stdout, '');
      assert.deepEqual(f.originTags(), ['v0.3.0']);
    });
  });

  it('with flags it stops instead of resuming', async () => {
    await withReleaseFixture(async (f) => {
      await leaveCommitWithoutTag(f);
      const result = await f.release(['--pre', 'rc']);
      assert.equal(result.code, 1);
      assert.match(text(result), /\(row 6\)/);
    });
  });
});
