import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, rm, utimes } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { performScanFreshnessCheck } from '../src/core/scan-freshness.ts';
import type { ResolvedConfig } from '../src/core/config.ts';

// Minimal config for scan result resolution
function makeConfig(
  scanResultPath = '.config/shiori/scan-result.json',
): ResolvedConfig {
  return {
    paths: {
      registry: '.config/shiori/registry.json',
      scanResult: scanResultPath,
    },
    refPatterns: [],
  } as unknown as ResolvedConfig;
}

describe('performScanFreshnessCheck', () => {
  const tmpDir = resolve(import.meta.dirname!, '../.tmp/test-scan-freshness');

  it('returns checked=false for empty source files', async () => {
    const result = await performScanFreshnessCheck(
      { explicitPath: undefined, config: makeConfig(), cwd: tmpDir },
      [],
      tmpDir,
    );
    assert.equal(result.checked, false);
  });

  it('returns checked=false when scan result path is stdin', async () => {
    const result = await performScanFreshnessCheck(
      { explicitPath: '-', config: makeConfig(), cwd: tmpDir },
      ['src/foo.ts'],
      tmpDir,
    );
    assert.equal(result.checked, false);
  });

  it('returns checked=true and fresh=true when source is older than scan result', async () => {
    // Setup temp directory with scan result and source file
    await mkdir(join(tmpDir, '.config/shiori'), { recursive: true });
    await mkdir(join(tmpDir, 'src'), { recursive: true });

    const scanResultFile = join(tmpDir, '.config/shiori/scan-result.json');
    const sourceFile = join(tmpDir, 'src/foo.ts');

    // Create source file first (older)
    await writeFile(sourceFile, 'const x = 1;');
    const oldTime = new Date(Date.now() - 10000);
    await utimes(sourceFile, oldTime, oldTime);

    // Create scan result file (newer)
    await writeFile(scanResultFile, JSON.stringify({ annotations: [] }));

    // Use explicitPath to bypass stdin TTY check in resolveScanResultPath
    const result = await performScanFreshnessCheck(
      {
        explicitPath: '.config/shiori/scan-result.json',
        config: makeConfig(),
        cwd: tmpDir,
      },
      ['src/foo.ts'],
      tmpDir,
    );

    assert.equal(result.checked, true);
    assert.equal(result.freshness.fresh, true);
    assert.equal(result.freshness.staleFiles.length, 0);

    // Cleanup
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns checked=true and fresh=false when source is newer than scan result', async () => {
    await mkdir(join(tmpDir, '.config/shiori'), { recursive: true });
    await mkdir(join(tmpDir, 'src'), { recursive: true });

    const scanResultFile = join(tmpDir, '.config/shiori/scan-result.json');
    const sourceFile = join(tmpDir, 'src/bar.ts');

    // Create scan result file first (older)
    await writeFile(scanResultFile, JSON.stringify({ annotations: [] }));
    const oldTime = new Date(Date.now() - 10000);
    await utimes(scanResultFile, oldTime, oldTime);

    // Create source file (newer)
    await writeFile(sourceFile, 'const y = 2;');

    // Use explicitPath to bypass stdin TTY check in resolveScanResultPath
    const result = await performScanFreshnessCheck(
      {
        explicitPath: '.config/shiori/scan-result.json',
        config: makeConfig(),
        cwd: tmpDir,
      },
      ['src/bar.ts'],
      tmpDir,
    );

    assert.equal(result.checked, true);
    assert.equal(result.freshness.fresh, false);
    assert.deepEqual(result.freshness.staleFiles, ['src/bar.ts']);

    // Cleanup
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns checked=false when scan result file does not exist', async () => {
    const nonExistentDir = resolve(tmpDir, 'nonexistent');
    const result = await performScanFreshnessCheck(
      { explicitPath: undefined, config: makeConfig(), cwd: nonExistentDir },
      ['src/foo.ts'],
      nonExistentDir,
    );
    assert.equal(result.checked, false);
  });

  it('uses explicit scan result path', async () => {
    await mkdir(join(tmpDir, 'custom'), { recursive: true });
    await mkdir(join(tmpDir, 'src'), { recursive: true });

    const scanResultFile = join(tmpDir, 'custom/scan.json');
    const sourceFile = join(tmpDir, 'src/explicit.ts');

    // Create source file (older)
    await writeFile(sourceFile, 'const z = 3;');
    const oldTime = new Date(Date.now() - 10000);
    await utimes(sourceFile, oldTime, oldTime);

    // Create scan result file (newer)
    await writeFile(scanResultFile, JSON.stringify({ annotations: [] }));

    const result = await performScanFreshnessCheck(
      { explicitPath: 'custom/scan.json', config: makeConfig(), cwd: tmpDir },
      ['src/explicit.ts'],
      tmpDir,
    );

    assert.equal(result.checked, true);
    assert.equal(result.freshness.fresh, true);

    // Cleanup
    await rm(tmpDir, { recursive: true, force: true });
  });
});
