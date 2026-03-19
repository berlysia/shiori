import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileExists, fileContainsLine } from '../src/commands/init.ts';
import { stepRegistry, type InitContext } from '../src/commands/init-steps.ts';
import type { ResolvedConfig } from '../src/core/config.ts';
import type { ScanResult, ShioriAnnotation } from '../src/core/types.ts';

describe('fileExists', () => {
  let tmpDir: string;

  after(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns true for existing file', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'shiori-init-'));
    const filePath = join(tmpDir, 'exists.txt');
    await writeFile(filePath, 'content', 'utf-8');

    assert.equal(await fileExists(filePath), true);
  });

  it('returns false for non-existing file', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'shiori-init-'));
    const filePath = join(tmpDir, 'nope.txt');

    assert.equal(await fileExists(filePath), false);
  });

  it('returns true for existing directory', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'shiori-init-'));
    const dirPath = join(tmpDir, 'subdir');
    await mkdir(dirPath);

    assert.equal(await fileExists(dirPath), true);
  });
});

describe('fileContainsLine', () => {
  let tmpDir: string;

  after(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns true when file contains the exact line', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'shiori-init-'));
    const filePath = join(tmpDir, '.gitignore');
    await writeFile(
      filePath,
      'node_modules/\n.config/shiori/scan-result.json\ndist/\n',
      'utf-8',
    );

    assert.equal(
      await fileContainsLine(filePath, '.config/shiori/scan-result.json'),
      true,
    );
  });

  it('returns true when line has surrounding whitespace', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'shiori-init-'));
    const filePath = join(tmpDir, '.gitignore');
    await writeFile(
      filePath,
      'node_modules/\n  .config/shiori/scan-result.json  \ndist/\n',
      'utf-8',
    );

    assert.equal(
      await fileContainsLine(filePath, '.config/shiori/scan-result.json'),
      true,
    );
  });

  it('returns false when file does not contain the line', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'shiori-init-'));
    const filePath = join(tmpDir, '.gitignore');
    await writeFile(filePath, 'node_modules/\ndist/\n', 'utf-8');

    assert.equal(
      await fileContainsLine(filePath, '.config/shiori/scan-result.json'),
      false,
    );
  });

  it('returns false when file does not exist', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'shiori-init-'));
    const filePath = join(tmpDir, 'nonexistent');

    assert.equal(await fileContainsLine(filePath, 'some-line'), false);
  });

  it('handles empty file', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'shiori-init-'));
    const filePath = join(tmpDir, 'empty');
    await writeFile(filePath, '', 'utf-8');

    assert.equal(await fileContainsLine(filePath, 'anything'), false);
  });
});

// ── stepRegistry: registryEntryCount ─────────────────────────

function makeInitContext(overrides: {
  cwd: string;
  registryPath: string;
  scanResult?: ScanResult;
}): InitContext {
  const stubConfig: ResolvedConfig = {
    candidatePatterns: { entries: {} },
    refPatterns: undefined,
    scanPatterns: undefined,
    scanIgnore: undefined,
    paths: {
      scanResult: '.config/shiori/scan-result.json',
      registry: undefined,
    },
    verify: { expiringThresholdDays: 14 },
  };
  return {
    cwd: overrides.cwd,
    config: stubConfig,
    configDir: join(overrides.cwd, '.config', 'shiori'),
    scanResultPath: join(
      overrides.cwd,
      '.config',
      'shiori',
      'scan-result.json',
    ),
    registryPath: overrides.registryPath,
    registryLabel: overrides.registryPath,
    gitignorePath: join(overrides.cwd, '.gitignore'),
    steps: [],
    registryEntryCount: 0,
    scanResult: overrides.scanResult,
  };
}

function makeAnnotation(ref: string): ShioriAnnotation {
  return {
    ref,
    rule: undefined,
    tagged: true,
    ignored: false,
    location: { file: 'test.ts', line: 1 },
  };
}

describe('stepRegistry: registryEntryCount', () => {
  let tmpDir: string;

  after(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it('sets registryEntryCount when creating new registry', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'shiori-stepReg-'));
    const registryPath = join(tmpDir, 'registry.json');

    const ctx = makeInitContext({
      cwd: tmpDir,
      registryPath,
      scanResult: {
        filesScanned: 1,
        annotations: [makeAnnotation('SUP-001'), makeAnnotation('SUP-002')],
        candidates: [],
      },
    });

    await stepRegistry(ctx);

    assert.equal(ctx.registryEntryCount, 2);
    assert.ok(ctx.steps[0]?.includes('2 entries'));
  });

  it('sets registryEntryCount when registry already exists', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'shiori-stepReg-'));
    const registryPath = join(tmpDir, 'registry.json');

    // Pre-create a registry with 3 entries
    const existingRegistry = {
      'EX-001': { reason: 'test', target: 'a.ts' },
      'EX-002': { reason: 'test', target: 'b.ts' },
      'EX-003': { reason: 'test', target: 'c.ts' },
    };
    await writeFile(
      registryPath,
      JSON.stringify(existingRegistry, null, 2),
      'utf-8',
    );

    const ctx = makeInitContext({ cwd: tmpDir, registryPath });

    await stepRegistry(ctx);

    assert.equal(ctx.registryEntryCount, 3);
    assert.ok(ctx.steps[0]?.includes('already exists, skipped'));
  });

  it('sets registryEntryCount to 0 for empty new registry', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'shiori-stepReg-'));
    const registryPath = join(tmpDir, 'registry.json');

    const ctx = makeInitContext({
      cwd: tmpDir,
      registryPath,
      scanResult: {
        filesScanned: 0,
        annotations: [],
        candidates: [],
      },
    });

    await stepRegistry(ctx);

    assert.equal(ctx.registryEntryCount, 0);
    assert.ok(ctx.steps[0]?.includes('0 entries'));
  });
});
