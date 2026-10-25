// Pins the behaviour of the real `changeset` binary (@changesets/cli 2.29.8)
// that the release flow depends on, in throwaway fixture repositories under
// the OS temp directory. A failure here means changesets changed, not that
// the fixture is wrong: do not bend an expectation to make it pass.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  withChangesetFixture,
  type ChangesetFixture,
} from './testing/test-workspace.ts';

function addChangeset(fx: ChangesetFixture, id: string, bump: string): void {
  fx.write(
    `.changeset/${id}.md`,
    `---\n"@fx/cli": ${bump}\n---\n\n### Added\n\n- entry ${id}\n`,
  );
}

interface Versions {
  cli: unknown;
  daemon: unknown;
  vscode: unknown;
  vscodeDependencies: unknown;
}

function versions(fx: ChangesetFixture): Versions {
  const vscode = fx.readJson('packages/vscode/package.json');
  return {
    cli: fx.readJson('packages/cli/package.json')['version'],
    daemon: fx.readJson('packages/daemon/package.json')['version'],
    vscode: vscode['version'],
    vscodeDependencies: vscode['dependencies'],
  };
}

function ok(
  result: { status: number | null; stderr: string },
  what: string,
): void {
  assert.equal(result.status, 0, `${what} failed: ${result.stderr}`);
}

const WORKSPACE_RANGE = { '@fx/cli': 'workspace:*' };

describe('changesets@2.29.8 behaviour', () => {
  it('S1: a minor changeset moves only the published package', async () => {
    await withChangesetFixture((fx) => {
      addChangeset(fx, 'one', 'minor');
      const { result, json } = fx.status();
      ok(result, 'status');
      assert.ok(json);
      const cli = json.releases.find((release) => release.name === '@fx/cli');
      assert.equal(cli?.newVersion, '0.4.0');
      assert.equal(cli?.type, 'minor');
      // ignored packages are never given a release other than "none"; the
      // daemon, which nothing depends on, is not listed at all
      const typeOf = (name: string): string | undefined =>
        json.releases.find((item) => item.name === name)?.type;
      assert.equal(typeOf('@fx/vscode'), 'none');
      assert.ok([undefined, 'none'].includes(typeOf('@fx/daemon')));
    });
  });

  it('S2: rc, rc, pre exit, stable; changesets@2.29.8 bumps an ignored daemon on pre exit (直ったら落ちる。plan-2 の戻しを見直す合図)', async () => {
    await withChangesetFixture((fx) => {
      // S2-1
      ok(fx.changeset('pre', 'enter', 'rc'), 'pre enter');
      addChangeset(fx, 'aaa', 'minor');
      ok(fx.changeset('version'), 'version (rc.0)');
      fx.commitAll('rc.0');
      assert.deepEqual(versions(fx), {
        cli: '0.4.0-rc.0',
        daemon: '0.1.0',
        vscode: '0.1.0',
        vscodeDependencies: WORKSPACE_RANGE,
      });
      assert.deepEqual(fx.changesetFiles(), ['aaa.md']);

      // S2-2
      addChangeset(fx, 'bbb', 'patch');
      ok(fx.changeset('version'), 'version (rc.1)');
      fx.commitAll('rc.1');
      assert.deepEqual(versions(fx), {
        cli: '0.4.0-rc.1',
        daemon: '0.1.0',
        vscode: '0.1.0',
        vscodeDependencies: WORKSPACE_RANGE,
      });
      assert.deepEqual(fx.changesetFiles(), ['aaa.md', 'bbb.md']);

      // S2-3: in pre mode, with every changeset already consumed, status
      // offers no version (spec K5 row 9)
      const inPre = fx.status();
      ok(inPre.result, 'status in pre mode');
      assert.deepEqual(inPre.json?.releases, []);

      // S2-4: after pre exit, status sees both rc changesets
      ok(fx.changeset('pre', 'exit'), 'pre exit');
      const afterExit = fx.status();
      ok(afterExit.result, 'status after pre exit');
      const cli = afterExit.json?.releases.find(
        (release) => release.name === '@fx/cli',
      );
      assert.equal(cli?.newVersion, '0.4.0');
      assert.deepEqual(
        afterExit.json?.changesets.map((changeset) => changeset.id).sort(),
        ['aaa', 'bbb'],
      );

      // S2-5: the changesets that feed the stable CHANGELOG section are still
      // on disk right before `version`, and gone right after
      assert.deepEqual(fx.changesetFiles(), ['aaa.md', 'bbb.md']);
      ok(fx.changeset('version'), 'version (stable)');
      assert.deepEqual(fx.changesetFiles(), []);
      // The ignored daemon moves 0.1.0 -> 0.1.1 although no changeset names
      // it. When changesets fixes this, the next assertion fails: that is the
      // cue to review the revert of ignored packages that plan-2 adds.
      assert.deepEqual(
        versions(fx),
        {
          cli: '0.4.0',
          daemon: '0.1.1',
          vscode: '0.1.0',
          vscodeDependencies: WORKSPACE_RANGE,
        },
        'changesets@2.29.8 bumps an ignored package on pre exit; if this fails, it was fixed: revisit plan-2 revert',
      );
    });
  });

  it('S3: pre exit outside pre mode fails', async () => {
    await withChangesetFixture((fx) => {
      const result = fx.changeset('pre', 'exit');
      assert.notEqual(result.status, 0);
    });
  });

  it('S4: a changeset naming a package that is not in the workspace fails status', async () => {
    await withChangesetFixture((fx) => {
      fx.write(
        '.changeset/ghost.md',
        '---\n"@fx/not-here": patch\n---\n\nbody\n',
      );
      const { result } = fx.status();
      assert.notEqual(result.status, 0);
    });
  });
});

describe('fixture isolation', () => {
  it('gives children an explicit environment, ignoring GIT_* and npm_config_* of the parent', async () => {
    const saved = {
      GIT_DIR: process.env['GIT_DIR'],
      npm_config_registry: process.env['npm_config_registry'],
    };
    process.env['GIT_DIR'] = '/nonexistent/elsewhere/.git';
    process.env['npm_config_registry'] = 'http://127.0.0.1:1/';
    try {
      await withChangesetFixture((fx) => {
        assert.deepEqual(Object.keys(fx.env).sort(), [
          'CI',
          'GIT_CONFIG_GLOBAL',
          'GIT_CONFIG_NOSYSTEM',
          'HOME',
          'PATH',
        ]);
        // a leaked GIT_DIR would make git fail or point it at another repo
        const top = fx.git('rev-parse', '--show-toplevel');
        assert.equal(top.status, 0);
        assert.ok(top.stdout.trim().endsWith('/repo'));
      });
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
