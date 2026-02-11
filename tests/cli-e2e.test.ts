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
const LEDGER_PATH = 'tests/fixtures/e2e/ledger.json';

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[]): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync('node', [CLI_PATH, ...args], {
      cwd: PROJECT_ROOT,
    });
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
    tmpDir = await mkdtemp(join(tmpdir(), 'lint-ledger-e2e-'));
    scanResultPath = join(tmpDir, 'scan-result.json');

    // Pre-run scan and save result for verify/init-ledger tests
    const { stdout } = await runCli([
      'scan',
      '--patterns',
      SCAN_PATTERNS,
    ]);

    const records = JSON.parse(stdout) as unknown[];
    assert.ok(Array.isArray(records), 'scan should output JSON array');
    assert.ok(records.length > 0, 'scan should find records');
    await writeFile(scanResultPath, JSON.stringify(records, null, 2), 'utf-8');
  });

  after(async () => {
    const files = ['scan-result.json', 'output-scan.json', 'new-ledger.json', 'merged-ledger.json'];
    for (const f of files) {
      try {
        await unlink(join(tmpDir, f));
      } catch {
        // file may not exist
      }
    }
  });

  describe('scan command', () => {
    it('outputs SuppressionRecord JSON to stdout', async () => {
      const { stdout, exitCode } = await runCli([
        'scan',
        '--patterns',
        SCAN_PATTERNS,
      ]);
      assert.equal(exitCode, 0);
      const records = JSON.parse(stdout) as unknown[];
      assert.ok(Array.isArray(records));
      // SUP-1001, SUP-1002, SUP-2001, SUP-2002, malformed(no-debugger)
      assert.equal(records.length, 5);
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
      assert.equal(records.length, 5);
    });
  });

  describe('verify command', () => {
    it('exits 1 when missing-in-ledger with --fail-on', async () => {
      // SUP-2002 is not in ledger → missing-in-ledger
      const { exitCode, stdout } = await runCli([
        'verify',
        '--scan',
        scanResultPath,
        '--ledger',
        join(PROJECT_ROOT, LEDGER_PATH),
        '--fail-on',
        'missing-in-ledger',
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
        '--ledger',
        join(PROJECT_ROOT, LEDGER_PATH),
        '--warn-on',
        'missing-in-ledger,unused-in-source,expired,malformed',
      ]);
      assert.equal(exitCode, 0);
    });

    it('outputs markdown with --format markdown', async () => {
      const { stdout, exitCode } = await runCli([
        'verify',
        '--scan',
        scanResultPath,
        '--ledger',
        join(PROJECT_ROOT, LEDGER_PATH),
        '--format',
        'markdown',
        '--warn-on',
        'missing-in-ledger,unused-in-source,expired,malformed',
      ]);
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('# Lint Ledger Verification Report'));
    });

    it('detects expired entries', async () => {
      const { stdout } = await runCli([
        'verify',
        '--scan',
        scanResultPath,
        '--ledger',
        join(PROJECT_ROOT, LEDGER_PATH),
        '--fail-on',
        'expired',
        '--warn-on',
        'missing-in-ledger,unused-in-source,malformed',
      ]);
      const result = JSON.parse(stdout) as {
        issues: Array<{ type: string }>;
      };
      const expired = result.issues.filter((i) => i.type === 'expired');
      assert.ok(expired.length > 0); // SUP-9999 expired
    });
  });

  describe('init-ledger command', () => {
    it('generates a ledger template', async () => {
      const outputPath = join(tmpDir, 'new-ledger.json');
      const { exitCode } = await runCli([
        'init-ledger',
        '--scan',
        scanResultPath,
        '--output',
        outputPath,
      ]);
      assert.equal(exitCode, 0);
      const content = await readFile(outputPath, 'utf-8');
      const ledger = JSON.parse(content) as Record<string, { reason: string }>;
      assert.ok('SUP-1001' in ledger);
      assert.equal(ledger['SUP-1001']!.reason, 'TODO: fill in reason');
    });

    it('merges with existing ledger', async () => {
      const outputPath = join(tmpDir, 'merged-ledger.json');
      const { exitCode } = await runCli([
        'init-ledger',
        '--scan',
        scanResultPath,
        '--output',
        outputPath,
        '--merge',
        join(PROJECT_ROOT, LEDGER_PATH),
      ]);
      assert.equal(exitCode, 0);
      const content = await readFile(outputPath, 'utf-8');
      const ledger = JSON.parse(content) as Record<string, { reason: string }>;
      // Existing entry preserved
      assert.equal(ledger['SUP-1001']!.reason, 'vendor prefix fallback');
      // New entry gets placeholder
      assert.equal(ledger['SUP-2002']!.reason, 'TODO: fill in reason');
    });
  });
});
