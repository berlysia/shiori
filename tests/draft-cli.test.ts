import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI_PATH = new URL('../dist/src/cli.js', import.meta.url).pathname;
const PROJECT_ROOT = new URL('..', import.meta.url).pathname;

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(
  args: string[],
  options?: { cwd?: string },
): Promise<CliResult> {
  const runDir = await mkdtemp(join(tmpdir(), 'shiori-draft-run-'));
  const stdoutPath = join(runDir, 'stdout.log');
  const stderrPath = join(runDir, 'stderr.log');
  const stdoutFd = openSync(stdoutPath, 'w');
  const stderrFd = openSync(stderrPath, 'w');

  let exitCode = 1;
  try {
    exitCode = await new Promise<number>((resolve, reject) => {
      const child = spawn('node', [CLI_PATH, ...args], {
        cwd: options?.cwd ?? PROJECT_ROOT,
        stdio: ['ignore', stdoutFd, stderrFd],
      });
      child.once('error', reject);
      child.once('close', (code) => resolve(code ?? 1));
    });
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }

  const [stdout, stderr] = await Promise.all([
    readFile(stdoutPath, 'utf-8').catch(() => ''),
    readFile(stderrPath, 'utf-8').catch(() => ''),
  ]);
  await rm(runDir, { recursive: true, force: true });

  return { stdout, stderr, exitCode };
}

describe('draft-cli: behavior', () => {
  let baseDir: string;

  before(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'shiori-draft-test-'));
  });

  after(async () => {
    if (baseDir) await rm(baseDir, { recursive: true, force: true });
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
      const result = JSON.parse(stdout) as {
        count: number;
        drafts: Array<{ ref: string; location: { file: string } }>;
      };
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
      const result = JSON.parse(content) as { count: number };
      assert.equal(result.count, 1);
    });
  });
});
