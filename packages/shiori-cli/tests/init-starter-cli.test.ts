import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { runCli, createTempBase } from './helpers/cli-test-utils.ts';
import { STARTER_KINDS } from '../src/templates/starter.ts';

describe('init --starter CLI integration', () => {
  let baseDir: string;
  let cleanup: () => Promise<void>;

  before(async () => {
    ({ baseDir, cleanup } = await createTempBase('shiori-init-starter-'));
  });

  after(async () => {
    await cleanup();
  });

  describe('argument validation', () => {
    it('rejects invalid --starter value', async () => {
      const initDir = await mkdtemp(join(baseDir, 'invalid-'));
      const { exitCode, stderr } = await runCli([
        'init',
        '--cwd',
        initDir,
        '--starter',
        'nonexistent',
      ]);
      assert.equal(exitCode, 1);
      assert.ok(stderr.includes('Invalid --starter value'));
      assert.ok(stderr.includes('nonexistent'));
    });
  });

  for (const kind of STARTER_KINDS) {
    describe(`--starter ${kind}`, () => {
      it('creates sample files and registry with annotations', async () => {
        const initDir = await mkdtemp(join(baseDir, `starter-${kind}-`));

        const { exitCode, stderr } = await runCli([
          'init',
          '--cwd',
          initDir,
          '--starter',
          kind,
        ]);

        assert.equal(exitCode, 0, `Expected exit code 0, stderr: ${stderr}`);
        assert.ok(stderr.includes('shiori initialized'));
        assert.ok(stderr.includes('starter:'));

        // Verify sample file was created
        const samplePath =
          kind === 'stylelint'
            ? join(initDir, 'examples', 'shiori-sample.css')
            : join(initDir, 'examples', 'shiori-sample.ts');
        const sampleContent = await readFile(samplePath, 'utf-8');
        assert.ok(
          sampleContent.includes('shiori: EXAMPLE-001'),
          'Sample file should contain shiori annotation',
        );

        // Verify registry was created with EXAMPLE-001
        const registryContent = await readFile(
          join(initDir, '.config', 'shiori', 'registry.json'),
          'utf-8',
        );
        const registry = JSON.parse(registryContent) as Record<string, unknown>;
        assert.ok(
          'EXAMPLE-001' in registry,
          'Registry should contain EXAMPLE-001 from starter template',
        );
      });

      it('check passes immediately after init --starter', async () => {
        const initDir = await mkdtemp(join(baseDir, `e2e-${kind}-`));

        // Step 1: init with starter
        const initResult = await runCli([
          'init',
          '--cwd',
          initDir,
          '--starter',
          kind,
        ]);
        assert.equal(
          initResult.exitCode,
          0,
          `init failed: ${initResult.stderr}`,
        );

        // Step 2: check should pass (exit code 0)
        const checkResult = await runCli(['check', '--cwd', initDir]);
        assert.equal(
          checkResult.exitCode,
          0,
          `check should pass after init --starter ${kind}. stderr: ${checkResult.stderr}`,
        );
      });
    });
  }

  describe('idempotent behavior', () => {
    it('second init --starter skips existing sample files', async () => {
      const initDir = await mkdtemp(join(baseDir, 'idempotent-'));

      // First init
      const first = await runCli([
        'init',
        '--cwd',
        initDir,
        '--starter',
        'minimal',
      ]);
      assert.equal(first.exitCode, 0);
      assert.ok(first.stderr.includes('starter: created'));

      // Save original sample file content
      const originalContent = await readFile(
        join(initDir, 'examples', 'shiori-sample.ts'),
        'utf-8',
      );

      // Second init
      const second = await runCli([
        'init',
        '--cwd',
        initDir,
        '--starter',
        'minimal',
      ]);
      assert.equal(second.exitCode, 0);
      assert.ok(
        second.stderr.includes('already exist'),
        `Expected idempotent skip message, got: ${second.stderr}`,
      );

      // Verify original content was preserved
      const preservedContent = await readFile(
        join(initDir, 'examples', 'shiori-sample.ts'),
        'utf-8',
      );
      assert.equal(preservedContent, originalContent);
    });
  });

  describe('combined with --ci', () => {
    it('works with --starter and --ci together', async () => {
      const initDir = await mkdtemp(join(baseDir, 'combined-'));

      const { exitCode, stderr } = await runCli([
        'init',
        '--cwd',
        initDir,
        '--starter',
        'eslint',
        '--ci',
        'basic',
      ]);

      assert.equal(exitCode, 0, `stderr: ${stderr}`);
      assert.ok(stderr.includes('starter:'));
      assert.ok(stderr.includes('ci:'));
    });
  });
});
