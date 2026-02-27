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
  const runDir = await mkdtemp(join(tmpdir(), 'shiori-check-run-'));
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

/** Create a minimal project directory with source files and registry */
async function createFixtureDir(
  baseDir: string,
  prefix: string,
  options?: {
    sourceFiles?: Record<string, string>;
    registryEntries?: Record<string, object>;
    skipRegistry?: boolean;
  },
): Promise<string> {
  const dir = await mkdtemp(join(baseDir, `${prefix}-`));
  await mkdir(join(dir, 'src'), { recursive: true });
  await mkdir(join(dir, '.config', 'shiori'), { recursive: true });

  // Write source files
  const files = options?.sourceFiles ?? {
    'src/sample.ts':
      '// eslint-disable-next-line no-console -- shiori: CHK-001\nconsole.log("test");\n',
  };
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(dir, path);
    await mkdir(join(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content, 'utf-8');
  }

  // Write registry
  if (!options?.skipRegistry) {
    const registry = options?.registryEntries ?? {
      'CHK-001': { reason: 'test annotation', target: 'all' },
    };
    await writeFile(
      join(dir, '.config', 'shiori', 'registry.json'),
      JSON.stringify(registry, null, 2) + '\n',
      'utf-8',
    );
  }

  return dir;
}

describe('check-cli: argument validation and error paths', () => {
  let baseDir: string;

  before(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'shiori-check-test-'));
  });

  after(async () => {
    if (baseDir) await rm(baseDir, { recursive: true, force: true });
  });

  describe('--fail-on validation', () => {
    it('rejects invalid --fail-on value with exit code 1', async () => {
      const dir = await createFixtureDir(baseDir, 'failon');
      const { exitCode, stderr } = await runCli([
        'check',
        '--cwd',
        dir,
        '--patterns',
        'src/**/*.ts',
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
        'check',
        '--cwd',
        dir,
        '--patterns',
        'src/**/*.ts',
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
        'check',
        '--cwd',
        dir,
        '--patterns',
        'src/**/*.ts',
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
      const { exitCode, stderr } = await runCli([
        'check',
        '--cwd',
        dir,
        '--patterns',
        'src/**/*.ts',
      ]);

      assert.equal(exitCode, 1);
      assert.ok(stderr.includes('No registry file found'));
    });
  });

  describe('successful check with no issues', () => {
    it('exits 0 and outputs JSON when all annotations are in registry', async () => {
      const dir = await createFixtureDir(baseDir, 'success');
      const { exitCode, stdout, stderr } = await runCli([
        'check',
        '--cwd',
        dir,
        '--patterns',
        'src/**/*.ts',
      ]);

      assert.equal(exitCode, 0);
      // stderr should contain scan summary
      assert.ok(stderr.includes('Scanned'));
      assert.ok(stderr.includes('annotation(s)'));
      // stdout should be valid JSON
      const result = JSON.parse(stdout) as {
        summary: { errors: number };
      };
      assert.equal(result.summary.errors, 0);
    });
  });

  describe('verify errors cause exit code 1', () => {
    it('exits 1 when annotations are missing from registry', async () => {
      // Source references CHK-MISSING which is not in registry
      const dir = await createFixtureDir(baseDir, 'verify-err', {
        sourceFiles: {
          'src/sample.ts':
            '// eslint-disable-next-line no-console -- shiori: CHK-MISSING\nconsole.log("test");\n',
        },
        registryEntries: {
          'CHK-OTHER': { reason: 'unrelated', target: 'all' },
        },
      });
      const { exitCode, stdout } = await runCli([
        'check',
        '--cwd',
        dir,
        '--patterns',
        'src/**/*.ts',
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

  describe('--fail-on with --output', () => {
    it('writes report file AND exits 1 when --fail-on triggers errors', async () => {
      // Source references CHK-MISSING which is not in registry → missing-in-registry
      const dir = await createFixtureDir(baseDir, 'failon-output', {
        sourceFiles: {
          'src/sample.ts':
            '// eslint-disable-next-line no-console -- shiori: CHK-MISSING\nconsole.log("test");\n',
        },
        registryEntries: {
          'CHK-OTHER': { reason: 'unrelated', target: 'all' },
        },
      });
      const outputPath = join(dir, 'report.json');
      const { exitCode, stdout, stderr } = await runCli([
        'check',
        '--cwd',
        dir,
        '--patterns',
        'src/**/*.ts',
        '--fail-on',
        'missing-in-registry',
        '--output',
        outputPath,
      ]);

      // Must exit 1 (fail-on triggered)
      assert.equal(exitCode, 1, 'should exit 1 when --fail-on triggers errors');
      // stdout must be empty (output goes to file)
      assert.equal(stdout, '', 'stdout should be empty when --output is used');
      // stderr mentions file was written
      assert.ok(
        stderr.includes('Report written to'),
        'stderr should confirm report file was written',
      );
      // File must exist and contain valid JSON with errors
      const content = await readFile(outputPath, 'utf-8');
      const result = JSON.parse(content) as {
        summary: { errors: number };
        issues: Array<{ type: string }>;
      };
      assert.ok(result.summary.errors > 0, 'report should contain errors');
      assert.ok(
        result.issues.some((i) => i.type === 'missing-in-registry'),
        'report should contain missing-in-registry issue',
      );
    });
  });

  describe('--output file writing', () => {
    it('writes report to specified file instead of stdout', async () => {
      const dir = await createFixtureDir(baseDir, 'output');
      const outputPath = join(dir, 'report.json');
      const { exitCode, stdout, stderr } = await runCli([
        'check',
        '--cwd',
        dir,
        '--patterns',
        'src/**/*.ts',
        '--output',
        outputPath,
      ]);

      assert.equal(exitCode, 0);
      // stdout should be empty (output goes to file)
      assert.equal(stdout, '');
      // stderr mentions file was written
      assert.ok(stderr.includes('Report written to'));
      // File should contain valid JSON
      const content = await readFile(outputPath, 'utf-8');
      const result = JSON.parse(content) as {
        summary: { errors: number };
      };
      assert.equal(result.summary.errors, 0);
    });
  });
});
