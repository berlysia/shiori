import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkGitDirection, expectedGitDir } from './git-direction.ts';

describe('expectedGitDir', () => {
  it('is <cwd>/.git for the directory form', () => {
    assert.deepEqual(expectedGitDir('/r', { kind: 'directory' }), {
      ok: true,
      path: '/r/.git',
    });
  });
  it('reads an absolute gitdir line', () => {
    assert.deepEqual(
      expectedGitDir('/r', {
        kind: 'file',
        content: 'gitdir: /m/.git/worktrees/x\n',
      }),
      { ok: true, path: '/m/.git/worktrees/x' },
    );
  });
  it('resolves a relative gitdir line from cwd', () => {
    assert.deepEqual(
      expectedGitDir('/r/w', {
        kind: 'file',
        content: 'gitdir: ../.git/worktrees/x',
      }),
      { ok: true, path: '/r/.git/worktrees/x' },
    );
  });
  for (const content of [
    '',
    'hello\n',
    'gitdir:\n',
    'gitdir: \n',
    'gitdir: /a\ngitdir: /b\n',
    'gitdir:/a\n',
  ]) {
    it(`rejects a malformed file ${JSON.stringify(content)}`, () => {
      assert.equal(expectedGitDir('/r', { kind: 'file', content }).ok, false);
    });
  }
  it('rejects an unreadable or special .git', () => {
    assert.equal(expectedGitDir('/r', { kind: 'unreadable' }).ok, false);
    assert.equal(expectedGitDir('/r', { kind: 'other' }).ok, false);
  });
});

describe('checkGitDirection', () => {
  const same = {
    realCwd: '/r',
    realToplevel: '/r',
    realExpectedGitDir: '/r/.git',
    realActualGitDir: '/r/.git',
  };
  it('passes when both agree', () => {
    assert.deepEqual(checkGitDirection(same), []);
  });
  it('fails on a different top level', () => {
    assert.equal(
      checkGitDirection({ ...same, realToplevel: '/other' }).length,
      1,
    );
  });
  it('fails on a different git directory', () => {
    assert.equal(
      checkGitDirection({ ...same, realActualGitDir: '/other/.git' }).length,
      1,
    );
  });
});
