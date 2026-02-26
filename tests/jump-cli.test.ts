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
  const runDir = await mkdtemp(join(tmpdir(), 'shiori-jump-run-'));
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

describe('jump-cli: error paths and behavior', () => {
  let baseDir: string;

  before(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'shiori-jump-test-'));
  });

  after(async () => {
    if (baseDir) await rm(baseDir, { recursive: true, force: true });
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
