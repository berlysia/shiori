import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  runCli,
  createFixtureDir,
  createTempBase,
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
    it('rejects invalid --fail-on value with exit code 1', async () => {
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

      assert.equal(exitCode, 1);
      assert.ok(stderr.includes('Invalid --fail-on'));
      assert.ok(stderr.includes('"bogus-type"'));
    });
  });

  describe('--warn-on validation', () => {
    it('rejects invalid --warn-on value with exit code 1', async () => {
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

      assert.equal(exitCode, 1);
      assert.ok(stderr.includes('Invalid --warn-on'));
      assert.ok(stderr.includes('"invalid-issue"'));
    });
  });

  describe('--format validation', () => {
    it('rejects invalid --format value with exit code 1', async () => {
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

      assert.equal(exitCode, 1);
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

      assert.equal(exitCode, 1);
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

      assert.equal(exitCode, 1);
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
