import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  runCli,
  createFixtureDir,
  createTempBase,
  unwrapEnvelope,
} from './helpers/cli-test-utils.ts';

describe('doctor-cli', () => {
  let baseDir: string;
  let cleanup: () => Promise<void>;

  before(async () => {
    ({ baseDir, cleanup } = await createTempBase('shiori-doctor-cli-'));
  });

  after(async () => {
    await cleanup();
  });

  it('exits 0 for a fully initialized project', async () => {
    const dir = await createFixtureDir(baseDir, 'doctor-pass');
    const { exitCode, stderr } = await runCli(['doctor', '--cwd', dir], {
      baseDir,
    });
    assert.equal(exitCode, 0);
    assert.ok(stderr.includes('shiori doctor:'));
    assert.ok(stderr.includes('✓'));
  });

  it('exits 1 when registry is missing', async () => {
    const dir = await createFixtureDir(baseDir, 'doctor-no-reg', {
      skipRegistry: true,
    });
    const { exitCode, stderr } = await runCli(['doctor', '--cwd', dir], {
      baseDir,
    });
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes('✗'));
    assert.ok(stderr.includes('Registry'));
  });

  it('shows fix suggestions with --fix flag', async () => {
    const dir = await createFixtureDir(baseDir, 'doctor-fix', {
      skipRegistry: true,
    });
    const { stderr } = await runCli(['doctor', '--cwd', dir, '--fix'], {
      baseDir,
    });
    assert.ok(stderr.includes('→'));
    assert.ok(stderr.includes('shiori init'));
  });

  it('outputs JSON with -f json', async () => {
    const dir = await createFixtureDir(baseDir, 'doctor-json');
    const { exitCode, stderr } = await runCli(
      ['doctor', '--cwd', dir, '-f', 'json'],
      { baseDir },
    );
    assert.equal(exitCode, 0);
    // JSON output goes to stderr in this command
    const parsed = unwrapEnvelope<{
      checks: unknown[];
      summary: { pass: number };
    }>(stderr, 'doctor');
    assert.ok(Array.isArray(parsed.checks));
    assert.ok('summary' in parsed);
    assert.equal(typeof parsed.summary.pass, 'number');
  });

  it('warns when config is missing but project is partially set up', async () => {
    const dir = await createFixtureDir(baseDir, 'doctor-no-config');
    // createFixtureDir creates registry but not config
    const { stderr } = await runCli(['doctor', '--cwd', dir], { baseDir });
    assert.ok(stderr.includes('Configuration'));
    // Config check should be warn (not fail), so exit code depends on other checks
  });

  it('reports invalid format', async () => {
    const dir = await createFixtureDir(baseDir, 'doctor-bad-fmt');
    const { exitCode, stderr } = await runCli(
      ['doctor', '--cwd', dir, '-f', 'invalid'],
      {
        baseDir,
      },
    );
    assert.equal(exitCode, 2);
    assert.ok(stderr.includes('Invalid'));
  });

  it('reports summary counts in text output', async () => {
    const dir = await createFixtureDir(baseDir, 'doctor-summary');
    const { stderr } = await runCli(['doctor', '--cwd', dir], { baseDir });
    assert.ok(stderr.includes('passed'));
  });
});
