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
  const runDir = await mkdtemp(join(tmpdir(), 'shiori-scan-run-'));
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

describe('scan-cli: argument validation and error paths', () => {
  let baseDir: string;

  before(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'shiori-scan-test-'));
  });

  after(async () => {
    if (baseDir) await rm(baseDir, { recursive: true, force: true });
  });

  describe('--provider validation', () => {
    it('rejects invalid --provider value with exit code 1', async () => {
      const dir = await mkdtemp(join(baseDir, 'provider-'));
      await mkdir(join(dir, 'src'), { recursive: true });
      await writeFile(
        join(dir, 'src', 'sample.ts'),
        '// shiori: PROV-001\n',
        'utf-8',
      );

      const { exitCode, stderr } = await runCli([
        'scan',
        '--cwd',
        dir,
        '--patterns',
        'src/**/*.ts',
        '--provider',
        'nonexistent',
      ]);

      assert.equal(exitCode, 1);
      assert.ok(stderr.includes('Unknown --provider'));
      assert.ok(stderr.includes('"nonexistent"'));
    });
  });

  describe('--output file writing', () => {
    it('writes scan result to specified file', async () => {
      const dir = await mkdtemp(join(baseDir, 'output-'));
      await mkdir(join(dir, 'src'), { recursive: true });
      await writeFile(
        join(dir, 'src', 'sample.ts'),
        '// eslint-disable-next-line no-console -- shiori: OUT-001\nconsole.log("test");\n',
        'utf-8',
      );
      const outputPath = join(dir, 'scan-result.json');

      const { exitCode, stdout, stderr } = await runCli([
        'scan',
        '--cwd',
        dir,
        '--patterns',
        'src/**/*.ts',
        '--output',
        outputPath,
      ]);

      assert.equal(exitCode, 0);
      // stdout should be empty when --output is used
      assert.equal(stdout, '');
      // stderr contains stats
      assert.ok(stderr.includes('annotation(s)'));
      // File should contain valid scan result JSON
      const content = await readFile(outputPath, 'utf-8');
      const result = JSON.parse(content) as {
        annotations: Array<{ ref: string }>;
        filesScanned: number;
      };
      assert.ok(result.annotations.some((a) => a.ref === 'OUT-001'));
      assert.equal(result.filesScanned, 1);
    });
  });

  describe('pipe mode (non-TTY)', () => {
    it('outputs JSON to stdout and stats to stderr', async () => {
      const dir = await mkdtemp(join(baseDir, 'pipe-'));
      await mkdir(join(dir, 'src'), { recursive: true });
      await writeFile(
        join(dir, 'src', 'sample.ts'),
        '// shiori: PIPE-001\n',
        'utf-8',
      );

      // runCli uses file descriptors (non-TTY), so scan-cli enters pipe mode
      const { exitCode, stdout, stderr } = await runCli([
        'scan',
        '--cwd',
        dir,
        '--patterns',
        'src/**/*.ts',
      ]);

      assert.equal(exitCode, 0);
      // stdout should be valid JSON
      const result = JSON.parse(stdout) as {
        annotations: Array<{ ref: string }>;
        candidates: unknown[];
        filesScanned: number;
      };
      assert.ok(result.annotations.some((a) => a.ref === 'PIPE-001'));
      assert.equal(result.filesScanned, 1);
      // stderr should contain scan stats
      assert.ok(stderr.includes('Scanned'));
      assert.ok(stderr.includes('annotation(s)'));
    });
  });

  describe('--patterns flag', () => {
    it('scans only files matching custom patterns', async () => {
      const dir = await mkdtemp(join(baseDir, 'patterns-'));
      await mkdir(join(dir, 'lib'), { recursive: true });
      await writeFile(
        join(dir, 'lib', 'main.ts'),
        '// shiori: PAT-001\n',
        'utf-8',
      );
      // File outside pattern should not be scanned
      await mkdir(join(dir, 'other'), { recursive: true });
      await writeFile(
        join(dir, 'other', 'skip.ts'),
        '// shiori: PAT-002\n',
        'utf-8',
      );

      const { exitCode, stdout } = await runCli([
        'scan',
        '--cwd',
        dir,
        '--patterns',
        'lib/**/*.ts',
      ]);

      assert.equal(exitCode, 0);
      const result = JSON.parse(stdout) as {
        annotations: Array<{ ref: string }>;
      };
      assert.ok(result.annotations.some((a) => a.ref === 'PAT-001'));
      assert.ok(!result.annotations.some((a) => a.ref === 'PAT-002'));
    });
  });

  describe('no matching files', () => {
    it('returns empty results when no files match patterns', async () => {
      const dir = await mkdtemp(join(baseDir, 'empty-'));
      // No source files at all
      await mkdir(join(dir, 'src'), { recursive: true });

      const { exitCode, stdout } = await runCli([
        'scan',
        '--cwd',
        dir,
        '--patterns',
        'src/**/*.ts',
      ]);

      assert.equal(exitCode, 0);
      const result = JSON.parse(stdout) as {
        annotations: unknown[];
        candidates: unknown[];
        filesScanned: number;
      };
      assert.equal(result.annotations.length, 0);
      assert.equal(result.candidates.length, 0);
      assert.equal(result.filesScanned, 0);
    });
  });
});
