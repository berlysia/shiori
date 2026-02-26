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
  const runDir = await mkdtemp(join(tmpdir(), 'shiori-update-run-'));
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

describe('update-cli: error paths and behavior', () => {
  let baseDir: string;

  before(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'shiori-update-test-'));
  });

  after(async () => {
    if (baseDir) await rm(baseDir, { recursive: true, force: true });
  });

  describe('registry not found', () => {
    it('exits with error when no registry file exists', async () => {
      const dir = await mkdtemp(join(baseDir, 'no-reg-'));
      await mkdir(join(dir, '.config', 'shiori'), { recursive: true });
      await writeFile(
        join(dir, '.config', 'shiori', 'scan-result.json'),
        JSON.stringify({
          annotations: [
            {
              ref: 'UPD-001',
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
      const { exitCode, stderr } = await runCli([
        'update',
        '--cwd',
        dir,
        '--scan',
        scanPath,
      ]);

      assert.equal(exitCode, 1);
      assert.ok(stderr.includes('No registry file found'));
    });
  });

  describe('scan result not found', () => {
    it('exits with error when scan result file does not exist', async () => {
      const dir = await mkdtemp(join(baseDir, 'no-scan-'));
      await mkdir(join(dir, '.config', 'shiori'), { recursive: true });
      await writeFile(
        join(dir, '.config', 'shiori', 'registry.json'),
        '{}',
        'utf-8',
      );

      const missingPath = join(dir, 'nonexistent-scan.json');
      const { exitCode, stderr } = await runCli([
        'update',
        '--cwd',
        dir,
        '--scan',
        missingPath,
      ]);

      assert.equal(exitCode, 1);
      assert.ok(stderr.includes('Scan result file not found'));
    });
  });

  describe('successful update with new refs', () => {
    it('adds new refs to registry and reports count', async () => {
      const dir = await mkdtemp(join(baseDir, 'add-refs-'));
      await mkdir(join(dir, '.config', 'shiori'), { recursive: true });
      await writeFile(
        join(dir, '.config', 'shiori', 'registry.json'),
        JSON.stringify({ 'UPD-EXIST': { reason: 'existing', target: 'all' } }),
        'utf-8',
      );
      await writeFile(
        join(dir, '.config', 'shiori', 'scan-result.json'),
        JSON.stringify({
          annotations: [
            {
              ref: 'UPD-EXIST',
              tagged: true,
              ignored: false,
              location: { file: 'a.ts', line: 1 },
            },
            {
              ref: 'UPD-NEW',
              tagged: true,
              ignored: false,
              location: { file: 'b.ts', line: 1 },
            },
          ],
          candidates: [],
          filesScanned: 2,
        }),
        'utf-8',
      );

      const scanPath = join(dir, '.config', 'shiori', 'scan-result.json');
      const { exitCode, stderr } = await runCli([
        'update',
        '--cwd',
        dir,
        '--scan',
        scanPath,
      ]);

      assert.equal(exitCode, 0);
      assert.ok(stderr.includes('Added 1 new ref(s)'));
      assert.ok(stderr.includes('UPD-NEW'));

      // Verify registry was updated
      const registryContent = await readFile(
        join(dir, '.config', 'shiori', 'registry.json'),
        'utf-8',
      );
      const registry = JSON.parse(registryContent) as Record<string, unknown>;
      assert.ok('UPD-NEW' in registry);
      assert.ok('UPD-EXIST' in registry);
    });
  });

  describe('--dry-run flag', () => {
    it('reports new refs without writing to registry', async () => {
      const dir = await mkdtemp(join(baseDir, 'dry-run-'));
      await mkdir(join(dir, '.config', 'shiori'), { recursive: true });
      await writeFile(
        join(dir, '.config', 'shiori', 'registry.json'),
        '{}',
        'utf-8',
      );
      await writeFile(
        join(dir, '.config', 'shiori', 'scan-result.json'),
        JSON.stringify({
          annotations: [
            {
              ref: 'DRY-001',
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
      const { exitCode, stderr } = await runCli([
        'update',
        '--cwd',
        dir,
        '--scan',
        scanPath,
        '--dry-run',
      ]);

      assert.equal(exitCode, 0);
      assert.ok(stderr.includes('Would add 1 new ref(s)'));
      assert.ok(stderr.includes('DRY-001'));

      // Registry should NOT have been updated
      const registryContent = await readFile(
        join(dir, '.config', 'shiori', 'registry.json'),
        'utf-8',
      );
      const registry = JSON.parse(registryContent) as Record<string, unknown>;
      assert.ok(!('DRY-001' in registry));
    });
  });
});
