import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createBaseContext,
  withRegistry,
  withScanResult,
  resolveScanPatterns,
  resolveExpiringThreshold,
} from '../src/core/cli-context.ts';
import type { ResolvedConfig } from '../src/core/config.ts';
import { DEFAULT_SCAN_IGNORE } from '../src/core/scan-defaults.ts';

/** Minimal resolved config for testing */
function makeConfig(overrides?: Partial<ResolvedConfig>): ResolvedConfig {
  return {
    candidatePatterns: { entries: {} },
    refPatterns: undefined,
    scanPatterns: undefined,
    scanIgnore: undefined,
    paths: {
      scanResult: '.config/shiori/scan-result.json',
      registry: undefined,
    },
    verify: { expiringThresholdDays: 14 },
    ...overrides,
  };
}

describe('createBaseContext', () => {
  it('uses provided cwd', () => {
    const ctx = createBaseContext('/some/dir');
    assert.equal(ctx.cwd, '/some/dir');
  });

  it('falls back to process.cwd() when cwd is undefined', () => {
    const ctx = createBaseContext(undefined);
    assert.equal(ctx.cwd, process.cwd());
  });
});

describe('withRegistry', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = join(tmpdir(), `shiori-cli-context-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    await mkdir(join(tmpDir, '.config', 'shiori'), { recursive: true });
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('loads config and registry from cwd', async () => {
    const registryPath = join(tmpDir, '.config', 'shiori', 'registry.json');
    await writeFile(
      registryPath,
      JSON.stringify({ 'CTX-1': { reason: 'test', target: 'all' } }),
    );

    const base = createBaseContext(tmpDir);
    const ctx = await withRegistry(base, {});

    assert.ok(ctx.config);
    assert.equal(ctx.registry['CTX-1']!.reason, 'test');
    assert.equal(ctx.registryPath, registryPath);
    assert.equal(ctx.cwd, tmpDir);
  });

  it('passes config and registry overrides through', async () => {
    const customReg = join(tmpDir, 'custom-reg.json');
    await writeFile(
      customReg,
      JSON.stringify({ 'CUSTOM-1': { reason: 'custom', target: 'src/' } }),
    );

    const base = createBaseContext(tmpDir);
    const ctx = await withRegistry(base, { registryPath: customReg });

    assert.equal(ctx.registryPath, customReg);
    assert.equal(ctx.registry['CUSTOM-1']!.reason, 'custom');
  });
});

describe('withScanResult', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = join(tmpdir(), `shiori-cli-context-scan-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    await mkdir(join(tmpDir, '.config', 'shiori'), { recursive: true });
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('loads scan result from explicit file path', async () => {
    // Setup registry
    const registryPath = join(tmpDir, '.config', 'shiori', 'registry.json');
    await writeFile(registryPath, JSON.stringify({}));

    // Setup scan result
    const scanPath = join(tmpDir, 'scan-result.json');
    await writeFile(
      scanPath,
      JSON.stringify({
        annotations: [
          {
            ref: 'TEST-1',
            rule: 'no-unused',
            tagged: true,
            ignored: false,
            location: { file: 'a.ts', line: 1 },
          },
        ],
        candidates: [],
        filesScanned: 1,
      }),
    );

    const base = createBaseContext(tmpDir);
    const regCtx = await withRegistry(base, {});
    const scanCtx = await withScanResult(regCtx, scanPath);

    assert.equal(scanCtx.scanResult.annotations.length, 1);
    assert.equal(scanCtx.scanResult.annotations[0]!.ref, 'TEST-1');
    // Inherited fields
    assert.equal(scanCtx.cwd, tmpDir);
    assert.ok(scanCtx.config);
  });
});

describe('resolveScanPatterns', () => {
  it('uses CLI arg patterns when provided', () => {
    const config = makeConfig();
    const result = resolveScanPatterns('*.ts,*.tsx', '*.test.*', config);

    assert.deepEqual(result.patterns, ['*.ts', '*.tsx']);
    assert.deepEqual(result.ignore, ['*.test.*']);
  });

  it('merges config scanIgnore with defaults (EP-0051)', () => {
    const config = makeConfig({
      scanPatterns: ['**/*.css'],
      scanIgnore: ['**/vendor/**'],
    });
    const result = resolveScanPatterns(undefined, undefined, config);

    assert.deepEqual(result.patterns, ['**/*.css']);
    // Config scanIgnore is appended to defaults, not replacing them
    assert.deepEqual(result.ignore, [...DEFAULT_SCAN_IGNORE, '**/vendor/**']);
    assert.ok(result.ignore.includes('**/node_modules/**'));
    assert.ok(result.ignore.includes('**/vendor/**'));
  });

  it('falls back to defaults when config has no patterns', () => {
    const config = makeConfig();
    const result = resolveScanPatterns(undefined, undefined, config);

    assert.deepEqual(result.patterns, ['**/*.{css,scss,pcss,js,ts,tsx,jsx}']);
    assert.ok(result.ignore.includes('**/node_modules/**'));
  });

  it('trims whitespace from comma-separated values', () => {
    const config = makeConfig();
    const result = resolveScanPatterns(
      ' *.ts , *.tsx ',
      ' test/ , dist/ ',
      config,
    );

    assert.deepEqual(result.patterns, ['*.ts', '*.tsx']);
    assert.deepEqual(result.ignore, ['test/', 'dist/']);
  });
});

describe('resolveExpiringThreshold', () => {
  it('uses CLI arg when provided', () => {
    const config = makeConfig({ verify: { expiringThresholdDays: 14 } });
    assert.equal(resolveExpiringThreshold('30', config), 30);
  });

  it('falls back to config value', () => {
    const config = makeConfig({ verify: { expiringThresholdDays: 7 } });
    assert.equal(resolveExpiringThreshold(undefined, config), 7);
  });
});
