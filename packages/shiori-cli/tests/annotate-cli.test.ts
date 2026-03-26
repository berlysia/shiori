import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  runCli,
  createFixtureDir,
  createTempBase,
  unwrapEnvelope,
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

    assert.equal(exitCode, 2);
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

    assert.equal(exitCode, 2);
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

    assert.equal(exitCode, 3);
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

    assert.equal(exitCode, 2);
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
          kind: 'intentional',
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

    assert.equal(exitCode, 2);
    assert.ok(stderr.includes('already exists in registry'));
  });
});

describe('annotate-cli: --format json (EP-0058)', () => {
  let baseDir: string;
  let cleanup: () => Promise<void>;

  before(async () => {
    ({ baseDir, cleanup } = await createTempBase('shiori-annotate-json-'));
  });

  after(async () => {
    await cleanup();
  });

  it('outputs structured JSON in dry-run mode', async () => {
    const dir = await createFixtureDir(baseDir, 'json-dry', {
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
      '--format',
      'json',
      '--cwd',
      dir,
    ]);

    assert.equal(exitCode, 0);
    const output = unwrapEnvelope<{
      file: string;
      line: number;
      ref: string;
      action: string;
      lineInserted: boolean;
      annotationLine: string;
      registryEntry: unknown;
    }>(stdout, 'annotate');
    assert.equal(output.file, 'src/app.ts');
    assert.equal(output.line, 1);
    assert.equal(output.ref, 'SUP-1234');
    assert.equal(output.action, 'append');
    assert.equal(output.lineInserted, false);
    assert.ok(output.annotationLine.includes('shiori: SUP-1234'));
    assert.ok(output.registryEntry);
  });

  it('outputs structured JSON in apply mode', async () => {
    const dir = await createFixtureDir(baseDir, 'json-apply', {
      sourceFiles: {
        'src/util.ts': 'const x = 1;\nconst y = 2;\n',
      },
    });

    const { stdout, exitCode, stderr } = await runCli([
      'annotate',
      '--target',
      'src/util.ts:1',
      '--ref',
      'DEV-001',
      '--format',
      'json',
      '--apply',
      '--cwd',
      dir,
    ]);

    assert.equal(exitCode, 0);
    const output = unwrapEnvelope<{
      file: string;
      ref: string;
      action: string;
      lineInserted: boolean;
    }>(stdout, 'annotate');
    assert.equal(output.file, 'src/util.ts');
    assert.equal(output.ref, 'DEV-001');
    assert.equal(output.action, 'insert');
    assert.equal(output.lineInserted, true);

    // stderr still has human-readable status
    assert.ok(stderr.includes('Annotated src/util.ts:1'));

    // Verify file was actually modified
    const content = await readFile(join(dir, 'src/util.ts'), 'utf-8');
    assert.ok(content.includes('shiori: DEV-001'));
  });

  it('writes JSON output to file with --output', async () => {
    const dir = await createFixtureDir(baseDir, 'json-output', {
      sourceFiles: {
        'src/app.ts':
          '// eslint-disable-next-line no-console\nconsole.log("hi");\n',
      },
    });

    const { exitCode } = await runCli([
      'annotate',
      '--target',
      'src/app.ts:1',
      '--ref',
      'SUP-9999',
      '--format',
      'json',
      '--output',
      'result.json',
      '--cwd',
      dir,
    ]);

    assert.equal(exitCode, 0);

    // Verify output file was written
    const outputContent = await readFile(join(dir, 'result.json'), 'utf-8');
    const output3 = unwrapEnvelope<{
      file: string;
      ref: string;
    }>(outputContent, 'annotate');
    assert.equal(output3.file, 'src/app.ts');
    assert.equal(output3.ref, 'SUP-9999');
  });

  it('rejects invalid --format value', async () => {
    const dir = await createFixtureDir(baseDir, 'json-bad-format', {
      sourceFiles: { 'src/app.ts': 'const x = 1;\n' },
    });

    const { exitCode, stderr } = await runCli([
      'annotate',
      '--target',
      'src/app.ts:1',
      '--ref',
      'SUP-1234',
      '--format',
      'sarif',
      '--cwd',
      dir,
    ]);

    assert.equal(exitCode, 2);
    assert.ok(stderr.includes('Invalid --format'));
  });

  it('writes text output to file with --output in apply mode', async () => {
    const dir = await createFixtureDir(baseDir, 'text-output-apply', {
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
      'SUP-8888',
      '--format',
      'text',
      '--output',
      'preview.txt',
      '--apply',
      '--cwd',
      dir,
    ]);

    assert.equal(exitCode, 0);
    assert.ok(stderr.includes('Annotated src/app.ts:1'));

    // Verify text output file was written
    const outputContent = await readFile(join(dir, 'preview.txt'), 'utf-8');
    assert.ok(outputContent.includes('Target: src/app.ts:1'));
    assert.ok(outputContent.includes('Ref: SUP-8888'));
  });

  it('defaults to text format when --format is not specified', async () => {
    const dir = await createFixtureDir(baseDir, 'json-default', {
      sourceFiles: {
        'src/app.ts': 'const x = 1;\n',
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
    // Text format has "Target:" prefix, not JSON
    assert.ok(stdout.includes('Target: src/app.ts:1'));
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
