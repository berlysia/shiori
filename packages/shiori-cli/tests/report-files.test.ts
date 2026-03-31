import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadReportFiles, isReportShape } from '../src/core/report-files.ts';

function makeReportJson(overrides: {
  timestamp?: string;
  score?: number;
}): string {
  const timestamp = overrides.timestamp ?? '2026-01-01T00:00:00.000Z';
  const score = overrides.score ?? 100;
  const level = score >= 80 ? 'healthy' : score >= 50 ? 'warning' : 'critical';
  return JSON.stringify(
    {
      timestamp,
      health: { level, score, summary: `Score: ${score}/100` },
      totals: {
        annotations: 5,
        candidates: 0,
        registryEntries: 5,
        issues: 0,
        errors: 0,
        warnings: 0,
      },
      insights: [],
      byType: {
        'missing-in-registry': 0,
        'unused-in-source': 0,
        expired: 0,
        'syntax-error': 0,
        'ref-format': 0,
        'ref-collision': 0,
        'unrouted-ref': 0,
        'registry-routing-mismatch': 0,
        'expiring-soon': 0,
        'ref-status-closed': 0,
        'intentional-without-reason': 0,
        'temporary-without-expires': 0,
      },
      byRule: [],
      byKind: [],
      byOwner: [],
      verifyResult: {
        timestamp,
        issues: [],
        summary: {
          total: 0,
          errors: 0,
          warnings: 0,
          byType: {
            'missing-in-registry': 0,
            'unused-in-source': 0,
            expired: 0,
            'syntax-error': 0,
            'ref-format': 0,
            'ref-collision': 0,
            'unrouted-ref': 0,
            'registry-routing-mismatch': 0,
            'expiring-soon': 0,
            'ref-status-closed': 0,
            'intentional-without-reason': 0,
            'temporary-without-expires': 0,
          },
        },
        scannedRecords: 5,
        registryEntries: 5,
      },
    },
    null,
    2,
  );
}

