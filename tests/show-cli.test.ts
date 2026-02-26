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
  const runDir = await mkdtemp(join(tmpdir(), 'shiori-show-run-'));
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

describe('show-cli: error paths and behavior', () => {
  let baseDir: string;

  before(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'shiori-show-test-'));
  });

  after(async () => {
    if (baseDir) await rm(baseDir, { recursive: true, force: true });
  });

  describe('ref not found', () => {
    it('exits 1 when ref is not in registry or scan result', async () => {
      const dir = await mkdtemp(join(baseDir, 'not-found-'));
      await mkdir(join(dir, '.config', 'shiori'), { recursive: true });
      await writeFile(
        join(dir, '.config', 'shiori', 'registry.json'),
        JSON.stringify({ 'OTHER-001': { reason: 'test', target: 'all' } }),
        'utf-8',
      );
      await writeFile(
        join(dir, '.config', 'shiori', 'scan-result.json'),
        JSON.stringify({ annotations: [], candidates: [], filesScanned: 0 }),
        'utf-8',
      );

      const scanPath = join(dir, '.config', 'shiori', 'scan-result.json');
      const { exitCode, stdout } = await runCli([
        'show',
        '--ref',
        'MISSING-REF',
        '--cwd',
        dir,
        '--scan',
        scanPath,
      ]);

      assert.equal(exitCode, 1);
      // ShowResult: no registryEntry and empty sourceLocations
      const result = JSON.parse(stdout) as {
        ref: string;
        sourceLocations: unknown[];
      };
      assert.equal(result.ref, 'MISSING-REF');
      assert.equal(result.sourceLocations.length, 0);
    });
  });

  describe('successful ref lookup', () => {
    it('exits 0 and outputs JSON when ref exists in registry', async () => {
      const dir = await mkdtemp(join(baseDir, 'found-'));
      await mkdir(join(dir, '.config', 'shiori'), { recursive: true });
      await writeFile(
        join(dir, '.config', 'shiori', 'registry.json'),
        JSON.stringify({
          'SHOW-001': { reason: 'test annotation', target: 'all' },
        }),
        'utf-8',
      );
      await writeFile(
        join(dir, '.config', 'shiori', 'scan-result.json'),
        JSON.stringify({
          annotations: [
            {
              ref: 'SHOW-001',
              rule: 'no-console',
              tagged: true,
              ignored: false,
              location: { file: 'src/app.ts', line: 42 },
            },
          ],
          candidates: [],
          filesScanned: 1,
        }),
        'utf-8',
      );

      const scanPath = join(dir, '.config', 'shiori', 'scan-result.json');
      const { exitCode, stdout } = await runCli([
        'show',
        '--ref',
        'SHOW-001',
        '--cwd',
        dir,
        '--scan',
        scanPath,
      ]);

      assert.equal(exitCode, 0);
      const result = JSON.parse(stdout) as {
        ref: string;
        registryEntry: { reason: string };
        sourceLocations: Array<{ file: string; line: number }>;
      };
      assert.equal(result.ref, 'SHOW-001');
      assert.equal(result.registryEntry.reason, 'test annotation');
      assert.ok(result.sourceLocations.length > 0);
      assert.equal(result.sourceLocations[0]!.file, 'src/app.ts');
      assert.equal(result.sourceLocations[0]!.line, 42);
    });
  });
});
