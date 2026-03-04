import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { runCli, createTempBase } from './helpers/cli-test-utils.ts';

describe('delta-cli: --added-only', () => {
  let baseDir: string;
  let cleanup: () => Promise<void>;

  before(async () => {
    ({ baseDir, cleanup } = await createTempBase('shiori-delta-added-'));
  });

  after(async () => {
    await cleanup();
  });

  it('filters output to only added annotations', async () => {
    const dir = await mkdir(join(baseDir, 'added-only'), {
      recursive: true,
    }).then(() => join(baseDir, 'added-only'));

    const basePath = join(dir, 'base.json');
    const headPath = join(dir, 'head.json');

    await writeFile(
      basePath,
      JSON.stringify({
        annotations: [
          {
            ref: 'KEEP-001',
            tagged: true,
            ignored: false,
            location: { file: 'src/a.ts', line: 1 },
          },
          {
            ref: 'REMOVE-001',
            tagged: true,
            ignored: false,
            location: { file: 'src/b.ts', line: 5 },
          },
        ],
        candidates: [],
        filesScanned: 2,
      }),
    );

    await writeFile(
      headPath,
      JSON.stringify({
        annotations: [
          {
            ref: 'KEEP-001',
            tagged: true,
            ignored: false,
            location: { file: 'src/a.ts', line: 1 },
          },
          {
            ref: 'ADD-001',
            tagged: true,
            ignored: false,
            location: { file: 'src/c.ts', line: 10 },
          },
        ],
        candidates: [],
        filesScanned: 2,
      }),
    );

    const { exitCode, stdout } = await runCli([
      'delta',
      '--base',
      basePath,
      '--head',
      headPath,
      '--added-only',
    ]);

    assert.equal(exitCode, 0);
    const result = JSON.parse(stdout);
    assert.equal(result.deltas.length, 1);
    assert.equal(result.deltas[0].kind, 'added');
    assert.equal(result.deltas[0].ref, 'ADD-001');
    assert.equal(result.summary.added, 1);
    assert.equal(result.summary.removed, 0);
    assert.equal(result.summary.unchanged, 0);
  });

  it('uses full delta for --max-increase gate even with --added-only', async () => {
    // Scenario: 3 added + 3 removed → net 0 → should pass --max-increase 0
    // If gate used filtered result (added-only), net would be +3 → false failure
    const dir = await mkdir(join(baseDir, 'gate-combo'), {
      recursive: true,
    }).then(() => join(baseDir, 'gate-combo'));

    const basePath = join(dir, 'base.json');
    const headPath = join(dir, 'head.json');

    await writeFile(
      basePath,
      JSON.stringify({
        annotations: [
          {
            ref: 'OLD-001',
            tagged: true,
            ignored: false,
            location: { file: 'src/a.ts', line: 1 },
          },
          {
            ref: 'OLD-002',
            tagged: true,
            ignored: false,
            location: { file: 'src/b.ts', line: 2 },
          },
          {
            ref: 'OLD-003',
            tagged: true,
            ignored: false,
            location: { file: 'src/c.ts', line: 3 },
          },
        ],
        candidates: [],
        filesScanned: 3,
      }),
    );

    await writeFile(
      headPath,
      JSON.stringify({
        annotations: [
          {
            ref: 'NEW-001',
            tagged: true,
            ignored: false,
            location: { file: 'src/d.ts', line: 1 },
          },
          {
            ref: 'NEW-002',
            tagged: true,
            ignored: false,
            location: { file: 'src/e.ts', line: 2 },
          },
          {
            ref: 'NEW-003',
            tagged: true,
            ignored: false,
            location: { file: 'src/f.ts', line: 3 },
          },
        ],
        candidates: [],
        filesScanned: 3,
      }),
    );

    const { exitCode, stdout, stderr } = await runCli([
      'delta',
      '--base',
      basePath,
      '--head',
      headPath,
      '--added-only',
      '--max-increase',
      '0',
    ]);

    // Gate should pass (net 0 from full result)
    assert.equal(exitCode, 0);
    // Output should only contain added annotations
    const result = JSON.parse(stdout);
    assert.equal(result.deltas.length, 3);
    assert.ok(result.deltas.every((d: { kind: string }) => d.kind === 'added'));
    // stderr should show full delta counts
    assert.match(stderr, /\+3 added/);
    assert.match(stderr, /-3 removed/);
  });

  it('returns empty deltas when no additions exist', async () => {
    const dir = await mkdir(join(baseDir, 'no-added'), {
      recursive: true,
    }).then(() => join(baseDir, 'no-added'));

    const basePath = join(dir, 'base.json');
    const headPath = join(dir, 'head.json');

    const scanData = JSON.stringify({
      annotations: [
        {
          ref: 'SAME-001',
          tagged: true,
          ignored: false,
          location: { file: 'src/a.ts', line: 1 },
        },
      ],
      candidates: [],
      filesScanned: 1,
    });

    await writeFile(basePath, scanData);
    await writeFile(headPath, scanData);

    const { exitCode, stdout } = await runCli([
      'delta',
      '--base',
      basePath,
      '--head',
      headPath,
      '--added-only',
    ]);

    assert.equal(exitCode, 0);
    const result = JSON.parse(stdout);
    assert.equal(result.deltas.length, 0);
    assert.equal(result.summary.added, 0);
  });
});

