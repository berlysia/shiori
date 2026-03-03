import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ReportResult, TrendResult } from '../src/core/types.ts';
import {
  extractTrendPoint,
  computeTrend,
  formatTrend,
  formatTrendAsMarkdown,
  formatTrendAsCsv,
} from '../src/commands/trend.ts';

function makeReportResult(overrides: {
  timestamp?: string;
  score?: number;
  level?: 'healthy' | 'warning' | 'critical';
  issues?: number;
  annotations?: number;
  candidates?: number;
  registryEntries?: number;
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
    },
    byRule: [],
    byKind: [],
    byOwner: [],
    verifyResult: {
      timestamp: overrides.timestamp ?? '2026-01-01T00:00:00.000Z',
      issues: [],
      summary: {
        total: overrides.issues ?? 0,
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
        },
      },
      scannedRecords: overrides.annotations ?? 5,
      registryEntries: overrides.registryEntries ?? 5,
    },
  };
}

describe('extractTrendPoint', () => {
  it('extracts all fields from ReportResult', () => {
    const report = makeReportResult({
      timestamp: '2026-01-15T10:00:00.000Z',
      score: 85,
      issues: 3,
      annotations: 10,
      candidates: 4,
      registryEntries: 8,
    });

    const point = extractTrendPoint(report);

    assert.equal(point.timestamp, '2026-01-15T10:00:00.000Z');
    assert.equal(point.score, 85);
    assert.equal(point.level, 'healthy');
    assert.equal(point.issues, 3);
    assert.equal(point.annotations, 10);
    assert.equal(point.candidates, 4);
    assert.equal(point.registryEntries, 8);
  });
});

