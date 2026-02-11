import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const execFileAsync = promisify(execFile);

const CLI_PATH = new URL('../dist/src/cli.js', import.meta.url).pathname;
const PROJECT_ROOT = new URL('..', import.meta.url).pathname;

// Relative patterns for fast-glob (resolved from PROJECT_ROOT as cwd)
const SCAN_PATTERNS = 'tests/fixtures/e2e/**/*.css,tests/fixtures/e2e/**/*.ts';
const REGISTRY_PATH = 'tests/fixtures/e2e/registry.json';

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[]): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      'node',
      [CLI_PATH, ...args],
      {
        cwd: PROJECT_ROOT,
      },
    );
    return { stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      exitCode: e.code ?? 1,
    };
  }
}

describe('CLI E2E', () => {
  let tmpDir: string;
  let scanResultPath: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'shiori-e2e-'));
    scanResultPath = join(tmpDir, 'scan-result.json');

    // Pre-run scan and save result for verify/init-registry tests
    const { stdout } = await runCli(['scan', '--patterns', SCAN_PATTERNS]);

    const records = JSON.parse(stdout) as unknown[];
    assert.ok(Array.isArray(records), 'scan should output JSON array');
    assert.ok(records.length > 0, 'scan should find records');
    await writeFile(scanResultPath, JSON.stringify(records, null, 2), 'utf-8');
  });

  after(async () => {
    const files = [
      'scan-result.json',
      'output-scan.json',
      'new-registry.json',
      'merged-registry.json',
      'draft-result.json',
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
    it('outputs ShioriAnnotation JSON to stdout', async () => {
      const { stdout, exitCode } = await runCli([
        'scan',
        '--patterns',
        SCAN_PATTERNS,
      ]);
      assert.equal(exitCode, 0);
      const records = JSON.parse(stdout) as Array<{
        ref: string;
        location: { file: string };
      }>;
      assert.ok(Array.isArray(records));
      // SUP-1001, SUP-1002, SUP-2001, SUP-2002, malformed(no-debugger), draft(no ref)
      assert.equal(records.length, 6);
      // Verify new field shape
      assert.ok(records[0]!.ref !== undefined);
      assert.ok(records[0]!.location !== undefined);
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
      const records = JSON.parse(content) as unknown[];
      assert.equal(records.length, 6);
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
        'missing-in-registry,unused-in-source,expired,malformed',
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
        'missing-in-registry,unused-in-source,expired,malformed',
      ]);
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('# Annotation Registry Verification Report'));
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
        'missing-in-registry,unused-in-source,malformed',
      ]);
      const result = JSON.parse(stdout) as {
        issues: Array<{ type: string }>;
      };
      const expired = result.issues.filter((i) => i.type === 'expired');
      assert.ok(expired.length > 0); // SUP-9999 expired
    });
  });

  describe('init-registry command', () => {
    it('generates a registry template', async () => {
      const outputPath = join(tmpDir, 'new-registry.json');
      const { exitCode } = await runCli([
        'init-registry',
        '--scan',
        scanResultPath,
        '--output',
        outputPath,
      ]);
      assert.equal(exitCode, 0);
      const content = await readFile(outputPath, 'utf-8');
      const registry = JSON.parse(content) as Record<
        string,
        { reason: string }
      >;
      assert.ok('SUP-1001' in registry);
      assert.equal(registry['SUP-1001']!.reason, 'TODO: fill in reason');
    });

    it('merges with existing registry (preserves existing entries)', async () => {
      const outputPath = join(tmpDir, 'merged-registry.json');
      const { exitCode } = await runCli([
        'init-registry',
        '--scan',
        scanResultPath,
        '--output',
        outputPath,
        '--merge',
        join(PROJECT_ROOT, REGISTRY_PATH),
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
});
