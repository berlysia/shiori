import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runCli, createTempBase } from './helpers/cli-test-utils.ts';

describe('init --vscode: VS Code tasks.json generation', () => {
  let baseDir: string;
  let cleanup: () => Promise<void>;

  before(async () => {
    ({ baseDir, cleanup } = await createTempBase('shiori-init-vscode-'));
  });

  after(async () => {
    await cleanup();
  });

  describe('--vscode', () => {
    it('generates tasks.json alongside project init', async () => {
      const initDir = await mkdtemp(join(baseDir, 'vscode-basic-'));
      await mkdir(join(initDir, 'src'), { recursive: true });
      await writeFile(
        join(initDir, 'src', 'sample.ts'),
        '// shiori: VS-001\n',
        'utf-8',
      );

      const { exitCode, stderr } = await runCli([
        'init',
        '--cwd',
        initDir,
        '--patterns',
        'src/**/*.ts',
        '--vscode',
      ]);

      assert.equal(exitCode, 0);
      assert.ok(stderr.includes('shiori initialized'));
      assert.ok(stderr.includes('vscode: created .vscode/tasks.json'));

      const tasksJson = await readFile(
        join(initDir, '.vscode', 'tasks.json'),
        'utf-8',
      );
      const parsed = JSON.parse(tasksJson);
      assert.equal(parsed.version, '2.0.0');
      assert.equal(parsed.tasks.length, 2);
      assert.ok(
        parsed.tasks.some(
          (t: { label: string }) => t.label === 'shiori: Check (diagnostic)',
        ),
      );
      assert.ok(
        parsed.tasks.some(
          (t: { label: string }) =>
            t.label === 'shiori: Watch Diagnostic (real-time)',
        ),
      );
    });
  });

  describe('--vscode-only', () => {
    it('skips project init when --vscode-only is set', async () => {
      const initDir = await mkdtemp(join(baseDir, 'vscode-only-'));

      const { exitCode, stderr } = await runCli([
        'init',
        '--cwd',
        initDir,
        '--vscode',
        '--vscode-only',
      ]);

      assert.equal(exitCode, 0);
      assert.ok(stderr.includes('vscode: created .vscode/tasks.json'));
      // Should NOT have project init steps
      assert.ok(!stderr.includes('config: created'));
      assert.ok(!stderr.includes('registry: created'));
      assert.ok(!stderr.includes('gitignore: added'));

      // tasks.json should exist
      const tasksJson = await readFile(
        join(initDir, '.vscode', 'tasks.json'),
        'utf-8',
      );
      const parsed = JSON.parse(tasksJson);
      assert.equal(parsed.version, '2.0.0');
    });

    it('errors when --vscode-only is used without --vscode', async () => {
      const initDir = await mkdtemp(join(baseDir, 'vscode-only-err-'));

      const { exitCode, stderr } = await runCli([
        'init',
        '--cwd',
        initDir,
        '--vscode-only',
      ]);

      assert.equal(exitCode, 1);
      assert.ok(stderr.includes('--vscode-only requires --vscode'));
    });
  });

  describe('tasks.json already exists', () => {
    it('skips generation when file exists', async () => {
      const initDir = await mkdtemp(join(baseDir, 'vscode-exists-'));
      await mkdir(join(initDir, '.vscode'), { recursive: true });
      await writeFile(
        join(initDir, '.vscode', 'tasks.json'),
        '{"version": "2.0.0", "tasks": []}\n',
        'utf-8',
      );
      await mkdir(join(initDir, 'src'), { recursive: true });
      await writeFile(
        join(initDir, 'src', 'sample.ts'),
        '// shiori: VS-002\n',
        'utf-8',
      );

      const { exitCode, stderr } = await runCli([
        'init',
        '--cwd',
        initDir,
        '--patterns',
        'src/**/*.ts',
        '--vscode',
      ]);

      assert.equal(exitCode, 0);
      assert.ok(
        stderr.includes('vscode: .vscode/tasks.json already exists, skipped'),
      );
      // Should mention recipe reference
      assert.ok(stderr.includes('vscode-tasks.json.example'));

      // Verify original file was NOT overwritten
      const tasksJson = await readFile(
        join(initDir, '.vscode', 'tasks.json'),
        'utf-8',
      );
      assert.equal(tasksJson, '{"version": "2.0.0", "tasks": []}\n');
    });
  });

  describe('combined with --ci', () => {
    it('generates both CI workflow and VS Code config', async () => {
      const initDir = await mkdtemp(join(baseDir, 'vscode-ci-'));
      await mkdir(join(initDir, 'src'), { recursive: true });
      await writeFile(
        join(initDir, 'src', 'sample.ts'),
        '// shiori: VS-003\n',
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
        '--vscode',
      ]);

      assert.equal(exitCode, 0);
      assert.ok(stderr.includes('ci: created .github/workflows/shiori.yml'));
      assert.ok(stderr.includes('vscode: created .vscode/tasks.json'));
    });
  });

  describe('next steps output', () => {
    it('shows VS Code guidance when --vscode is used', async () => {
      const initDir = await mkdtemp(join(baseDir, 'vscode-steps-'));
      await mkdir(join(initDir, 'src'), { recursive: true });
      await writeFile(
        join(initDir, 'src', 'sample.ts'),
        '// shiori: VS-004\n',
        'utf-8',
      );

      const { exitCode, stderr } = await runCli([
        'init',
        '--cwd',
        initDir,
        '--patterns',
        'src/**/*.ts',
        '--vscode',
      ]);

      assert.equal(exitCode, 0);
      assert.ok(stderr.includes('Tasks: Run Task'));
      assert.ok(stderr.includes('Problems panel'));
    });

    it('suggests --vscode when no --vscode flag', async () => {
      const initDir = await mkdtemp(join(baseDir, 'vscode-suggest-'));
      await mkdir(join(initDir, 'src'), { recursive: true });
      await writeFile(
        join(initDir, 'src', 'sample.ts'),
        '// shiori: VS-005\n',
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
      assert.ok(stderr.includes('shiori init --vscode'));
    });
  });
});
