import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  saveSnapshot,
  loadSnapshots,
  snapshotFilename,
} from '../src/core/snapshot.ts';
import type { ReportResult } from '../src/core/types.ts';

/**
 * Create a minimal ReportResult for testing.
 */
function createReportResult(overrides?: Partial<ReportResult>): ReportResult {
  return {
    timestamp: '2026-03-04T10:00:00.000Z',
    health: { level: 'healthy', score: 85, summary: 'Test summary' },
    totals: {
      annotations: 10,
      candidates: 2,
      registryEntries: 8,
      issues: 1,
      errors: 0,
      warnings: 1,
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
      'expiring-soon': 1,
    },
    byRule: [],
    byKind: [],
    byOwner: [],
    verifyResult: {
      timestamp: '2026-03-04T10:00:00.000Z',
      issues: [],
      summary: {
        total: 1,
        errors: 0,
        warnings: 1,
        byType: {
          'missing-in-registry': 0,
          'unused-in-source': 0,
          expired: 0,
          'syntax-error': 0,
          'ref-format': 0,
          'ref-collision': 0,
          'unrouted-ref': 0,
          'registry-routing-mismatch': 0,
          'expiring-soon': 1,
        },
      },
      scannedRecords: 10,
      registryEntries: 8,
    },
    ...overrides,
  };
}

describe('snapshotFilename', () => {
  it('replaces colons and dots with hyphens', () => {
    assert.equal(
      snapshotFilename('2026-03-04T10:00:00.000Z'),
      '2026-03-04T10-00-00-000Z.json',
    );
  });

  it('handles timestamps without special characters', () => {
    assert.equal(snapshotFilename('2026-03-04'), '2026-03-04.json');
  });
});

describe('saveSnapshot', () => {
  let tempDir: string;

  it('saves ReportResult JSON to the specified directory', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'shiori-snapshot-'));
    const report = createReportResult();
    const snapshotDir = join(tempDir, 'snapshots');

    const result = await saveSnapshot(report, snapshotDir, tempDir);

    assert.equal(result.ok, true);
    if (result.ok) {
      const content = await readFile(result.path, 'utf-8');
      const parsed = JSON.parse(content);
      assert.equal(parsed.timestamp, '2026-03-04T10:00:00.000Z');
      assert.equal(parsed.health.score, 85);
      // Trailing newline
      assert.ok(content.endsWith('\n'));
    }

    await rm(tempDir, { recursive: true, force: true });
  });

  it('creates nested directories as needed', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'shiori-snapshot-'));
    const report = createReportResult();
    const snapshotDir = join(tempDir, 'a', 'b', 'c');

    const result = await saveSnapshot(report, snapshotDir, tempDir);

    assert.equal(result.ok, true);
    if (result.ok) {
      const content = await readFile(result.path, 'utf-8');
      assert.ok(content.length > 0);
    }

    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns error for path outside cwd boundary', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'shiori-snapshot-'));
    const report = createReportResult();
    const outsideDir = join(tempDir, '..', '..', 'outside');

    const result = await saveSnapshot(report, outsideDir, tempDir);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.error.includes('outside the allowed boundary'));
    }

    await rm(tempDir, { recursive: true, force: true });
  });

  it('generates filename from timestamp', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'shiori-snapshot-'));
    const report = createReportResult({
      timestamp: '2026-01-15T08:30:45.123Z',
    });

    const result = await saveSnapshot(report, tempDir, tempDir);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(result.path.endsWith('2026-01-15T08-30-45-123Z.json'));
    }

    await rm(tempDir, { recursive: true, force: true });
  });
});

describe('loadSnapshots', () => {
  it('loads valid ReportResult JSON files from directory', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'shiori-snapshot-'));
    const report1 = createReportResult({
      timestamp: '2026-03-01T00:00:00.000Z',
    });
    const report2 = createReportResult({
      timestamp: '2026-03-02T00:00:00.000Z',
    });

    await writeFile(
      join(tempDir, 'snap1.json'),
      JSON.stringify(report1),
      'utf-8',
    );
    await writeFile(
      join(tempDir, 'snap2.json'),
      JSON.stringify(report2),
      'utf-8',
    );

    const result = await loadSnapshots(tempDir, tempDir);

    assert.ok(result !== null);
    assert.equal(result!.length, 2);

    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns null for empty directory', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'shiori-snapshot-'));

    const result = await loadSnapshots(tempDir, tempDir);

    assert.equal(result, null);

    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns null for nonexistent directory', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'shiori-snapshot-'));
    const nonExistent = join(tempDir, 'does-not-exist');

    const result = await loadSnapshots(nonExistent, tempDir);

    assert.equal(result, null);

    await rm(tempDir, { recursive: true, force: true });
  });

  it('skips invalid JSON files', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'shiori-snapshot-'));
    const validReport = createReportResult();

    await writeFile(
      join(tempDir, 'valid.json'),
      JSON.stringify(validReport),
      'utf-8',
    );
    await writeFile(join(tempDir, 'invalid.json'), 'not-json', 'utf-8');
    await writeFile(
      join(tempDir, 'wrong-shape.json'),
      JSON.stringify({ foo: 'bar' }),
      'utf-8',
    );

    const result = await loadSnapshots(tempDir, tempDir);

    assert.ok(result !== null);
    assert.equal(result!.length, 1);
    const first = result![0];
    assert.ok(first !== undefined);
    assert.equal(first.timestamp, validReport.timestamp);

    await rm(tempDir, { recursive: true, force: true });
  });
});
