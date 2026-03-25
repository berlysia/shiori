import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  runCli,
  createTempBase,
  unwrapEnvelope,
} from './helpers/cli-test-utils.ts';

describe('draft-cli: behavior', () => {
  let baseDir: string;
  let cleanup: () => Promise<void>;

  before(async () => {
    ({ baseDir, cleanup } = await createTempBase('shiori-draft-test-'));
  });

  after(async () => {
    await cleanup();
  });

  describe('JSON output with drafts', () => {
    it('lists draft annotations (no ref) as JSON', async () => {
      const dir = await mkdtemp(join(baseDir, 'json-'));
      await mkdir(join(dir, '.config', 'shiori'), { recursive: true });
      await writeFile(
        join(dir, '.config', 'shiori', 'scan-result.json'),
        JSON.stringify({
          annotations: [
            {
              ref: '',
              reason: 'need to revisit this logic',
              tagged: true,
              ignored: false,
              location: { file: 'src/app.ts', line: 10 },
            },
            {
              ref: 'REF-001',
              tagged: true,
              ignored: false,
              location: { file: 'src/other.ts', line: 5 },
            },
          ],
          candidates: [],
          filesScanned: 2,
        }),
        'utf-8',
      );

      const scanPath = join(dir, '.config', 'shiori', 'scan-result.json');
      const { exitCode, stdout, stderr } = await runCli([
        'draft',
        '--cwd',
        dir,
        '--scan',
        scanPath,
      ]);

      assert.equal(exitCode, 0);
      const result = unwrapEnvelope<{
        count: number;
        drafts: Array<{ ref: string; location: { file: string } }>;
      }>(stdout);
      // Only the empty-ref annotation is a draft
      assert.equal(result.count, 1);
      assert.ok(stderr.includes('Found 1 draft annotation(s)'));
    });
  });

  describe('--output file writing', () => {
    it('writes draft list to specified file', async () => {
      const dir = await mkdtemp(join(baseDir, 'output-'));
      await mkdir(join(dir, '.config', 'shiori'), { recursive: true });
      await writeFile(
        join(dir, '.config', 'shiori', 'scan-result.json'),
        JSON.stringify({
          annotations: [
            {
              ref: '',
              tagged: true,
              ignored: false,
              location: { file: 'a.ts', line: 1 },
            },
          ],
          candidates: [],
          filesScanned: 1,
        }),
        'utf-8',
      );

      const scanPath = join(dir, '.config', 'shiori', 'scan-result.json');
      const outputPath = join(dir, 'drafts.json');
      const { exitCode, stdout } = await runCli([
        'draft',
        '--cwd',
        dir,
        '--scan',
        scanPath,
        '--output',
        outputPath,
      ]);

      assert.equal(exitCode, 0);
      assert.equal(stdout, '');
      const content = await readFile(outputPath, 'utf-8');
      const result = unwrapEnvelope<{ count: number }>(content);
      assert.equal(result.count, 1);
    });
  });
});