describe('computeTrend', () => {
  it('returns empty result for empty input', () => {
    const result = computeTrend([]);

    assert.equal(result.points.length, 0);
    assert.equal(result.summary.count, 0);
    assert.equal(result.summary.oldest, '');
    assert.equal(result.summary.newest, '');
    assert.equal(result.summary.direction, 'stable');
  });

  it('handles single data point', () => {
    const reports = [
      makeReportResult({ timestamp: '2026-01-01T00:00:00.000Z', score: 90 }),
    ];

    const result = computeTrend(reports);

    assert.equal(result.points.length, 1);
    assert.equal(result.summary.count, 1);
    assert.equal(result.summary.latestScore, 90);
    assert.equal(result.summary.scoreChange, 0);
    assert.equal(result.summary.direction, 'stable');
    assert.equal(result.summary.minScore, 90);
    assert.equal(result.summary.maxScore, 90);
  });

  it('sorts by timestamp ascending', () => {
    const reports = [
      makeReportResult({ timestamp: '2026-03-01T00:00:00.000Z', score: 90 }),
      makeReportResult({ timestamp: '2026-01-01T00:00:00.000Z', score: 70 }),
      makeReportResult({ timestamp: '2026-02-01T00:00:00.000Z', score: 80 }),
    ];

    const result = computeTrend(reports);

    assert.equal(result.points.length, 3);
    assert.equal(result.points[0]!.timestamp, '2026-01-01T00:00:00.000Z');
    assert.equal(result.points[1]!.timestamp, '2026-02-01T00:00:00.000Z');
    assert.equal(result.points[2]!.timestamp, '2026-03-01T00:00:00.000Z');
  });

  it('detects improving trend', () => {
    const reports = [
      makeReportResult({ timestamp: '2026-01-01T00:00:00.000Z', score: 60 }),
      makeReportResult({ timestamp: '2026-02-01T00:00:00.000Z', score: 80 }),
      makeReportResult({ timestamp: '2026-03-01T00:00:00.000Z', score: 95 }),
    ];

    const result = computeTrend(reports);

    assert.equal(result.summary.direction, 'improving');
    assert.equal(result.summary.scoreChange, 35);
    assert.equal(result.summary.latestScore, 95);
  });

  it('detects declining trend', () => {
    const reports = [
      makeReportResult({ timestamp: '2026-01-01T00:00:00.000Z', score: 95 }),
      makeReportResult({ timestamp: '2026-02-01T00:00:00.000Z', score: 70 }),
      makeReportResult({ timestamp: '2026-03-01T00:00:00.000Z', score: 45 }),
    ];

    const result = computeTrend(reports);

    assert.equal(result.summary.direction, 'declining');
    assert.equal(result.summary.scoreChange, -50);
    assert.equal(result.summary.latestScore, 45);
  });

  it('detects stable trend', () => {
    const reports = [
      makeReportResult({ timestamp: '2026-01-01T00:00:00.000Z', score: 80 }),
      makeReportResult({ timestamp: '2026-02-01T00:00:00.000Z', score: 85 }),
      makeReportResult({ timestamp: '2026-03-01T00:00:00.000Z', score: 80 }),
    ];

    const result = computeTrend(reports);

    assert.equal(result.summary.direction, 'stable');
    assert.equal(result.summary.scoreChange, 0);
  });

  it('deduplicates by timestamp', () => {
    const reports = [
      makeReportResult({ timestamp: '2026-01-01T00:00:00.000Z', score: 80 }),
      makeReportResult({ timestamp: '2026-01-01T00:00:00.000Z', score: 85 }),
      makeReportResult({ timestamp: '2026-02-01T00:00:00.000Z', score: 90 }),
    ];

    const result = computeTrend(reports);

    assert.equal(result.points.length, 2);
    // First occurrence wins
    assert.equal(result.points[0]!.score, 80);
  });

  it('applies --last limit', () => {
    const reports = [
      makeReportResult({ timestamp: '2026-01-01T00:00:00.000Z', score: 60 }),
      makeReportResult({ timestamp: '2026-02-01T00:00:00.000Z', score: 70 }),
      makeReportResult({ timestamp: '2026-03-01T00:00:00.000Z', score: 80 }),
      makeReportResult({ timestamp: '2026-04-01T00:00:00.000Z', score: 90 }),
      makeReportResult({ timestamp: '2026-05-01T00:00:00.000Z', score: 95 }),
    ];

    const result = computeTrend(reports, { last: 3 });

    assert.equal(result.points.length, 3);
    assert.equal(result.points[0]!.timestamp, '2026-03-01T00:00:00.000Z');
    assert.equal(result.points[2]!.timestamp, '2026-05-01T00:00:00.000Z');
    assert.equal(result.summary.count, 3);
  });

  it('handles --last larger than data points', () => {
    const reports = [
      makeReportResult({ timestamp: '2026-01-01T00:00:00.000Z', score: 80 }),
      makeReportResult({ timestamp: '2026-02-01T00:00:00.000Z', score: 90 }),
    ];

    const result = computeTrend(reports, { last: 10 });

    assert.equal(result.points.length, 2);
  });

  it('computes min/max scores correctly', () => {
    const reports = [
      makeReportResult({ timestamp: '2026-01-01T00:00:00.000Z', score: 70 }),
      makeReportResult({ timestamp: '2026-02-01T00:00:00.000Z', score: 40 }),
      makeReportResult({ timestamp: '2026-03-01T00:00:00.000Z', score: 90 }),
      makeReportResult({ timestamp: '2026-04-01T00:00:00.000Z', score: 60 }),
    ];

    const result = computeTrend(reports);

    assert.equal(result.summary.minScore, 40);
    assert.equal(result.summary.maxScore, 90);
  });

  it('includes oldest and newest timestamps in summary', () => {
    const reports = [
      makeReportResult({ timestamp: '2026-03-01T00:00:00.000Z', score: 80 }),
      makeReportResult({ timestamp: '2026-01-01T00:00:00.000Z', score: 70 }),
    ];

    const result = computeTrend(reports);

    assert.equal(result.summary.oldest, '2026-01-01T00:00:00.000Z');
    assert.equal(result.summary.newest, '2026-03-01T00:00:00.000Z');
  });
});

