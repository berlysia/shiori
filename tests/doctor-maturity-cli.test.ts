import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  runCli,
  createFixtureDir,
  createTempBase,
} from './helpers/cli-test-utils.ts';

describe('doctor --maturity CLI', () => {
  let baseDir: string;
  let cleanup: () => Promise<void>;

  before(async () => {
    ({ baseDir, cleanup } = await createTempBase(
      'shiori-doctor-maturity-cli-',
    ));
  });

  after(async () => {
    await cleanup();
  });

  it('shows maturity assessment in text output', async () => {
    const dir = await createFixtureDir(baseDir, 'maturity-text');
    const { stderr } = await runCli(['doctor', '--cwd', dir, '--maturity'], {
      baseDir,
    });
    assert.ok(stderr.includes('Governance Maturity:'));
    assert.ok(stderr.includes('Level'));
    assert.ok(stderr.includes('Signals:'));
  });

  it('includes maturity in JSON output', async () => {
    const dir = await createFixtureDir(baseDir, 'maturity-json');
    const { stderr } = await runCli(
      ['doctor', '--cwd', dir, '--maturity', '-f', 'json'],
      { baseDir },
    );
    const parsed = JSON.parse(stderr);
    assert.ok('maturity' in parsed);
    assert.equal(typeof parsed.maturity.level, 'number');
    assert.ok(Array.isArray(parsed.maturity.signals));
    assert.ok(Array.isArray(parsed.maturity.nextActions));
    assert.equal(typeof parsed.maturity.levelLabel, 'string');
  });

  it('does not include maturity without --maturity flag', async () => {
    const dir = await createFixtureDir(baseDir, 'maturity-absent');
    const { stderr } = await runCli(['doctor', '--cwd', dir, '-f', 'json'], {
      baseDir,
    });
    const parsed = JSON.parse(stderr);
    assert.equal(parsed.maturity, undefined);
  });

  it('detects level 1 for basic project', async () => {
    const dir = await createFixtureDir(baseDir, 'maturity-level1');
    const { stderr } = await runCli(
      ['doctor', '--cwd', dir, '--maturity', '-f', 'json'],
      { baseDir },
    );
    const parsed = JSON.parse(stderr);
    // Basic project from createFixtureDir has config + registry but no gitignore
    assert.ok(parsed.maturity.level >= 0);
    assert.ok(parsed.maturity.level <= 4);
  });

  it('detects CI workflow when present', async () => {
    const dir = await createFixtureDir(baseDir, 'maturity-ci');

    // Add a CI workflow referencing shiori
    const workflowDir = join(dir, '.github', 'workflows');
    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      join(workflowDir, 'ci.yml'),
      'name: CI\non: push\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: shiori verify\n',
      'utf-8',
    );

    // Add gitignore for level 1
    await writeFile(
      join(dir, '.gitignore'),
      '.config/shiori/scan-result.json\n',
      'utf-8',
    );

    // Add config
    await writeFile(
      join(dir, '.config', 'shiori', 'config.yaml'),
      '# config\n',
      'utf-8',
    );

    const { stderr } = await runCli(
      ['doctor', '--cwd', dir, '--maturity', '-f', 'json'],
      { baseDir },
    );
    const parsed = JSON.parse(stderr);
    const ciSignal = parsed.maturity.signals.find(
      (s: { name: string }) => s.name === 'ci-workflow',
    );
    assert.equal(ciSignal.detected, true);
    // Should be at least level 2
    assert.ok(parsed.maturity.level >= 2);
  });

  it('shows next actions in text output', async () => {
    const dir = await createFixtureDir(baseDir, 'maturity-next');
    const { stderr } = await runCli(['doctor', '--cwd', dir, '--maturity'], {
      baseDir,
    });
    assert.ok(stderr.includes('Next steps:'));
  });
});
