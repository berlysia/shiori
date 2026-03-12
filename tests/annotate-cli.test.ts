import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  runCli,
  createFixtureDir,
  createTempBase,
} from './helpers/cli-test-utils.ts';

describe('annotate-cli: dry-run mode', () => {
  let baseDir: string;
  let cleanup: () => Promise<void>;

  before(async () => {
    ({ baseDir, cleanup } = await createTempBase('shiori-annotate-test-'));
  });

  after(async () => {
    await cleanup();
  });

  it('shows preview without modifying files', async () => {
    const dir = await createFixtureDir(baseDir, 'dry-run', {
      sourceFiles: {
        'src/app.ts':
          '// eslint-disable-next-line no-console\nconsole.log("hi");\n',
      },
    });

    const { stdout, exitCode } = await runCli([
      'annotate',
      '--target',
      'src/app.ts:1',
      '--ref',
      'SUP-1234',
      '--cwd',
      dir,
    ]);

    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('Target: src/app.ts:1'));
    assert.ok(stdout.includes('Ref: SUP-1234'));

    // Verify file was not modified
    const content = await readFile(join(dir, 'src/app.ts'), 'utf-8');
    assert.ok(!content.includes('shiori:'));
  });
});

describe('annotate-cli: apply mode', () => {
  let baseDir: string;
  let cleanup: () => Promise<void>;

  before(async () => {
    ({ baseDir, cleanup } = await createTempBase('shiori-annotate-apply-'));
  });

  after(async () => {
    await cleanup();
  });

  it('modifies source file and updates registry', async () => {
    const dir = await createFixtureDir(baseDir, 'apply', {
      sourceFiles: {
        'src/app.ts':
          '// eslint-disable-next-line no-console\nconsole.log("hi");\n',
      },
    });

    const { exitCode, stderr } = await runCli([
      'annotate',
      '--target',
      'src/app.ts:1',
      '--ref',
      'SUP-1234',
      '--apply',
      '--cwd',
      dir,
    ]);

    assert.equal(exitCode, 0);
    assert.ok(stderr.includes('Annotated src/app.ts:1'));

    // Verify source file was modified
    const content = await readFile(join(dir, 'src/app.ts'), 'utf-8');
    assert.ok(content.includes('shiori: SUP-1234'));

    // Verify registry was updated
    const registry = JSON.parse(
      await readFile(join(dir, '.config/shiori/registry.json'), 'utf-8'),
    );
    assert.ok(registry['SUP-1234']);
    assert.equal(registry['SUP-1234'].target, 'src/app.ts');
    assert.equal(registry['SUP-1234'].kind, 'annotation');
  });

  it('inserts new comment line for code-only target', async () => {
    const dir = await createFixtureDir(baseDir, 'apply-code', {
      sourceFiles: {
        'src/util.ts': 'const x = 1;\nconst y = 2;\n',
      },
    });

    const { exitCode, stderr } = await runCli([
      'annotate',
      '--target',
      'src/util.ts:1',
      '--ref',
      'DEV-001',
      '--reason',
      'tracking decision',
      '--apply',
      '--cwd',
      dir,
    ]);

    assert.equal(exitCode, 0);
    assert.ok(stderr.includes('Inserted new comment line'));

    const content = await readFile(join(dir, 'src/util.ts'), 'utf-8');
    const lines = content.split('\n');
    assert.ok(lines[0]!.includes('// shiori: DEV-001'));
    assert.equal(lines[1], 'const x = 1;');
  });

  it('stores reason and expires in registry', async () => {
    const dir = await createFixtureDir(baseDir, 'apply-fields', {
      sourceFiles: {
        'src/app.ts': 'const x = 1;\n',
      },
    });

    const { exitCode } = await runCli([
      'annotate',
      '--target',
      'src/app.ts:1',
      '--ref',
      'SUP-5678',
      '--reason',
      'workaround for upstream bug',
      '--expires',
      '2026-12',
      '--kind',
      'tech-debt',
      '--apply',
      '--cwd',
      dir,
    ]);

    assert.equal(exitCode, 0);

    const registry = JSON.parse(
      await readFile(join(dir, '.config/shiori/registry.json'), 'utf-8'),
    );
    assert.equal(registry['SUP-5678'].reason, 'workaround for upstream bug');
    assert.equal(registry['SUP-5678'].expires, '2026-12');
    assert.equal(registry['SUP-5678'].kind, 'tech-debt');
  });
});