describe('formatTrend', () => {
  function makeTrendResult(): TrendResult {
    return computeTrend([
      makeReportResult({
        timestamp: '2026-01-01T00:00:00.000Z',
        score: 70,
        issues: 5,
        annotations: 10,
        candidates: 3,
      }),
      makeReportResult({
        timestamp: '2026-02-01T00:00:00.000Z',
        score: 85,
        issues: 2,
        annotations: 12,
        candidates: 1,
      }),
    ]);
  }

  it('formats as JSON', () => {
    const result = makeTrendResult();
    const output = formatTrend(result, 'json');
    const parsed = JSON.parse(output) as TrendResult;

    assert.equal(parsed.points.length, 2);
    assert.equal(parsed.summary.direction, 'improving');
    assert.equal(parsed.summary.scoreChange, 15);
  });

  it('formats as Markdown', () => {
    const result = makeTrendResult();
    const output = formatTrend(result, 'markdown');

    assert.ok(output.includes('# Shiori Governance Trend'));
    assert.ok(output.includes('## Summary:'));
    assert.ok(output.includes('## Timeline'));
    assert.ok(output.includes('improving'));
    assert.ok(output.includes('📈'));
  });

  it('formats as CSV', () => {
    const result = makeTrendResult();
    const output = formatTrend(result, 'csv');
    const csvLines = output.split('\n');

    assert.equal(csvLines.length, 3); // header + 2 data rows
    assert.ok(csvLines[0]!.includes('timestamp,score,level'));
    assert.ok(csvLines[1]!.includes('2026-01-01'));
    assert.ok(csvLines[2]!.includes('2026-02-01'));
  });
});

describe('formatTrendAsMarkdown', () => {
  it('handles empty result', () => {
    const result = computeTrend([]);
    const md = formatTrendAsMarkdown(result);

    assert.ok(md.includes('# Shiori Governance Trend'));
    assert.ok(md.includes('No data points available.'));
  });

  it('shows declining emoji for declining trend', () => {
    const result = computeTrend([
      makeReportResult({ timestamp: '2026-01-01T00:00:00.000Z', score: 95 }),
      makeReportResult({ timestamp: '2026-02-01T00:00:00.000Z', score: 40 }),
    ]);
    const md = formatTrendAsMarkdown(result);

    assert.ok(md.includes('📉'));
    assert.ok(md.includes('declining'));
  });

  it('shows stable emoji for stable trend', () => {
    const result = computeTrend([
      makeReportResult({ timestamp: '2026-01-01T00:00:00.000Z', score: 80 }),
      makeReportResult({ timestamp: '2026-02-01T00:00:00.000Z', score: 80 }),
    ]);
    const md = formatTrendAsMarkdown(result);

    assert.ok(md.includes('➡️'));
    assert.ok(md.includes('stable'));
  });

  it('includes health level emoji in timeline', () => {
    const result = computeTrend([
      makeReportResult({ timestamp: '2026-01-01T00:00:00.000Z', score: 90 }),
      makeReportResult({
        timestamp: '2026-02-01T00:00:00.000Z',
        score: 60,
        level: 'warning',
      }),
      makeReportResult({
        timestamp: '2026-03-01T00:00:00.000Z',
        score: 30,
        level: 'critical',
      }),
    ]);
    const md = formatTrendAsMarkdown(result);

    assert.ok(md.includes('🟢'));
    assert.ok(md.includes('🟡'));
    assert.ok(md.includes('🔴'));
  });

  it('shows score change with sign', () => {
    const result = computeTrend([
      makeReportResult({ timestamp: '2026-01-01T00:00:00.000Z', score: 70 }),
      makeReportResult({ timestamp: '2026-02-01T00:00:00.000Z', score: 90 }),
    ]);
    const md = formatTrendAsMarkdown(result);

    assert.ok(md.includes('+20'));
  });
});

describe('formatTrendAsCsv', () => {
  it('includes all fields in CSV header', () => {
    const result = computeTrend([
      makeReportResult({ timestamp: '2026-01-01T00:00:00.000Z', score: 80 }),
    ]);
    const csv = formatTrendAsCsv(result);
    const header = csv.split('\n')[0]!;

    assert.equal(
      header,
      'timestamp,score,level,issues,annotations,candidates,registryEntries',
    );
  });

  it('outputs correct data rows', () => {
    const result = computeTrend([
      makeReportResult({
        timestamp: '2026-01-01T00:00:00.000Z',
        score: 80,
        issues: 3,
        annotations: 10,
        candidates: 2,
        registryEntries: 8,
      }),
    ]);
    const csv = formatTrendAsCsv(result);
    const dataRow = csv.split('\n')[1]!;

    assert.equal(dataRow, '2026-01-01T00:00:00.000Z,80,healthy,3,10,2,8');
  });

  it('handles empty result', () => {
    const result = computeTrend([]);
    const csv = formatTrendAsCsv(result);
    const lines = csv.split('\n');

    assert.equal(lines.length, 1); // header only
  });
});
