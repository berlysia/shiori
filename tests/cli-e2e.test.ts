import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { readFile, writeFile, unlink, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI_PATH = new URL('../dist/src/cli.js', import.meta.url).pathname;
const PROJECT_ROOT = new URL('..', import.meta.url).pathname;

// Relative patterns for fast-glob (resolved from PROJECT_ROOT as cwd)
const SCAN_PATTERNS = 'tests/fixtures/e2e/**/*.css,tests/fixtures/e2e/**/*.ts';
const REGISTRY_PATH = 'tests/fixtures/e2e/registry.json';
const REGISTRY_YAML_PATH = 'tests/fixtures/e2e/registry.yaml';

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[]): Promise<CliResult> {
  const runDir = await mkdtemp(join(tmpdir(), 'shiori-cli-run-'));
  const stdoutPath = join(runDir, 'stdout.log');
  const stderrPath = join(runDir, 'stderr.log');
  const stdoutFd = openSync(stdoutPath, 'w');
  const stderrFd = openSync(stderrPath, 'w');

  let exitCode = 1;
  try {
    exitCode = await new Promise<number>((resolve, reject) => {
      const child = spawn('node', [CLI_PATH, ...args], {
        cwd: PROJECT_ROOT,
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

describe('CLI E2E', () => {
  let tmpDir: string;
  let scanResultPath: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'shiori-e2e-'));
    scanResultPath = join(tmpDir, 'scan-result.json');

    // Pre-run scan and save result for verify/update/draft tests
    const { stdout } = await runCli(['scan', '--patterns', SCAN_PATTERNS]);

    const scanResult = JSON.parse(stdout) as {
      annotations: unknown[];
      candidates: unknown[];
      filesScanned: number;
    };
    assert.ok(
      Array.isArray(scanResult.annotations),
      'scan should output ScanResult with annotations array',
    );
    assert.ok(
      scanResult.annotations.length > 0,
      'scan should find annotations',
    );
    await writeFile(scanResultPath, stdout, 'utf-8');
  });

  after(async () => {
    const files = [
      'scan-result.json',
      'output-scan.json',
      'updated-registry.json',
      'updated-registry.yaml',
      'draft-result.json',
      'scan-multi.json',
      'watch-scan.json',
      'watch-sync-scan.json',
      'watch-registry.json',
    ];
    for (const f of files) {
      try {
        await unlink(join(tmpDir, f));
      } catch {
        // file may not exist
      }
    }
  });

  describe('scan command', () => {
    it('outputs ScanResult JSON to stdout', async () => {
      const { stdout, exitCode } = await runCli([
        'scan',
        '--patterns',
        SCAN_PATTERNS,
      ]);
      assert.equal(exitCode, 0);
      const scanResult = JSON.parse(stdout) as {
        annotations: Array<{ ref: string; location: { file: string } }>;
        candidates: Array<{ pattern: string }>;
        filesScanned: number;
      };
      // SUP-1001, SUP-1002, SUP-2001, SUP-2002, draft(no ref)
      assert.equal(scanResult.annotations.length, 5);
      // Line 7: eslint-disable-next-line no-debugger → eslint candidate
      assert.equal(scanResult.candidates.length, 1);
      assert.equal(scanResult.candidates[0]!.pattern, 'eslint');
      assert.equal(scanResult.filesScanned, 2);
      // Verify annotation field shape
      assert.ok(scanResult.annotations[0]!.ref !== undefined);
      assert.ok(scanResult.annotations[0]!.location !== undefined);
    });

    it('writes to file with --output', async () => {
      const outputPath = join(tmpDir, 'output-scan.json');
      const { exitCode } = await runCli([
        'scan',
        '--patterns',
        SCAN_PATTERNS,
        '--output',
        outputPath,
      ]);
      assert.equal(exitCode, 0);
      const content = await readFile(outputPath, 'utf-8');
      const scanResult = JSON.parse(content) as {
        annotations: unknown[];
        candidates: unknown[];
      };
      assert.equal(scanResult.annotations.length, 5);
      assert.equal(scanResult.candidates.length, 1);
    });
  });

  describe('verify command', () => {
    it('exits 1 when missing-in-registry with --fail-on', async () => {
      // SUP-2002 is not in registry -> missing-in-registry
      const { exitCode, stdout } = await runCli([
        'verify',
        '--scan',
        scanResultPath,
        '--registry',
        join(PROJECT_ROOT, REGISTRY_PATH),
        '--fail-on',
        'missing-in-registry',
      ]);
      assert.equal(exitCode, 1);
      const result = JSON.parse(stdout) as { summary: { errors: number } };
      assert.ok(result.summary.errors > 0);
    });

    it('exits 0 when all issues are warn-on', async () => {
      const { exitCode } = await runCli([
        'verify',
        '--scan',
        scanResultPath,
        '--registry',
        join(PROJECT_ROOT, REGISTRY_PATH),
        '--warn-on',
        'missing-in-registry,unused-in-source,expired,syntax-error',
      ]);
      assert.equal(exitCode, 0);
    });

    it('outputs markdown with --format markdown', async () => {
      const { stdout, exitCode } = await runCli([
        'verify',
        '--scan',
        scanResultPath,
        '--registry',
        join(PROJECT_ROOT, REGISTRY_PATH),
        '--format',
        'markdown',
        '--warn-on',
        'missing-in-registry,unused-in-source,expired,syntax-error',
      ]);
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('# Annotation Registry Verification Report'));
    });

    it('works with YAML registry', async () => {
      const { exitCode, stdout } = await runCli([
        'verify',
        '--scan',
        scanResultPath,
        '--registry',
        join(PROJECT_ROOT, REGISTRY_YAML_PATH),
        '--warn-on',
        'missing-in-registry,unused-in-source,expired,syntax-error',
      ]);
      assert.equal(exitCode, 0);
      const result = JSON.parse(stdout) as {
        registryEntries: number;
      };
      assert.equal(result.registryEntries, 4);
    });

    it('detects expired entries', async () => {
      const { stdout } = await runCli([
        'verify',
        '--scan',
        scanResultPath,
        '--registry',
        join(PROJECT_ROOT, REGISTRY_PATH),
        '--fail-on',
        'expired',
        '--warn-on',
        'missing-in-registry,unused-in-source,syntax-error',
      ]);
      const result = JSON.parse(stdout) as {
        issues: Array<{ type: string }>;
      };
      const expired = result.issues.filter((i) => i.type === 'expired');
      assert.ok(expired.length > 0); // SUP-9999 expired
    });
  });

  describe('update command', () => {
    it('merges new refs into existing registry', async () => {
      // Copy fixture registry to tmpDir so update can write to it
      const registryContent = await readFile(
        join(PROJECT_ROOT, REGISTRY_PATH),
        'utf-8',
      );
      const outputPath = join(tmpDir, 'updated-registry.json');
      await writeFile(outputPath, registryContent, 'utf-8');

      const { exitCode, stderr } = await runCli([
        'update',
        '--scan',
        scanResultPath,
        '--registry',
        outputPath,
      ]);
      assert.equal(exitCode, 0);
      const content = await readFile(outputPath, 'utf-8');
      const registry = JSON.parse(content) as Record<
        string,
        { reason: string }
      >;
      // Existing entry preserved
      assert.equal(registry['SUP-1001']!.reason, 'vendor prefix fallback');
      // New entry gets placeholder
      assert.equal(registry['SUP-2002']!.reason, 'TODO: fill in reason');
      assert.ok(stderr.includes('Added'));
    });

    it('reports up to date when no new refs', async () => {
      // Create a registry that already has all refs
      const fullRegistryContent = await readFile(
        join(PROJECT_ROOT, REGISTRY_PATH),
        'utf-8',
      );
      const fullRegistry = JSON.parse(fullRegistryContent) as Record<
        string,
        unknown
      >;
      // Add all scan refs to make it complete
      fullRegistry['SUP-2002'] = {
        reason: 'existing',
        target: 'test',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: undefined,
      };
      const outputPath = join(tmpDir, 'updated-registry.json');
      await writeFile(
        outputPath,
        JSON.stringify(fullRegistry, null, 2),
        'utf-8',
      );

      const { exitCode, stderr } = await runCli([
        'update',
        '--scan',
        scanResultPath,
        '--registry',
        outputPath,
      ]);
      assert.equal(exitCode, 0);
      assert.ok(stderr.includes('up to date'));
    });
  });

  describe('draft command', () => {
    it('lists draft annotations from scan result', async () => {
      const { stdout, exitCode } = await runCli([
        'draft',
        '--scan',
        scanResultPath,
      ]);
      assert.equal(exitCode, 0);
      const result = JSON.parse(stdout) as {
        drafts: Array<{ ref: string; tagged: boolean }>;
        count: number;
      };
      assert.equal(result.count, 1);
      assert.equal(result.drafts[0]!.ref, '');
      assert.equal(result.drafts[0]!.tagged, true);
    });

    it('writes to file with --output', async () => {
      const outputPath = join(tmpDir, 'draft-result.json');
      const { exitCode } = await runCli([
        'draft',
        '--scan',
        scanResultPath,
        '--output',
        outputPath,
      ]);
      assert.equal(exitCode, 0);
      const content = await readFile(outputPath, 'utf-8');
      const result = JSON.parse(content) as { count: number };
      assert.equal(result.count, 1);
    });
  });

  describe('jump command', () => {
    it('prints first location as file:line', async () => {
      const { stdout, exitCode } = await runCli([
        'jump',
        '--ref',
        'SUP-2001',
        '--scan',
        scanResultPath,
      ]);

      assert.equal(exitCode, 0);
      assert.equal(stdout.trim(), 'tests/fixtures/e2e/sample.ts:1');
    });

    it('prints all locations with --all', async () => {
      const customScanPath = join(tmpDir, 'scan-multi.json');
      const customScan = {
        annotations: [
          {
            ref: 'SUP-MULTI',
            tagged: true,
            ignored: false,
            location: { file: 'a.ts', line: 3 },
          },
          {
            ref: 'SUP-MULTI',
            tagged: true,
            ignored: false,
            location: { file: 'b.ts', line: 8 },
          },
          {
            ref: 'SUP-OTHER',
            tagged: true,
            ignored: false,
            location: { file: 'c.ts', line: 1 },
          },
        ],
        candidates: [],
        filesScanned: 3,
      };
      await writeFile(customScanPath, JSON.stringify(customScan), 'utf-8');

      const { stdout, exitCode } = await runCli([
        'jump',
        '--ref',
        'SUP-MULTI',
        '--all',
        '--scan',
        customScanPath,
      ]);

      assert.equal(exitCode, 0);
      assert.deepEqual(stdout.trim().split('\n'), ['a.ts:3', 'b.ts:8']);
    });
  });

  describe('watch command', () => {
    it('runs once and writes scan result', async () => {
      const outputPath = join(tmpDir, 'watch-scan.json');

      const { exitCode } = await runCli([
        'watch',
        '--once',
        '--patterns',
        SCAN_PATTERNS,
        '--output',
        outputPath,
      ]);

      assert.equal(exitCode, 0);
      const content = await readFile(outputPath, 'utf-8');
      const result = JSON.parse(content) as {
        annotations: unknown[];
        candidates: unknown[];
      };
      assert.equal(result.annotations.length, 5);
      assert.equal(result.candidates.length, 1);
    });

    it('runs once with registry sync and adds new refs', async () => {
      const outputPath = join(tmpDir, 'watch-sync-scan.json');
      const registryPath = join(tmpDir, 'watch-registry.json');
      const registryContent = await readFile(
        join(PROJECT_ROOT, REGISTRY_PATH),
        'utf-8',
      );
      await writeFile(registryPath, registryContent, 'utf-8');

      const { exitCode } = await runCli([
        'watch',
        '--once',
        '--patterns',
        SCAN_PATTERNS,
        '--output',
        outputPath,
        '--sync-registry',
        '--registry',
        registryPath,
      ]);

      assert.equal(exitCode, 0);
      const content = await readFile(registryPath, 'utf-8');
      const registry = JSON.parse(content) as Record<
        string,
        { reason: string }
      >;
      assert.equal(registry['SUP-2002']!.reason, 'TODO: fill in reason');
    });
  });
});
