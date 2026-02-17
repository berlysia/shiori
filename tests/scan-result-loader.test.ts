import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadScanResult } from '../src/core/scan-result-loader.ts';
import { resolveConfig } from '../src/core/config.ts';

const SAMPLE_SCAN_RESULT = {
  annotations: [
    {
      ref: 'TEST-001',
      tagged: true,
      ignored: false,
      location: { file: 'test.ts', line: 1 },
    },
  ],
  candidates: [],
  filesScanned: 1,
};

describe('loadScanResult', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = join(tmpdir(), `shiori-loader-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('loads from explicit path', async () => {
    const filePath = join(tmpDir, 'explicit.json');
    await writeFile(filePath, JSON.stringify(SAMPLE_SCAN_RESULT), 'utf-8');

    const result = await loadScanResult({
      explicitPath: filePath,
      config: resolveConfig({}),
      cwd: tmpDir,
    });
    assert.equal(result.annotations.length, 1);
    assert.equal(result.annotations[0]!.ref, 'TEST-001');
  });

  it('loads from default scan result path', async () => {
    const projectDir = join(tmpDir, 'default-path');
    const configDir = join(projectDir, '.config', 'shiori');
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, 'scan-result.json'),
      JSON.stringify(SAMPLE_SCAN_RESULT),
      'utf-8',
    );

    // Simulate TTY (stdin.isTTY = true) by passing explicit config
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      writable: true,
      configurable: true,
    });
    try {
      const result = await loadScanResult({
        explicitPath: undefined,
        config: resolveConfig({}),
        cwd: projectDir,
      });
      assert.equal(result.annotations.length, 1);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', {
        value: originalIsTTY,
        writable: true,
        configurable: true,
      });
    }
  });

  it('loads from custom config path', async () => {
    const projectDir = join(tmpDir, 'custom-path');
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      join(projectDir, 'my-scan.json'),
      JSON.stringify(SAMPLE_SCAN_RESULT),
      'utf-8',
    );

    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      writable: true,
      configurable: true,
    });
    try {
      const result = await loadScanResult({
        explicitPath: undefined,
        config: resolveConfig({ paths: { scanResult: 'my-scan.json' } }),
        cwd: projectDir,
      });
      assert.equal(result.annotations.length, 1);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', {
        value: originalIsTTY,
        writable: true,
        configurable: true,
      });
    }
  });

  it('throws with helpful message when no source found', async () => {
    const emptyDir = join(tmpDir, 'empty');
    await mkdir(emptyDir, { recursive: true });

    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      writable: true,
      configurable: true,
    });
    try {
      await assert.rejects(
        () =>
          loadScanResult({
            explicitPath: undefined,
            config: resolveConfig({}),
            cwd: emptyDir,
          }),
        /No scan result found/,
      );
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', {
        value: originalIsTTY,
        writable: true,
        configurable: true,
      });
    }
  });

  it('throws user-friendly message for missing explicit file', async () => {
    await assert.rejects(
      () =>
        loadScanResult({
          explicitPath: '/nonexistent/path/scan.json',
          config: resolveConfig({}),
          cwd: tmpDir,
        }),
      (err: Error) => {
        assert.ok(err.message.includes('Scan result file not found'));
        assert.ok(err.message.includes('/nonexistent/path/scan.json'));
        assert.ok(err.message.includes('shiori scan'));
        return true;
      },
    );
  });

  it('throws user-friendly message for invalid JSON in explicit file', async () => {
    const badJsonPath = join(tmpDir, 'bad.json');
    await writeFile(badJsonPath, '{ not valid json', 'utf-8');

    await assert.rejects(
      () =>
        loadScanResult({
          explicitPath: badJsonPath,
          config: resolveConfig({}),
          cwd: tmpDir,
        }),
      (err: Error) => {
        assert.ok(err.message.includes('Failed to parse scan result as JSON'));
        assert.ok(err.message.includes(badJsonPath));
        return true;
      },
    );
  });

  it('throws user-friendly message for invalid JSON in default path', async () => {
    const projectDir = join(tmpDir, 'bad-default');
    const configDir = join(projectDir, '.config', 'shiori');
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, 'scan-result.json'),
      'not json at all',
      'utf-8',
    );

    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      writable: true,
      configurable: true,
    });
    try {
      await assert.rejects(
        () =>
          loadScanResult({
            explicitPath: undefined,
            config: resolveConfig({}),
            cwd: projectDir,
          }),
        (err: Error) => {
          assert.ok(
            err.message.includes('Failed to parse scan result as JSON'),
          );
          return true;
        },
      );
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', {
        value: originalIsTTY,
        writable: true,
        configurable: true,
      });
    }
  });
});
