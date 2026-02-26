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
  const runDir = await mkdtemp(join(tmpdir(), 'shiori-cand-run-'));
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

describe('candidates-cli: behavior', () => {
  let baseDir: string;

  before(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'shiori-cand-test-'));
  });

  after(async () => {
    if (baseDir) await rm(baseDir, { recursive: true, force: true });
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
      const result = JSON.parse(stdout) as {
        count: number;
        candidates: unknown[];
      };
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