describe('loadReportFiles', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'shiori-report-files-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('loads valid report files from directory', async () => {
    await writeFile(
      join(tmpDir, 'report1.json'),
      makeReportJson({ timestamp: '2026-01-01T00:00:00.000Z', score: 90 }),
    );
    await writeFile(
      join(tmpDir, 'report2.json'),
      makeReportJson({ timestamp: '2026-02-01T00:00:00.000Z', score: 80 }),
    );

    const result = await loadReportFiles(tmpDir);

    assert.ok(result);
    assert.equal(result.length, 2);
  });

  it('returns null for non-existent directory', async () => {
    const errors: string[] = [];
    const result = await loadReportFiles('/nonexistent/path', {
      onDirectoryError: (msg) => errors.push(msg),
    });

    assert.equal(result, null);
    assert.equal(errors.length, 1);
    assert.ok(errors[0]!.includes('Cannot read history directory'));
  });

  it('returns null for empty directory', async () => {
    const warnings: string[] = [];
    const result = await loadReportFiles(tmpDir, {
      onNoFiles: (dir) => warnings.push(dir),
    });

    assert.equal(result, null);
    assert.equal(warnings.length, 1);
  });

  it('skips non-JSON files', async () => {
    await writeFile(join(tmpDir, 'readme.txt'), 'not a json');
    await writeFile(
      join(tmpDir, 'report.json'),
      makeReportJson({ timestamp: '2026-01-01T00:00:00.000Z' }),
    );

    const result = await loadReportFiles(tmpDir);

    assert.ok(result);
    assert.equal(result.length, 1);
  });

  it('skips invalid JSON files', async () => {
    await writeFile(join(tmpDir, 'bad.json'), 'not valid json{{{');
    await writeFile(
      join(tmpDir, 'good.json'),
      makeReportJson({ timestamp: '2026-01-01T00:00:00.000Z' }),
    );

    const result = await loadReportFiles(tmpDir);

    assert.ok(result);
    assert.equal(result.length, 1);
  });

  it('calls onSkipped for invalid JSON files', async () => {
    await writeFile(join(tmpDir, 'bad.json'), 'not valid json{{{');
    await writeFile(
      join(tmpDir, 'good.json'),
      makeReportJson({ timestamp: '2026-01-01T00:00:00.000Z' }),
    );

    const skipped: Array<{ fileName: string; reason: string }> = [];
    const result = await loadReportFiles(tmpDir, {
      onSkipped: (fileName, reason) => skipped.push({ fileName, reason }),
    });

    assert.ok(result);
    assert.equal(result.length, 1);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0]!.fileName, 'bad.json');
    assert.ok(skipped[0]!.reason.startsWith('JSON parse error:'));
  });

  it('skips JSON files without required fields', async () => {
    await writeFile(
      join(tmpDir, 'incomplete.json'),
      JSON.stringify({ foo: 'bar' }),
    );
    await writeFile(
      join(tmpDir, 'valid.json'),
      makeReportJson({ timestamp: '2026-01-01T00:00:00.000Z' }),
    );

    const result = await loadReportFiles(tmpDir);

    assert.ok(result);
    assert.equal(result.length, 1);
  });

  it('calls onSkipped for files with invalid shape', async () => {
    await writeFile(
      join(tmpDir, 'incomplete.json'),
      JSON.stringify({ foo: 'bar' }),
    );
    await writeFile(
      join(tmpDir, 'valid.json'),
      makeReportJson({ timestamp: '2026-01-01T00:00:00.000Z' }),
    );

    const skipped: Array<{ fileName: string; reason: string }> = [];
    const result = await loadReportFiles(tmpDir, {
      onSkipped: (fileName, reason) => skipped.push({ fileName, reason }),
    });

    assert.ok(result);
    assert.equal(result.length, 1);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0]!.fileName, 'incomplete.json');
    assert.ok(skipped[0]!.reason.includes('Invalid report shape'));
  });

  it('returns null when all JSON files are invalid', async () => {
    await writeFile(join(tmpDir, 'bad1.json'), '{}');
    await writeFile(join(tmpDir, 'bad2.json'), 'invalid');

    const result = await loadReportFiles(tmpDir);

    assert.equal(result, null);
  });

  it('calls onLoaded callback with count and dir', async () => {
    await writeFile(
      join(tmpDir, 'r1.json'),
      makeReportJson({ timestamp: '2026-01-01T00:00:00.000Z' }),
    );
    await writeFile(
      join(tmpDir, 'r2.json'),
      makeReportJson({ timestamp: '2026-02-01T00:00:00.000Z' }),
    );

    let loadedCount = 0;
    let loadedDir = '';
    await loadReportFiles(tmpDir, {
      onLoaded: (count, dir) => {
        loadedCount = count;
        loadedDir = dir;
      },
    });

    assert.equal(loadedCount, 2);
    assert.equal(loadedDir, tmpDir);
  });

  it('works without callbacks', async () => {
    await writeFile(
      join(tmpDir, 'report.json'),
      makeReportJson({ timestamp: '2026-01-01T00:00:00.000Z' }),
    );

    const result = await loadReportFiles(tmpDir);

    assert.ok(result);
    assert.equal(result.length, 1);
  });

  it('rejects JSON with valid timestamp and score but missing totals', async () => {
    await writeFile(
      join(tmpDir, 'partial.json'),
      JSON.stringify({
        timestamp: '2026-01-01T00:00:00.000Z',
        health: { level: 'healthy', score: 100, summary: 'ok' },
        // missing totals
      }),
    );

    const result = await loadReportFiles(tmpDir);

    assert.equal(result, null);
  });

  it('rejects JSON with invalid health level', async () => {
    await writeFile(
      join(tmpDir, 'bad-level.json'),
      JSON.stringify({
        timestamp: '2026-01-01T00:00:00.000Z',
        health: { level: 'unknown', score: 100, summary: 'ok' },
        totals: {
          annotations: 5,
          candidates: 0,
          registryEntries: 5,
          issues: 0,
          errors: 0,
          warnings: 0,
        },
      }),
    );

    const result = await loadReportFiles(tmpDir);

    assert.equal(result, null);
  });
});