describe('delta-cli: --base-fallback-empty', () => {
  let baseDir: string;
  let cleanup: () => Promise<void>;

  before(async () => {
    ({ baseDir, cleanup } = await createTempBase('shiori-delta-test-'));
  });

  after(async () => {
    await cleanup();
  });

  it('fails when base file does not exist and flag is not set', async () => {
    const dir = await mkdir(join(baseDir, 'no-flag'), { recursive: true }).then(
      () => join(baseDir, 'no-flag'),
    );
    const headPath = join(dir, 'head.json');
    await writeFile(
      headPath,
      JSON.stringify({
        annotations: [],
        candidates: [],
        filesScanned: 0,
      }),
    );

    const { exitCode, stderr } = await runCli([
      'delta',
      '--base',
      join(dir, 'nonexistent.json'),
      '--head',
      headPath,
    ]);

    assert.equal(exitCode, 1);
    assert.match(stderr, /Error loading base scan result/);
  });

  it('uses empty scan result when base file missing and --base-fallback-empty is set', async () => {
    const dir = await mkdir(join(baseDir, 'with-flag'), {
      recursive: true,
    }).then(() => join(baseDir, 'with-flag'));
    const headPath = join(dir, 'head.json');
    await writeFile(
      headPath,
      JSON.stringify({
        annotations: [
          {
            ref: 'NEW-001',
            tagged: true,
            ignored: false,
            location: { file: 'src/app.ts', line: 10 },
          },
        ],
        candidates: [],
        filesScanned: 1,
      }),
    );

    const { exitCode, stdout, stderr } = await runCli([
      'delta',
      '--base',
      join(dir, 'nonexistent.json'),
      '--head',
      headPath,
      '--base-fallback-empty',
    ]);

    assert.equal(exitCode, 0);
    assert.match(stderr, /using empty scan result as fallback/);

    const result = JSON.parse(stdout);
    assert.equal(result.summary.added, 1);
    assert.equal(result.summary.removed, 0);
    assert.equal(result.summary.net, 1);
  });

  it('does not fallback for non-ENOENT errors even with --base-fallback-empty', async () => {
    const dir = await mkdir(join(baseDir, 'bad-json'), {
      recursive: true,
    }).then(() => join(baseDir, 'bad-json'));
    const basePath = join(dir, 'base.json');
    const headPath = join(dir, 'head.json');
    // Write invalid JSON to base
    await writeFile(basePath, 'not valid json');
    await writeFile(
      headPath,
      JSON.stringify({
        annotations: [],
        candidates: [],
        filesScanned: 0,
      }),
    );

    const { exitCode, stderr } = await runCli([
      'delta',
      '--base',
      basePath,
      '--head',
      headPath,
      '--base-fallback-empty',
    ]);

    assert.equal(exitCode, 1);
    assert.match(stderr, /Error loading base scan result/);
  });
});
