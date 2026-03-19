import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runCli, createTempBase } from './helpers/cli-test-utils.ts';

describe('init --ci: CI workflow generation', () => {
  let baseDir: string;
  let cleanup: () => Promise<void>;

  before(async () => {
    ({ baseDir, cleanup } = await createTempBase('shiori-init-ci-'));
  });

  after(async () => {
    await cleanup();
  });

  describe('--ci basic', () => {
    it('generates basic workflow alongside project init', async () => {
      const initDir = await mkdtemp(join(baseDir, 'ci-basic-'));
      await mkdir(join(initDir, 'src'), { recursive: true });
      await writeFile(
        join(initDir, 'src', 'sample.ts'),
        '// shiori: CI-001\n',
        'utf-8',
      );

      const { exitCode, stderr } = await runCli([
        'init',
        '--cwd',
        initDir,
        '--patterns',
        'src/**/*.ts',
        '--ci',
        'basic',
      ]);

      assert.equal(exitCode, 0);
      assert.ok(stderr.includes('shiori initialized'));
      assert.ok(stderr.includes('ci: created .github/workflows/shiori.yml'));

      const workflow = await readFile(
        join(initDir, '.github', 'workflows', 'shiori.yml'),
        'utf-8',
      );
      assert.ok(workflow.includes('shiori check'));
      assert.ok(workflow.includes('--fail-on expired,missing-in-registry'));
    });
  });

  describe('--ci sarif', () => {
    it('generates sarif workflow', async () => {
      const initDir = await mkdtemp(join(baseDir, 'ci-sarif-'));
      await mkdir(join(initDir, 'src'), { recursive: true });
      await writeFile(
        join(initDir, 'src', 'sample.ts'),
        '// shiori: CI-002\n',
        'utf-8',
      );

      const { exitCode, stderr } = await runCli([
        'init',
        '--cwd',
        initDir,
        '--patterns',
        'src/**/*.ts',
        '--ci',
        'sarif',
      ]);

      assert.equal(exitCode, 0);
      assert.ok(stderr.includes('ci: created .github/workflows/shiori.yml'));

      const workflow = await readFile(
        join(initDir, '.github', 'workflows', 'shiori.yml'),
        'utf-8',
      );
      assert.ok(workflow.includes('security-events: write'));
      assert.ok(workflow.includes('upload-sarif'));
    });
  });

  describe('--ci delta-pr-comment', () => {
    it('generates delta PR comment workflow', async () => {
      const initDir = await mkdtemp(join(baseDir, 'ci-delta-'));
      await mkdir(join(initDir, 'src'), { recursive: true });
      await writeFile(
        join(initDir, 'src', 'sample.ts'),
        '// shiori: CI-003\n',
        'utf-8',
      );

      const { exitCode, stderr } = await runCli([
        'init',
        '--cwd',
        initDir,
        '--patterns',
        'src/**/*.ts',
        '--ci',
        'delta-pr-comment',
      ]);

      assert.equal(exitCode, 0);
      assert.ok(stderr.includes('ci: created .github/workflows/shiori.yml'));

      const workflow = await readFile(
        join(initDir, '.github', 'workflows', 'shiori.yml'),
        'utf-8',
      );
      assert.ok(workflow.includes('save-baseline:'));
      assert.ok(workflow.includes('pr-delta:'));
      assert.ok(workflow.includes('peter-evans/create-or-update-comment'));
    });
  });

  describe('--ci-only', () => {
    it('skips project init when --ci-only is set', async () => {
      const initDir = await mkdtemp(join(baseDir, 'ci-only-'));

      const { exitCode, stderr } = await runCli([
        'init',
        '--cwd',
        initDir,
        '--ci',
        'basic',
        '--ci-only',
      ]);

      assert.equal(exitCode, 0);
      assert.ok(stderr.includes('ci: created .github/workflows/shiori.yml'));
      // Should NOT have project init steps
      assert.ok(!stderr.includes('config: created'));
      assert.ok(!stderr.includes('registry: created'));
      assert.ok(!stderr.includes('gitignore: added'));

      // Workflow should exist
      const workflow = await readFile(
        join(initDir, '.github', 'workflows', 'shiori.yml'),
        'utf-8',
      );
      assert.ok(workflow.includes('shiori check'));
    });

    it('errors when --ci-only is used without --ci', async () => {
      const initDir = await mkdtemp(join(baseDir, 'ci-only-err-'));

      const { exitCode, stderr } = await runCli([
        'init',
        '--cwd',
        initDir,
        '--ci-only',
      ]);

      assert.equal(exitCode, 1);
      assert.ok(stderr.includes('--ci-only requires --ci'));
    });
  });

  describe('invalid --ci value', () => {
    it('errors with invalid template kind', async () => {
      const initDir = await mkdtemp(join(baseDir, 'ci-invalid-'));

      const { exitCode, stderr } = await runCli([
        'init',
        '--cwd',
        initDir,
        '--ci',
        'nonexistent',
      ]);

      assert.equal(exitCode, 1);
      assert.ok(stderr.includes('Invalid --ci value'));
      assert.ok(stderr.includes('basic'));
      assert.ok(stderr.includes('sarif'));
      assert.ok(stderr.includes('delta-pr-comment'));
    });
  });

  describe('workflow file already exists', () => {
    it('skips workflow generation when file exists', async () => {
      const initDir = await mkdtemp(join(baseDir, 'ci-exists-'));
      await mkdir(join(initDir, '.github', 'workflows'), { recursive: true });
      await writeFile(
        join(initDir, '.github', 'workflows', 'shiori.yml'),
        '# existing workflow\n',
        'utf-8',
      );
      await mkdir(join(initDir, 'src'), { recursive: true });
      await writeFile(
        join(initDir, 'src', 'sample.ts'),
        '// shiori: CI-004\n',
        'utf-8',
      );

      const { exitCode, stderr } = await runCli([
        'init',
        '--cwd',
        initDir,
        '--patterns',
        'src/**/*.ts',
        '--ci',
        'basic',
      ]);

      assert.equal(exitCode, 0);
      assert.ok(
        stderr.includes(
          'ci: .github/workflows/shiori.yml already exists, skipped',
        ),
      );

      // Verify original workflow was NOT overwritten
      const workflow = await readFile(
        join(initDir, '.github', 'workflows', 'shiori.yml'),
        'utf-8',
      );
      assert.equal(workflow, '# existing workflow\n');
    });
  });

  describe('next steps output', () => {
    it('shows CI-specific next steps when --ci is used', async () => {
      const initDir = await mkdtemp(join(baseDir, 'ci-steps-'));
      await mkdir(join(initDir, 'src'), { recursive: true });
      await writeFile(
        join(initDir, 'src', 'sample.ts'),
        '// shiori: CI-005\n',
        'utf-8',
      );

      const { exitCode, stderr } = await runCli([
        'init',
        '--cwd',
        initDir,
        '--patterns',
        'src/**/*.ts',
        '--ci',
        'basic',
      ]);

      assert.equal(exitCode, 0);
      assert.ok(stderr.includes('Review the generated workflow'));
      assert.ok(stderr.includes('Commit and push to enable CI'));
    });

    it('shows --ci suggestion when no --ci flag', async () => {
      const initDir = await mkdtemp(join(baseDir, 'ci-suggest-'));
      await mkdir(join(initDir, 'src'), { recursive: true });
      await writeFile(
        join(initDir, 'src', 'sample.ts'),
        '// shiori: CI-006\n',
        'utf-8',
      );

      const { exitCode, stderr } = await runCli([
        'init',
        '--cwd',
        initDir,
        '--patterns',
        'src/**/*.ts',
      ]);

      assert.equal(exitCode, 0);
      assert.ok(stderr.includes('shiori init --ci basic'));
    });
  });
});
