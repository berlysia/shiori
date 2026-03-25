import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile, chmod } from 'node:fs/promises';
import {
  runCli,
  createFixtureDir,
  createTempBase,
  unwrapEnvelope,
} from './helpers/cli-test-utils.ts';

describe('verify-cli: argument validation and error paths', () => {
  let baseDir: string;
  let cleanup: () => Promise<void>;

  before(async () => {
    ({ baseDir, cleanup } = await createTempBase('shiori-verify-test-'));
  });

  after(async () => {
    await cleanup();
  });

  describe('--fail-on validation', () => {
    it('rejects invalid --fail-on value with exit code 2', async () => {
      const dir = await createFixtureDir(baseDir, 'failon', {
        scanResult: {
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
        },
        registryEntries: {
          'VER-001': { reason: 'test annotation', target: 'all' },
        },
      });
      const { exitCode, stderr } = await runCli([
        'verify',
        '--cwd',
        dir,
        '--fail-on',
        'bogus-type',
      ]);

      assert.equal(exitCode, 2);
      assert.ok(stderr.includes('Invalid --fail-on'));
      assert.ok(stderr.includes('"bogus-type"'));
    });
  });

  describe('--warn-on validation', () => {
    it('rejects invalid --warn-on value with exit code 2', async () => {
      const dir = await createFixtureDir(baseDir, 'warnon', {
        scanResult: {
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
        },
        registryEntries: {
          'VER-001': { reason: 'test annotation', target: 'all' },
        },
      });
      const { exitCode, stderr } = await runCli([
        'verify',
        '--cwd',
        dir,
        '--warn-on',
        'invalid-issue',
      ]);

      assert.equal(exitCode, 2);
      assert.ok(stderr.includes('Invalid --warn-on'));
      assert.ok(stderr.includes('"invalid-issue"'));
    });
  });

  describe('--format validation', () => {
    it('rejects invalid --format value with exit code 2', async () => {
      const dir = await createFixtureDir(baseDir, 'format', {
        scanResult: {
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
        },
        registryEntries: {
          'VER-001': { reason: 'test annotation', target: 'all' },
        },
      });
      const { exitCode, stderr } = await runCli([
        'verify',
        '--cwd',
        dir,
        '--format',
        'xml',
      ]);

      assert.equal(exitCode, 2);
      assert.ok(stderr.includes('Invalid --format'));
      assert.ok(stderr.includes('"xml"'));
    });
  });

  describe('registry not found', () => {
    it('exits with error when no registry file exists', async () => {
      const dir = await createFixtureDir(baseDir, 'no-registry', {
        scanResult: {
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
        },
        skipRegistry: true,
      });
      const { exitCode, stderr } = await runCli(['verify', '--cwd', dir]);

      assert.equal(exitCode, 3);
      assert.ok(stderr.includes('No registry file found'));
    });
  });

  describe('scan result not found', () => {
    it('exits with error when scan result file does not exist', async () => {
      const dir = await createFixtureDir(baseDir, 'no-scan', {
        registryEntries: {
          'VER-001': { reason: 'test annotation', target: 'all' },
        },
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

      assert.equal(exitCode, 3);
      assert.ok(stderr.includes('Scan result file not found'));
    });
  });

  describe('successful verify with no issues', () => {
    it('exits 0 and outputs JSON when all annotations are in registry', async () => {
      const dir = await createFixtureDir(baseDir, 'success', {
        scanResult: {
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
        },
        registryEntries: {
          'VER-001': { reason: 'test annotation', target: 'all' },
        },
      });
      const scanPath = join(dir, '.config', 'shiori', 'scan-result.json');
      const { exitCode, stdout } = await runCli([
        'verify',
        '--cwd',
        dir,
        '--scan',
        scanPath,
      ]);

      assert.equal(exitCode, 0);
      const result = unwrapEnvelope<{
        summary: { errors: number };
      }>(stdout);
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
      const result = unwrapEnvelope<{
        summary: { errors: number };
        issues: Array<{ type: string }>;
      }>(stdout);
      assert.ok(result.summary.errors > 0);
      assert.ok(result.issues.some((i) => i.type === 'missing-in-registry'));
    });
  });
});

describe('verify-cli: --ref-status-command integration', () => {
  let baseDir: string;
  let cleanup: () => Promise<void>;

  before(async () => {
    ({ baseDir, cleanup } = await createTempBase('shiori-verify-refstatus-'));
  });

  after(async () => {
    await cleanup();
  });

  /**
   * Create a shell script that reads refs from stdin and outputs JSONL
   * marking all refs as the given status.
   */
  async function createRefStatusScript(
    dir: string,
    status: 'open' | 'closed',
  ): Promise<string> {
    const scriptPath = join(dir, 'ref-status-mock.sh');
    const script = `#!/bin/sh
while IFS= read -r ref; do
  [ -z "$ref" ] && continue
  printf '{"ref":"%s","status":"${status}"}\\n' "$ref"
done
`;
    await writeFile(scriptPath, script, 'utf-8');
    await chmod(scriptPath, 0o755);
    return scriptPath;
  }

  it('detects ref-status-closed when command reports closed refs', async () => {
    const dir = await createFixtureDir(baseDir, 'refstatus-closed', {
      scanResult: {
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
      },
      registryEntries: {
        'VER-001': { reason: 'test annotation', target: 'all' },
      },
    });
    const scriptPath = await createRefStatusScript(dir, 'closed');
    const scanPath = join(dir, '.config', 'shiori', 'scan-result.json');
    const { exitCode, stdout, stderr } = await runCli([
      'verify',
      '--cwd',
      dir,
      '--scan',
      scanPath,
      '--ref-status-command',
      scriptPath,
      '--fail-on',
      'ref-status-closed',
    ]);

    assert.equal(exitCode, 1);
    assert.ok(stderr.includes('Ref status'));
    assert.ok(stderr.includes('1 closed'));
    const result = unwrapEnvelope<{
      issues: Array<{ type: string; ref: string }>;
    }>(stdout);
    assert.ok(result.issues.some((i) => i.type === 'ref-status-closed'));
  });

  it('does not report ref-status-closed when command reports open refs', async () => {
    const dir = await createFixtureDir(baseDir, 'refstatus-open', {
      scanResult: {
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
      },
      registryEntries: {
        'VER-001': { reason: 'test annotation', target: 'all' },
      },
    });
    const scriptPath = await createRefStatusScript(dir, 'open');
    const scanPath = join(dir, '.config', 'shiori', 'scan-result.json');
    const { exitCode, stdout, stderr } = await runCli([
      'verify',
      '--cwd',
      dir,
      '--scan',
      scanPath,
      '--ref-status-command',
      scriptPath,
    ]);

    assert.equal(exitCode, 0);
    assert.ok(stderr.includes('Ref status'));
    assert.ok(stderr.includes('0 closed'));
    const result = unwrapEnvelope<{
      issues: Array<{ type: string }>;
    }>(stdout);
    assert.ok(!result.issues.some((i) => i.type === 'ref-status-closed'));
  });

  it('gracefully degrades when ref-status command fails', async () => {
    const dir = await createFixtureDir(baseDir, 'refstatus-fail', {
      scanResult: {
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
      },
      registryEntries: {
        'VER-001': { reason: 'test annotation', target: 'all' },
      },
    });
    // Use a command that will fail (non-existent)
    const scanPath = join(dir, '.config', 'shiori', 'scan-result.json');
    const { exitCode, stderr } = await runCli([
      'verify',
      '--cwd',
      dir,
      '--scan',
      scanPath,
      '--ref-status-command',
      '/nonexistent/command',
    ]);

    // Should still complete verify (graceful degradation), exit 0 since no fail-on errors
    assert.equal(exitCode, 0);
    assert.ok(stderr.includes('Warning: ref-status provider'));
  });
});