describe('isReportShape', () => {
  it('accepts valid report shape', () => {
    assert.equal(
      isReportShape({
        timestamp: '2026-01-01T00:00:00.000Z',
        health: { level: 'healthy', score: 100, summary: 'ok' },
        totals: {
          annotations: 5,
          candidates: 0,
          registryEntries: 5,
          issues: 0,
          errors: 0,
          warnings: 0,
        },
      }),
      true,
    );
  });

  it('rejects missing timestamp', () => {
    assert.equal(
      isReportShape({
        health: { level: 'healthy', score: 100 },
        totals: { annotations: 5, candidates: 0, issues: 0 },
      }),
      false,
    );
  });

  it('rejects non-string timestamp', () => {
    assert.equal(
      isReportShape({
        timestamp: 12345,
        health: { level: 'healthy', score: 100 },
        totals: { annotations: 5, candidates: 0, issues: 0 },
      }),
      false,
    );
  });

  it('rejects missing health', () => {
    assert.equal(
      isReportShape({
        timestamp: '2026-01-01T00:00:00.000Z',
        totals: { annotations: 5, candidates: 0, issues: 0 },
      }),
      false,
    );
  });

  it('rejects missing health.score', () => {
    assert.equal(
      isReportShape({
        timestamp: '2026-01-01T00:00:00.000Z',
        health: { level: 'healthy' },
        totals: { annotations: 5, candidates: 0, issues: 0 },
      }),
      false,
    );
  });

  it('rejects invalid health.level', () => {
    assert.equal(
      isReportShape({
        timestamp: '2026-01-01T00:00:00.000Z',
        health: { level: 'excellent', score: 100 },
        totals: { annotations: 5, candidates: 0, issues: 0 },
      }),
      false,
    );
  });

  it('rejects NaN health.score', () => {
    assert.equal(
      isReportShape({
        timestamp: '2026-01-01T00:00:00.000Z',
        health: { level: 'healthy', score: NaN },
        totals: {
          annotations: 5,
          candidates: 0,
          issues: 0,
          registryEntries: 5,
          errors: 0,
          warnings: 0,
        },
      }),
      false,
    );
  });

  it('accepts all valid health levels', () => {
    for (const level of ['healthy', 'warning', 'critical']) {
      assert.equal(
        isReportShape({
          timestamp: '2026-01-01T00:00:00.000Z',
          health: { level, score: 80 },
          totals: {
            annotations: 5,
            candidates: 0,
            issues: 0,
            registryEntries: 5,
            errors: 0,
            warnings: 0,
          },
        }),
        true,
        `Expected level "${level}" to be valid`,
      );
    }
  });

  it('rejects missing totals', () => {
    assert.equal(
      isReportShape({
        timestamp: '2026-01-01T00:00:00.000Z',
        health: { level: 'healthy', score: 100 },
      }),
      false,
    );
  });

  it('rejects totals missing issues', () => {
    assert.equal(
      isReportShape({
        timestamp: '2026-01-01T00:00:00.000Z',
        health: { level: 'healthy', score: 100 },
        totals: { annotations: 5, candidates: 0 },
      }),
      false,
    );
  });

  it('rejects totals missing annotations', () => {
    assert.equal(
      isReportShape({
        timestamp: '2026-01-01T00:00:00.000Z',
        health: { level: 'healthy', score: 100 },
        totals: { candidates: 0, issues: 0 },
      }),
      false,
    );
  });

  it('rejects totals missing candidates', () => {
    assert.equal(
      isReportShape({
        timestamp: '2026-01-01T00:00:00.000Z',
        health: { level: 'healthy', score: 100 },
        totals: { annotations: 5, issues: 0 },
      }),
      false,
    );
  });

  it('rejects totals missing registryEntries', () => {
    assert.equal(
      isReportShape({
        timestamp: '2026-01-01T00:00:00.000Z',
        health: { level: 'healthy', score: 100 },
        totals: { annotations: 5, candidates: 0, issues: 0 },
      }),
      false,
    );
  });

  it('rejects totals missing errors', () => {
    assert.equal(
      isReportShape({
        timestamp: '2026-01-01T00:00:00.000Z',
        health: { level: 'healthy', score: 100 },
        totals: {
          annotations: 5,
          candidates: 0,
          issues: 0,
          registryEntries: 5,
          warnings: 0,
        },
      }),
      false,
    );
  });

  it('rejects totals missing warnings', () => {
    assert.equal(
      isReportShape({
        timestamp: '2026-01-01T00:00:00.000Z',
        health: { level: 'healthy', score: 100 },
        totals: {
          annotations: 5,
          candidates: 0,
          issues: 0,
          registryEntries: 5,
          errors: 0,
        },
      }),
      false,
    );
  });

  it('rejects empty object', () => {
    assert.equal(isReportShape({}), false);
  });

  // EP-0193: coverage/hygiene validation
  it('accepts report with coverage and hygiene', () => {
    assert.equal(
      isReportShape({
        timestamp: '2026-01-01T00:00:00.000Z',
        health: { level: 'healthy', score: 85, coverage: 100, hygiene: 85 },
        totals: {
          annotations: 5,
          candidates: 0,
          registryEntries: 5,
          issues: 0,
          errors: 0,
          warnings: 0,
        },
      }),
      true,
    );
  });

  it('accepts report without coverage and hygiene (backward compat)', () => {
    assert.equal(
      isReportShape({
        timestamp: '2026-01-01T00:00:00.000Z',
        health: { level: 'healthy', score: 100, summary: 'ok' },
        totals: {
          annotations: 5,
          candidates: 0,
          registryEntries: 5,
          issues: 0,
          errors: 0,
          warnings: 0,
        },
      }),
      true,
    );
  });

  it('rejects non-number coverage', () => {
    assert.equal(
      isReportShape({
        timestamp: '2026-01-01T00:00:00.000Z',
        health: { level: 'healthy', score: 85, coverage: 'high' },
        totals: {
          annotations: 5,
          candidates: 0,
          registryEntries: 5,
          issues: 0,
          errors: 0,
          warnings: 0,
        },
      }),
      false,
    );
  });

  it('rejects non-number hygiene', () => {
    assert.equal(
      isReportShape({
        timestamp: '2026-01-01T00:00:00.000Z',
        health: { level: 'healthy', score: 85, hygiene: 'good' },
        totals: {
          annotations: 5,
          candidates: 0,
          registryEntries: 5,
          issues: 0,
          errors: 0,
          warnings: 0,
        },
      }),
      false,
    );
  });

  it('rejects NaN coverage', () => {
    assert.equal(
      isReportShape({
        timestamp: '2026-01-01T00:00:00.000Z',
        health: { level: 'healthy', score: 85, coverage: NaN },
        totals: {
          annotations: 5,
          candidates: 0,
          registryEntries: 5,
          issues: 0,
          errors: 0,
          warnings: 0,
        },
      }),
      false,
    );
  });

  it('rejects NaN hygiene', () => {
    assert.equal(
      isReportShape({
        timestamp: '2026-01-01T00:00:00.000Z',
        health: { level: 'healthy', score: 85, hygiene: NaN },
        totals: {
          annotations: 5,
          candidates: 0,
          registryEntries: 5,
          issues: 0,
          errors: 0,
          warnings: 0,
        },
      }),
      false,
    );
  });
});
