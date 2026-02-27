import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { runCli, createTempBase } from './helpers/cli-test-utils.ts';

describe('jump-cli: error paths and behavior', () => {
  let baseDir: string;
  let cleanup: () => Promise<void>;

  before(async () => {
    ({ baseDir, cleanup } = await createTempBase('shiori-jump-test-'));
  });

  after(async () => {
    await cleanup();
  });

  describe('ref not found in scan result', () => {
    it('exits 1 with error message when ref has no source location', async () => {
      const dir = await mkdtemp(join(baseDir, 'not-found-'));
      await mkdir(join(dir, '.config', 'shiori'), { recursive: true });
      await writeFile(
        join(dir, '.config', 'shiori', 'scan-result.json'),
        JSON.stringify({ annotations: [], candidates: [], filesScanned: 0 }),
        'utf-8',
      );

      const scanPath = join(dir, '.config', 'shiori', 'scan-result.json');
      const { exitCode, stderr, stdout } = await runCli([
        'jump',
        '--ref',
        'MISSING-REF',
        '--cwd',
        dir,
        '--scan',
        scanPath,
      ]);

      assert.equal(exitCode, 1);
      assert.ok(stderr.includes('No source location found'));
      assert.ok(stderr.includes('MISSING-REF'));
      assert.equal(stdout, '');
    });
  });

  describe('successful jump (first location)', () => {
    it('outputs file:line for matching ref', async () => {
      const dir = await mkdtemp(join(baseDir, 'found-'));
      await mkdir(join(dir, '.config', 'shiori'), { recursive: true });
      await writeFile(
        join(dir, '.config', 'shiori', 'scan-result.json'),
        JSON.stringify({
          annotations: [
            {
              ref: 'JMP-001',
              tagged: true,
              ignored: false,
              location: { file: 'src/app.ts', line: 10 },
            },
            {
              ref: 'JMP-001',
              tagged: true,
              ignored: false,
              location: { file: 'src/util.ts', line: 20 },
            },
          ],
          candidates: [],
          filesScanned: 2,
        }),
        'utf-8',
      );

      const scanPath = join(dir, '.config', 'shiori', 'scan-result.json');
      const { exitCode, stdout } = await runCli([
        'jump',
        '--ref',
        'JMP-001',
        '--cwd',
        dir,
        '--scan',
        scanPath,
      ]);

      assert.equal(exitCode, 0);
      // Default: first location only
      assert.equal(stdout.trim(), 'src/app.ts:10');
    });
  });

  describe('--all flag', () => {
    it('outputs all matching locations', async () => {
      const dir = await mkdtemp(join(baseDir, 'all-'));
      await mkdir(join(dir, '.config', 'shiori'), { recursive: true });
      await writeFile(
        join(dir, '.config', 'shiori', 'scan-result.json'),
        JSON.stringify({
          annotations: [
            {
              ref: 'JMP-002',
              tagged: true,
              ignored: false,
              location: { file: 'src/a.ts', line: 5 },
            },
            {
              ref: 'JMP-002',
              tagged: true,
              ignored: false,
              location: { file: 'src/b.ts', line: 15 },
            },
          ],
          candidates: [],
          filesScanned: 2,
        }),
        'utf-8',
      );

      const scanPath = join(dir, '.config', 'shiori', 'scan-result.json');
      const { exitCode, stdout } = await runCli([
        'jump',
        '--ref',
        'JMP-002',
        '--cwd',
        dir,
        '--scan',
        scanPath,
        '--all',
      ]);

      assert.equal(exitCode, 0);
      const lines = stdout.trim().split('\n');
      assert.equal(lines.length, 2);
      assert.equal(lines[0], 'src/a.ts:5');
      assert.equal(lines[1], 'src/b.ts:15');
    });
  });
});
