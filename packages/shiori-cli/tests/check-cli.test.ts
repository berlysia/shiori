import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  runCli,
  createFixtureDir,
  createTempBase,
  unwrapEnvelope,
} from './helpers/cli-test-utils.ts';

describe('check-cli: argument validation and error paths', () => {
  let baseDir: string;
  let cleanup: () => Promise<void>;

  before(async () => {
    ({ baseDir, cleanup } = await createTempBase('shiori-check-test-'));
  });

  after(async () => {
    await cleanup();
  });

  describe('--fail-on validation', () => {
    it('rejects invalid --fail-on value with exit code 2', async () => {
      const dir = await createFixtureDir(baseDir, 'failon', {
        sourceFiles: {
          'src/sample.ts':
            '// eslint-disable-next-line no-console -- shiori: CHK-001\nconsole.log("test");\n',
        },
        registryEntries: {
          'CHK-001': { reason: 'test annotation', target: 'all' },
        },
      });
      const { exitCode, stderr } = await runCli([
        'check',
        '--cwd',
        dir,
        '--patterns',
        'src/**/*.ts',
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
        sourceFiles: {
          'src/sample.ts':
            '// eslint-disable-next-line no-console -- shiori: CHK-001\nconsole.log("test");\n',
        },
        registryEntries: {
          'CHK-001': { reason: 'test annotation', target: 'all' },
        },
      });
      const { exitCode, stderr } = await runCli([
        'check',
        '--cwd',
        dir,
        '--patterns',
        'src/**/*.ts',
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
        sourceFiles: {
          'src/sample.ts':
            '// eslint-disable-next-line no-console -- shiori: CHK-001\nconsole.log("test");\n',
        },
        registryEntries: {
          'CHK-001': { reason: 'test annotation', target: 'all' },
        },
      });
      const { exitCode, stderr } = await runCli([
        'check',
        '--cwd',
        dir,
        '--patterns',
        'src/**/*.ts',
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
        sourceFiles: {
          'src/sample.ts':
            '// eslint-disable-next-line no-console -- shiori: CHK-001\nconsole.log("test");\n',
        },
        skipRegistry: true,
      });
      const { exitCode, stderr } = await runCli([
        'check',
        '--cwd',
        dir,
        '--patterns',
        'src/**/*.ts',
      ]);

      assert.equal(exitCode, 3);
      assert.ok(stderr.includes('No registry file found'));
    });
  });

  describe('successful check with no issues', () => {
    it('exits 0 and outputs JSON when all annotations are in registry', async () => {
      const dir = await createFixtureDir(baseDir, 'success', {
        sourceFiles: {
          'src/sample.ts':
            '// eslint-disable-next-line no-console -- shiori: CHK-001\nconsole.log("test");\n',
        },
        registryEntries: {
          'CHK-001': { reason: 'test annotation', target: 'all' },
        },
      });
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
      const result = unwrapEnvelope<{
        summary: { errors: number };
      }>(stdout);
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
      const result = unwrapEnvelope<{
        summary: { errors: number };
        issues: Array<{ type: string }>;
      }>(stdout);
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
      const result = unwrapEnvelope<{
        summary: { errors: number };
        issues: Array<{ type: string }>;
      }>(content);
      assert.ok(result.summary.errors > 0, 'report should contain errors');
      assert.ok(
        result.issues.some((i) => i.type === 'missing-in-registry'),
        'report should contain missing-in-registry issue',
      );
    });
  });

  describe('--output file writing', () => {
    it('writes report to specified file instead of stdout', async () => {
      const dir = await createFixtureDir(baseDir, 'output', {
        sourceFiles: {
          'src/sample.ts':
            '// eslint-disable-next-line no-console -- shiori: CHK-001\nconsole.log("test");\n',
        },
        registryEntries: {
          'CHK-001': { reason: 'test annotation', target: 'all' },
        },
      });
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
      const result = unwrapEnvelope<{
        summary: { errors: number };
      }>(content);
      assert.equal(result.summary.errors, 0);
    });
  });
});
