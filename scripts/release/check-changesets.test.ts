import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTempDir } from './testing/test-workspace.ts';

const SCRIPT = fileURLToPath(new URL('./check-changesets.ts', import.meta.url));
const VALID = '---\n"@berlysia/shiori": patch\n---\n\n### Fixed\n\n- ok\n';
const CLEAN_CHANGELOG =
  '# Changelog\n\n## [Unreleased]\n\n## [0.3.0] - 2026-10-25\n';

// The check runs as a process, the way CI and `pnpm run check:changesets`
// start it: the entrypoint wiring is part of what is tested.
function run(root: string) {
  return spawnSync(
    process.execPath,
    ['--experimental-strip-types', SCRIPT, root],
    {
      encoding: 'utf8',
      timeout: 30_000,
    },
  );
}

function repo(
  dir: string,
  files: Record<string, string> = {},
  changelog: string | null = CLEAN_CHANGELOG,
): void {
  mkdirSync(join(dir, '.changeset'));
  writeFileSync(join(dir, '.changeset', 'README.md'), '# readme\n');
  writeFileSync(join(dir, '.changeset', 'config.json'), '{}\n');
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, '.changeset', name), text);
  }
  if (changelog !== null) writeFileSync(join(dir, 'CHANGELOG.md'), changelog);
}

describe('check-changesets', () => {
  it('exits 0 and prints nothing for a clean repo', async () => {
    await withTempDir((dir) => {
      repo(dir);
      const result = run(dir);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, '');
      assert.equal(result.stdout, '');
    });
  });

  it('exits 0 for a valid changeset; README.md and config.json are not checked', async () => {
    await withTempDir((dir) => {
      repo(dir, { 'good-cat.md': VALID });
      assert.equal(run(dir).status, 0);
    });
  });

  it('reports the file and line of an invalid changeset', async () => {
    await withTempDir((dir) => {
      repo(dir, {
        'good-cat.md': VALID,
        'bad-dog.md':
          '---\n"@berlysia/shiori": patch\n---\n\n### Notes\n\n- x\n',
      });
      const result = run(dir);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /\.changeset\/bad-dog\.md:5: /);
      assert.doesNotMatch(result.stderr, /good-cat/);
    });
  });

  it('reports an entry under [Unreleased] with its line', async () => {
    await withTempDir((dir) => {
      repo(
        dir,
        {},
        '# Changelog\n\n## [Unreleased]\n\n- pending\n\n## [0.3.0] - 2026-10-25\n',
      );
      const result = run(dir);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /CHANGELOG\.md:5: /);
    });
  });

  it('keeps ESC out of stderr, whether it is in an entry or in a file name', async () => {
    await withTempDir((dir) => {
      repo(dir, {
        'esc-entry.md':
          '---\n"@berlysia/shiori": patch\n---\n\n### Fixed\n\n- a\u001b[31mb\n',
        'esc-name-\u001b[2J.md': 'not a changeset\n',
      });
      const result = run(dir);
      assert.equal(result.status, 1);
      assert.equal(result.stderr.includes('\u001b'), false);
      assert.match(result.stderr, /esc-entry\.md:7/);
      assert.match(result.stderr, /esc-name-\[2J\.md/);
    });
  });

  it('does not follow a symlink, enter a directory or read a huge file', async () => {
    await withTempDir((dir) => {
      repo(dir);
      writeFileSync(join(dir, 'outside.txt'), VALID);
      symlinkSync(join(dir, 'outside.txt'), join(dir, '.changeset', 'x.md'));
      mkdirSync(join(dir, '.changeset', 'y.md'));
      writeFileSync(join(dir, '.changeset', 'z.md'), 'a'.repeat(70000));
      const result = run(dir);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /\.changeset\/x\.md:1: /);
      assert.match(result.stderr, /\.changeset\/y\.md:1: /);
      assert.match(result.stderr, /\.changeset\/z\.md:1: /);
    });
  });

  it('fails with one line and no stack trace when .changeset/ is missing', async () => {
    await withTempDir((dir) => {
      writeFileSync(join(dir, 'CHANGELOG.md'), CLEAN_CHANGELOG);
      const result = run(dir);
      assert.equal(result.status, 1);
      assert.equal(result.stderr.trim().split('\n').length, 1);
      assert.doesNotMatch(result.stderr, /\n\s+at /);
    });
  });

  it('fails with one line and no stack trace when CHANGELOG.md is missing', async () => {
    await withTempDir((dir) => {
      repo(dir, {}, null);
      const result = run(dir);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /CHANGELOG\.md/);
      assert.doesNotMatch(result.stderr, /\n\s+at /);
    });
  });
});
