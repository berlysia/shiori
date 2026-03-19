import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  runCli,
  createTempBase,
  createFixtureDir,
} from './helpers/cli-test-utils.ts';

describe('summary-cli: --scan option', () => {
  let baseDir: string;
  let cleanup: () => Promise<void>;

  before(async () => {
    ({ baseDir, cleanup } = await createTempBase('shiori-summary-test-'));
  });

  after(async () => {
    await cleanup();
  });

  it('loads pre-computed scan result from --scan path', async () => {
    const dir = await createFixtureDir(baseDir, 'scan-file', {
      scanResult: {
        annotations: [
          {
            ref: 'TEST-001',
            rule: 'no-console',
            tagged: true,
            ignored: false,
            location: { file: 'test.ts', line: 1 },
          },
        ],
        candidates: [],
        filesScanned: 1,
      },
      registryEntries: {
        'TEST-001': {
          reason: 'test reason',
          target: 'test.ts',
        },
      },
    });

    const scanPath = join(dir, '.config', 'shiori', 'scan-result.json');
    const { exitCode, stdout, stderr } = await runCli([
      'summary',
      '--cwd',
      dir,
      '--scan',
      scanPath,
      '--format',
      'json',
    ]);

    assert.equal(exitCode, 0, `stderr: ${stderr}`);
    const result = JSON.parse(stdout) as {
      health: { health: { score: number; level: string } };
      timestamp: string;
    };
    assert.equal(result.health.health.level, 'healthy');
    assert.ok(result.timestamp);
    // Should log "Loaded scan result" instead of "Scanned N files"
    assert.ok(
      stderr.includes('Loaded scan result'),
      'should indicate loaded scan result',
    );
  });

  it('generates markdown output with --scan and --format markdown', async () => {
    const dir = await createFixtureDir(baseDir, 'scan-md', {
      scanResult: {
        annotations: [
          {
            ref: 'MD-001',
            rule: 'no-console',
            tagged: true,
            ignored: false,
            location: { file: 'test.ts', line: 1 },
          },
        ],
        candidates: [],
        filesScanned: 1,
      },
      registryEntries: {
        'MD-001': {
          reason: 'markdown test',
          target: 'test.ts',
        },
      },
    });

    const scanPath = join(dir, '.config', 'shiori', 'scan-result.json');
    const { exitCode, stdout } = await runCli([
      'summary',
      '--cwd',
      dir,
      '--scan',
      scanPath,
      '--format',
      'markdown',
    ]);

    assert.equal(exitCode, 0);
    assert.ok(stdout.includes('## Shiori Governance Summary'));
    assert.ok(stdout.includes('Health:'));
  });

  it('includes delta when --scan and --base are both provided', async () => {
    const dir = await mkdtemp(join(baseDir, 'scan-delta-'));
    await mkdir(join(dir, '.config', 'shiori'), { recursive: true });

    // Registry
    await writeFile(
      join(dir, '.config', 'shiori', 'registry.json'),
      JSON.stringify(
        {
          'BASE-001': { reason: 'base', target: 'base.ts' },
          'HEAD-001': { reason: 'head', target: 'head.ts' },
        },
        null,
        2,
      ),
      'utf-8',
    );

    // Base scan (1 annotation)
    const baseScanPath = join(dir, 'base-scan.json');
    await writeFile(
      baseScanPath,
      JSON.stringify({
        annotations: [
          {
            ref: 'BASE-001',
            rule: 'no-console',
            tagged: true,
            ignored: false,
            location: { file: 'base.ts', line: 1 },
          },
        ],
        candidates: [],
        filesScanned: 1,
      }),
      'utf-8',
    );

    // Head scan (different annotation)
    const headScanPath = join(dir, 'head-scan.json');
    await writeFile(
      headScanPath,
      JSON.stringify({
        annotations: [
          {
            ref: 'HEAD-001',
            rule: 'no-debugger',
            tagged: true,
            ignored: false,
            location: { file: 'head.ts', line: 5 },
          },
        ],
        candidates: [],
        filesScanned: 1,
      }),
      'utf-8',
    );

    const { exitCode, stdout, stderr } = await runCli([
      'summary',
      '--cwd',
      dir,
      '--scan',
      headScanPath,
      '--base',
      baseScanPath,
      '--format',
      'json',
    ]);

    assert.equal(exitCode, 0, `stderr: ${stderr}`);
    const result = JSON.parse(stdout) as {
      delta: {
        summary: { added: number; removed: number; net: number };
      };
    };
    assert.ok(result.delta, 'delta should be present');
    assert.equal(result.delta.summary.added, 1);
    assert.equal(result.delta.summary.removed, 1);
  });

  it('fails gracefully when --scan points to nonexistent file', async () => {
    const dir = await createFixtureDir(baseDir, 'scan-missing', {
      registryEntries: {},
      skipScanResult: true,
    });

    const { exitCode, stderr } = await runCli([
      'summary',
      '--cwd',
      dir,
      '--scan',
      join(dir, 'nonexistent.json'),
    ]);

    assert.equal(exitCode, 1);
    assert.ok(stderr.includes('Error loading scan result'));
  });
});
