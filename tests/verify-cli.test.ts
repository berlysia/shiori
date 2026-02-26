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
  const runDir = await mkdtemp(join(tmpdir(), 'shiori-verify-run-'));
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

/** Create a minimal project directory for verify tests */
async function createFixtureDir(
  baseDir: string,
  prefix: string,
  options?: {
    scanResult?: object;
    registryEntries?: Record<string, object>;
    skipRegistry?: boolean;
    skipScanResult?: boolean;
  },
): Promise<string> {
  const dir = await mkdtemp(join(baseDir, `${prefix}-`));
  await mkdir(join(dir, '.config', 'shiori'), { recursive: true });

  // Write scan result
  if (!options?.skipScanResult) {
    const scanResult = options?.scanResult ?? {
      annotations: [
        {
          ref: 'VER-001',
          rule: 'no-console',
          tagged: true,
          ignored: false,
          location: { file: 'src/sample.ts', line: 1 },
        },
      ],
      candidates: [],
      filesScanned: 1,
    };
    await writeFile(
      join(dir, '.config', 'shiori', 'scan-result.json'),
      JSON.stringify(scanResult, null, 2) + '\n',
      'utf-8',
    );
  }

  // Write registry
  if (!options?.skipRegistry) {
    const registry = options?.registryEntries ?? {
      'VER-001': { reason: 'test annotation', target: 'all' },
    };
    await writeFile(
      join(dir, '.config', 'shiori', 'registry.json'),
      JSON.stringify(registry, null, 2) + '\n',
      'utf-8',
    );
  }

  return dir;
}

describe('verify-cli: argument validation and error paths', () => {
  let baseDir: string;

  before(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'shiori-verify-test-'));
  });

  after(async () => {
    if (baseDir) await rm(baseDir, { recursive: true, force: true });
  });

  describe('--fail-on validation', () => {
    it('rejects invalid --fail-on value with exit code 1', async () => {
      const dir = await createFixtureDir(baseDir, 'failon');
      const { exitCode, stderr } = await runCli([
        'verify',
        '--cwd',
        dir,
        '--fail-on',
        'bogus-type',
      ]);

      assert.equal(exitCode, 1);
      assert.ok(stderr.includes('Invalid --fail-on'));
      assert.ok(stderr.includes('"bogus-type"'));
    });
  });

  describe('--warn-on validation', () => {
    it('rejects invalid --warn-on value with exit code 1', async () => {
      const dir = await createFixtureDir(baseDir, 'warnon');
      const { exitCode, stderr } = await runCli([
        'verify',
        '--cwd',
        dir,
        '--warn-on',
        'invalid-issue',
      ]);

      assert.equal(exitCode, 1);
      assert.ok(stderr.includes('Invalid --warn-on'));
      assert.ok(stderr.includes('"invalid-issue"'));
    });
  });

  describe('--format validation', () => {
    it('rejects invalid --format value with exit code 1', async () => {
      const dir = await createFixtureDir(baseDir, 'format');
      const { exitCode, stderr } = await runCli([
        'verify',
        '--cwd',
        dir,
        '--format',
        'xml',
      ]);

      assert.equal(exitCode, 1);
      assert.ok(stderr.includes('Invalid --format'));
      assert.ok(stderr.includes('"xml"'));
    });
  });

  describe('registry not found', () => {
    it('exits with error when no registry file exists', async () => {
      const dir = await createFixtureDir(baseDir, 'no-registry', {
        skipRegistry: true,
      });
      const { exitCode, stderr } = await runCli(['verify', '--cwd', dir]);

      assert.equal(exitCode, 1);
      assert.ok(stderr.includes('No registry file found'));
    });
  });

  describe('scan result not found', () => {
    it('exits with error when scan result file does not exist', async () => {
      const dir = await createFixtureDir(baseDir, 'no-scan', {
        skipScanResult: true,
      });
      // Use --scan with explicit path to avoid stdin detection
      const { exitCode, stderr } = await runCli([
        'verify',
        '--cwd',
        dir,
        '--scan',
        join(dir, '.config', 'shiori', 'scan-result.json'),
      ]);

      assert.equal(exitCode, 1);
      assert.ok(stderr.includes('Scan result file not found'));
    });
  });

  describe('successful verify with no issues', () => {
    it('exits 0 and outputs JSON when all annotations are in registry', async () => {
      const dir = await createFixtureDir(baseDir, 'success');
      const scanPath = join(dir, '.config', 'shiori', 'scan-result.json');
      const { exitCode, stdout } = await runCli([
        'verify',
        '--cwd',
        dir,
        '--scan',
        scanPath,
      ]);

      assert.equal(exitCode, 0);
      const result = JSON.parse(stdout) as {
        summary: { errors: number };
      };
      assert.equal(result.summary.errors, 0);
    });
  });

  describe('verify errors cause exit code 1', () => {
    it('exits 1 when annotations are missing from registry', async () => {
      const dir = await createFixtureDir(baseDir, 'verify-err', {
        scanResult: {
          annotations: [
            {
              ref: 'VER-MISSING',
              rule: 'no-console',
              tagged: true,
              ignored: false,
              location: { file: 'src/sample.ts', line: 1 },
            },
          ],
          candidates: [],
          filesScanned: 1,
        },
        registryEntries: {
          'VER-OTHER': { reason: 'unrelated', target: 'all' },
        },
      });
      const scanPath = join(dir, '.config', 'shiori', 'scan-result.json');
      const { exitCode, stdout } = await runCli([
        'verify',
        '--cwd',
        dir,
        '--scan',
        scanPath,
        '--fail-on',
        'missing-in-registry',
      ]);

      assert.equal(exitCode, 1);
      const result = JSON.parse(stdout) as {
        summary: { errors: number };
        issues: Array<{ type: string }>;
      };
      assert.ok(result.summary.errors > 0);
      assert.ok(result.issues.some((i) => i.type === 'missing-in-registry'));
    });
  });
});
