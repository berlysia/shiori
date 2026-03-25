import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  runCli,
  createTempBase,
  unwrapEnvelope,
} from './helpers/cli-test-utils.ts';

describe('candidates-cli: behavior', () => {
  let baseDir: string;
  let cleanup: () => Promise<void>;

  before(async () => {
    ({ baseDir, cleanup } = await createTempBase('shiori-cand-test-'));
  });

  after(async () => {
    await cleanup();
  });

  describe('JSON output with candidates', () => {
    it('outputs candidate list as JSON', async () => {
      const dir = await mkdtemp(join(baseDir, 'json-'));
      await mkdir(join(dir, '.config', 'shiori'), { recursive: true });
      await writeFile(
        join(dir, '.config', 'shiori', 'scan-result.json'),
        JSON.stringify({
          annotations: [],
          candidates: [
            {
              pattern: 'eslint-disable-next-line',
              directive: 'no-console',
              location: { file: 'src/app.ts', line: 5 },
            },
          ],
          filesScanned: 1,
        }),
        'utf-8',
      );

      const scanPath = join(dir, '.config', 'shiori', 'scan-result.json');
      const { exitCode, stdout, stderr } = await runCli([
        'candidates',
        '--cwd',
        dir,
        '--scan',
        scanPath,
      ]);

      assert.equal(exitCode, 0);
      const result = unwrapEnvelope<{
        count: number;
        candidates: unknown[];
      }>(stdout);
      assert.equal(result.count, 1);
      assert.ok(stderr.includes('Found 1 candidate(s)'));
    });
  });

  describe('--format markdown', () => {
    it('outputs candidates as markdown', async () => {
      const dir = await mkdtemp(join(baseDir, 'md-'));
      await mkdir(join(dir, '.config', 'shiori'), { recursive: true });
      await writeFile(
        join(dir, '.config', 'shiori', 'scan-result.json'),
        JSON.stringify({
          annotations: [],
          candidates: [
            {
              pattern: 'stylelint-disable-next-line',
              directive: 'plugin/baseline',
              location: { file: 'src/style.css', line: 3 },
            },
          ],
          filesScanned: 1,
        }),
        'utf-8',
      );

      const scanPath = join(dir, '.config', 'shiori', 'scan-result.json');
      const { exitCode, stdout } = await runCli([
        'candidates',
        '--cwd',
        dir,
        '--scan',
        scanPath,
        '--format',
        'markdown',
      ]);

      assert.equal(exitCode, 0);
      // Markdown output should contain header and candidate info
      assert.ok(stdout.includes('stylelint-disable-next-line'));
      assert.ok(stdout.includes('src/style.css'));
    });
  });
});