describe('annotate-cli: error handling', () => {
  let baseDir: string;
  let cleanup: () => Promise<void>;

  before(async () => {
    ({ baseDir, cleanup } = await createTempBase('shiori-annotate-err-'));
  });

  after(async () => {
    await cleanup();
  });

  it('rejects invalid --target format', async () => {
    const dir = await createFixtureDir(baseDir, 'bad-target', {
      sourceFiles: { 'src/app.ts': 'const x = 1;\n' },
    });

    const { exitCode, stderr } = await runCli([
      'annotate',
      '--target',
      'src/app.ts',
      '--ref',
      'SUP-1234',
      '--cwd',
      dir,
    ]);

    assert.equal(exitCode, 1);
    assert.ok(stderr.includes('Invalid --target format'));
  });

  it('rejects invalid ref format', async () => {
    const dir = await createFixtureDir(baseDir, 'bad-ref', {
      sourceFiles: { 'src/app.ts': 'const x = 1;\n' },
    });

    const { exitCode, stderr } = await runCli([
      'annotate',
      '--target',
      'src/app.ts:1',
      '--ref',
      'invalid-ref',
      '--cwd',
      dir,
    ]);

    assert.equal(exitCode, 1);
    assert.ok(stderr.includes('Invalid ref'));
  });

  it('rejects nonexistent file', async () => {
    const dir = await createFixtureDir(baseDir, 'no-file', {});

    const { exitCode, stderr } = await runCli([
      'annotate',
      '--target',
      'src/nonexistent.ts:1',
      '--ref',
      'SUP-1234',
      '--cwd',
      dir,
    ]);

    assert.equal(exitCode, 1);
    assert.ok(stderr.includes('File not found'));
  });

  it('rejects line out of range', async () => {
    const dir = await createFixtureDir(baseDir, 'bad-line', {
      sourceFiles: { 'src/app.ts': 'const x = 1;\n' },
    });

    const { exitCode, stderr } = await runCli([
      'annotate',
      '--target',
      'src/app.ts:100',
      '--ref',
      'SUP-1234',
      '--cwd',
      dir,
    ]);

    assert.equal(exitCode, 1);
    assert.ok(stderr.includes('out of range'));
  });

  it('rejects ref that already exists in registry', async () => {
    const dir = await createFixtureDir(baseDir, 'dup-ref', {
      sourceFiles: { 'src/app.ts': 'const x = 1;\n' },
      registryEntries: {
        'SUP-1234': {
          reason: 'existing',
          target: 'other.ts',
          expires: undefined,
          ticket: undefined,
          owner: undefined,
          notes: undefined,
          kind: undefined,
        },
      },
    });

    const { exitCode, stderr } = await runCli([
      'annotate',
      '--target',
      'src/app.ts:1',
      '--ref',
      'SUP-1234',
      '--cwd',
      dir,
    ]);

    assert.equal(exitCode, 1);
    assert.ok(stderr.includes('already exists in registry'));
  });
});

describe('annotate-cli: annotate → verify E2E path (AC-7)', () => {
  let baseDir: string;
  let cleanup: () => Promise<void>;

  before(async () => {
    ({ baseDir, cleanup } = await createTempBase('shiori-annotate-e2e-'));
  });

  after(async () => {
    await cleanup();
  });

  it('annotated file passes scan + verify with no issues', async () => {
    const dir = await createFixtureDir(baseDir, 'e2e', {
      sourceFiles: {
        'src/app.ts':
          '// eslint-disable-next-line no-console\nconsole.log("hi");\n',
      },
    });

    // Step 1: annotate --apply
    const annotateResult = await runCli([
      'annotate',
      '--target',
      'src/app.ts:1',
      '--ref',
      'SUP-1234',
      '--apply',
      '--cwd',
      dir,
    ]);
    assert.equal(annotateResult.exitCode, 0);

    // Step 2: check (scan + verify)
    const checkResult = await runCli(['check', '--cwd', dir]);
    assert.equal(checkResult.exitCode, 0);
  });
});
