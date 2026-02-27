import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { runCli, createTempBase } from './helpers/cli-test-utils.ts';

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
