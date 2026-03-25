import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ReportResult } from '../src/core/types.ts';
import { computeSnapshotDiff } from '../src/core/diff-snapshots.ts';

function makeReportResult(overrides: {
  timestamp?: string;
  score?: number;
  level?: 'healthy' | 'warning' | 'critical';
  annotations?: number;
  candidates?: number;
  registryEntries?: number;
  issues?: number;
  errors?: number;
  warnings?: number;
}): ReportResult {
  const score = overrides.score ?? 100;
  const level =
    overrides.level ??
    (score >= 80 ? 'healthy' : score >= 50 ? 'warning' : 'critical');
  return {
    timestamp: overrides.timestamp ?? '2026-01-01T00:00:00.000Z',
    health: {
      level,
      score,
      summary: `Score: ${score}/100`,
    },
    totals: {
      annotations: overrides.annotations ?? 5,
      candidates: overrides.candidates ?? 2,
      registryEntries: overrides.registryEntries ?? 5,
      issues: overrides.issues ?? 0,
      errors: overrides.errors ?? 0,
      warnings: overrides.warnings ?? 0,
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
    },
    byRule: [],
    byKind: [],
    byOwner: [],
    verifyResult: {
      timestamp: overrides.timestamp ?? '2026-01-01T00:00:00.000Z',
      issues: [],
      summary: {
        total: overrides.issues ?? 0,
        errors: overrides.errors ?? 0,
        warnings: overrides.warnings ?? 0,
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
        },
      },
      scannedRecords: overrides.annotations ?? 5,
      registryEntries: overrides.registryEntries ?? 5,
    },
  };
}

describe('computeSnapshotDiff', () => {
  it('computes zero deltas for identical snapshots', () => {
    const base = makeReportResult({ timestamp: '2026-01-01T00:00:00.000Z' });
    const head = makeReportResult({ timestamp: '2026-01-02T00:00:00.000Z' });

    const diff = computeSnapshotDiff(base, head);

    assert.equal(diff.baseTimestamp, '2026-01-01T00:00:00.000Z');
    assert.equal(diff.headTimestamp, '2026-01-02T00:00:00.000Z');

    // All totals deltas should be 0
    const totalsCategories = diff.categories.filter(
      (c) => !c.category.startsWith('byType.'),
    );
    for (const cat of totalsCategories) {
      assert.equal(cat.delta, 0, `${cat.category} should have zero delta`);
    }

    // Health should be stable
    assert.equal(diff.health.direction, 'stable');
    assert.equal(diff.health.scoreDelta, 0);
  });

  it('detects increasing annotations', () => {
    const base = makeReportResult({
      timestamp: '2026-01-01T00:00:00.000Z',
      annotations: 5,
    });
    const head = makeReportResult({
      timestamp: '2026-01-02T00:00:00.000Z',
      annotations: 10,
    });

    const diff = computeSnapshotDiff(base, head);

    const annotationCat = diff.categories.find(
      (c) => c.category === 'annotations',
    );
    assert.ok(annotationCat);
    assert.equal(annotationCat.base, 5);
    assert.equal(annotationCat.head, 10);
    assert.equal(annotationCat.delta, 5);
  });

  it('detects decreasing issues', () => {
    const base = makeReportResult({
      timestamp: '2026-01-01T00:00:00.000Z',
      issues: 10,
    });
    const head = makeReportResult({
      timestamp: '2026-01-02T00:00:00.000Z',
      issues: 3,
    });

    const diff = computeSnapshotDiff(base, head);

    const issueCat = diff.categories.find((c) => c.category === 'issues');
    assert.ok(issueCat);
    assert.equal(issueCat.delta, -7);
  });

  it('computes health transition: improving', () => {
    const base = makeReportResult({
      score: 60,
      level: 'warning',
    });
    const head = makeReportResult({
      score: 90,
      level: 'healthy',
    });

    const diff = computeSnapshotDiff(base, head);

    assert.equal(diff.health.base, 'warning');
    assert.equal(diff.health.head, 'healthy');
    assert.equal(diff.health.baseScore, 60);
    assert.equal(diff.health.headScore, 90);
    assert.equal(diff.health.scoreDelta, 30);
    assert.equal(diff.health.direction, 'improving');
  });

  it('computes health transition: declining', () => {
    const base = makeReportResult({
      score: 90,
      level: 'healthy',
    });
    const head = makeReportResult({
      score: 40,
      level: 'critical',
    });

    const diff = computeSnapshotDiff(base, head);

    assert.equal(diff.health.direction, 'declining');
    assert.equal(diff.health.scoreDelta, -50);
    assert.equal(diff.health.base, 'healthy');
    assert.equal(diff.health.head, 'critical');
  });

  it('includes all totals categories', () => {
    const base = makeReportResult({});
    const head = makeReportResult({});

    const diff = computeSnapshotDiff(base, head);

    const totalsCategories = diff.categories
      .filter((c) => !c.category.startsWith('byType.'))
      .map((c) => c.category);

    assert.ok(totalsCategories.includes('annotations'));
    assert.ok(totalsCategories.includes('candidates'));
    assert.ok(totalsCategories.includes('registryEntries'));
    assert.ok(totalsCategories.includes('issues'));
    assert.ok(totalsCategories.includes('errors'));
    assert.ok(totalsCategories.includes('warnings'));
  });

  it('handles byType changes', () => {
    const base = makeReportResult({});
    const head = makeReportResult({});

    // Modify byType for head
    head.byType['expired'] = 3;

    const diff = computeSnapshotDiff(base, head);

    const expiredCat = diff.categories.find(
      (c) => c.category === 'byType.expired',
    );
    assert.ok(expiredCat);
    assert.equal(expiredCat.base, 0);
    assert.equal(expiredCat.head, 3);
    assert.equal(expiredCat.delta, 3);
  });
});
