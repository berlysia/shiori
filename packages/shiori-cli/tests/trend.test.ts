import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ReportResult, TrendResult } from '../src/core/types.ts';
import {
  extractTrendPoint,
  computeTrend,
  computeTrendFromPoints,
  formatTrend,
  formatTrendAsMarkdown,
  formatTrendAsCsv,
  formatTrendAsSpark,
  valueToBlock,
  buildSparkline,
  type TrendFormatOptions,
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
      coverage: 100,
      hygiene: score,
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
      'expiring-soon': 0,
      'ref-status-closed': 0,
      'intentional-without-reason': 0,
      'temporary-without-expires': 0,
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
          'expiring-soon': 0,
          'ref-status-closed': 0,
          'intentional-without-reason': 0,
          'temporary-without-expires': 0,
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
    assert.equal(point.coverage, 100);
    assert.equal(point.hygiene, 85);
  });

  it('omits coverage/hygiene when not present in report', () => {
    const report = makeReportResult({ score: 80 });
    // Simulate a pre-Phase-2 snapshot without dual-axis fields
    (report.health as Record<string, unknown>).coverage = undefined;
    (report.health as Record<string, unknown>).hygiene = undefined;
    const point = extractTrendPoint(report);

    assert.equal(point.coverage, undefined);
    assert.equal(point.hygiene, undefined);
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
    const envelope = JSON.parse(output);
    assert.ok(envelope.meta, 'should have meta envelope');
    assert.equal(envelope.meta.command, 'trend');
    assert.equal(envelope.meta.schemaVersion, 1);
    const parsed = envelope.data as TrendResult;

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
    assert.ok(csvLines[0]!.includes('timestamp,score,coverage,hygiene,level'));
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
  it('includes all fields in CSV header (with dual-axis)', () => {
    const result = computeTrend([
      makeReportResult({ timestamp: '2026-01-01T00:00:00.000Z', score: 80 }),
    ]);
    const csv = formatTrendAsCsv(result);
    const header = csv.split('\n')[0]!;

    assert.equal(
      header,
      'timestamp,score,coverage,hygiene,level,issues,annotations,candidates,registryEntries',
    );
  });

  it('outputs correct data rows (with dual-axis)', () => {
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

    assert.equal(
      dataRow,
      '2026-01-01T00:00:00.000Z,80,100,80,healthy,3,10,2,8',
    );
  });

  it('handles empty result', () => {
    const result = computeTrend([]);
    const csv = formatTrendAsCsv(result);
    const lines = csv.split('\n');

    assert.equal(lines.length, 1); // header only
  });
});

describe('valueToBlock', () => {
  it('returns middle block when min === max', () => {
    assert.equal(valueToBlock(50, 50, 50), '▆');
  });

  it('returns lowest block for min value', () => {
    assert.equal(valueToBlock(0, 0, 100), '▁');
  });

  it('returns highest block for max value', () => {
    assert.equal(valueToBlock(100, 0, 100), '█');
  });

  it('returns middle block for midpoint', () => {
    const block = valueToBlock(50, 0, 100);
    assert.ok(['▃', '▄', '▅'].includes(block));
  });
});

describe('buildSparkline', () => {
  it('returns empty string for empty array', () => {
    assert.equal(buildSparkline([]), '');
  });

  it('builds sparkline from values', () => {
    const spark = buildSparkline([0, 50, 100]);
    assert.equal(spark.length, 3);
    // First char should be lowest, last should be highest
    assert.equal(spark[0], '▁');
    assert.equal(spark[2], '█');
  });

  it('handles identical values', () => {
    const spark = buildSparkline([75, 75, 75]);
    assert.equal(spark, '▆▆▆');
  });
});

describe('formatTrendAsSpark', () => {
  it('handles empty result', () => {
    const result = computeTrend([]);
    const spark = formatTrendAsSpark(result);

    assert.equal(spark, 'No data points available.');
  });

  it('renders three series lines', () => {
    const result = computeTrend([
      makeReportResult({ timestamp: '2026-01-01T00:00:00.000Z', score: 80 }),
    ]);
    const spark = formatTrendAsSpark(result);
    const lines = spark.split('\n');

    assert.equal(lines.length, 5);
    assert.ok(lines[0]!.startsWith('Score:'));
    assert.ok(lines[1]!.startsWith('Issues:'));
    assert.ok(lines[2]!.startsWith('Untracked:'));
    assert.ok(lines[3]!.startsWith('Coverage:'));
    assert.ok(lines[4]!.startsWith('Hygiene:'));
  });

  it('renders single data point as middle block in score line', () => {
    const result = computeTrend([
      makeReportResult({ timestamp: '2026-01-01T00:00:00.000Z', score: 80 }),
    ]);
    const spark = formatTrendAsSpark(result);
    const scoreLine = spark.split('\n')[0]!;

    // Single point → min === max → middle block (▆)
    assert.ok(scoreLine.includes('▆'));
    assert.ok(scoreLine.includes('80/100'));
    assert.ok(scoreLine.includes('stable'));
    assert.ok(scoreLine.includes('1 pts'));
  });

  it('renders improving trend with ascending blocks in score line', () => {
    const result = computeTrend([
      makeReportResult({ timestamp: '2026-01-01T00:00:00.000Z', score: 0 }),
      makeReportResult({ timestamp: '2026-02-01T00:00:00.000Z', score: 50 }),
      makeReportResult({ timestamp: '2026-03-01T00:00:00.000Z', score: 100 }),
    ]);
    const spark = formatTrendAsSpark(result);
    const scoreLine = spark.split('\n')[0]!;

    assert.ok(scoreLine.includes('▁'));
    assert.ok(scoreLine.includes('📈'));
    assert.ok(scoreLine.includes('improving'));
    assert.ok(scoreLine.includes('+100'));
  });

  it('renders declining trend with descending blocks', () => {
    const result = computeTrend([
      makeReportResult({ timestamp: '2026-01-01T00:00:00.000Z', score: 100 }),
      makeReportResult({ timestamp: '2026-02-01T00:00:00.000Z', score: 50 }),
      makeReportResult({ timestamp: '2026-03-01T00:00:00.000Z', score: 0 }),
    ]);
    const spark = formatTrendAsSpark(result);
    const scoreLine = spark.split('\n')[0]!;

    assert.ok(scoreLine.includes('█'));
    assert.ok(scoreLine.includes('📉'));
    assert.ok(scoreLine.includes('declining'));
    assert.ok(scoreLine.includes('-100'));
  });

  it('renders flat line with identical blocks', () => {
    const result = computeTrend([
      makeReportResult({ timestamp: '2026-01-01T00:00:00.000Z', score: 75 }),
      makeReportResult({ timestamp: '2026-02-01T00:00:00.000Z', score: 75 }),
      makeReportResult({ timestamp: '2026-03-01T00:00:00.000Z', score: 75 }),
    ]);
    const spark = formatTrendAsSpark(result);
    const scoreLine = spark.split('\n')[0]!;

    assert.ok(scoreLine.includes('▆▆▆'));
    assert.ok(scoreLine.includes('stable'));
  });

  it('includes score change with sign and point count', () => {
    const result = computeTrend([
      makeReportResult({ timestamp: '2026-01-01T00:00:00.000Z', score: 60 }),
      makeReportResult({ timestamp: '2026-02-01T00:00:00.000Z', score: 85 }),
    ]);
    const spark = formatTrendAsSpark(result);

    assert.ok(spark.includes('85/100'));
    assert.ok(spark.includes('+25'));
    assert.ok(spark.includes('2 pts'));
  });

  it('shows issue count in issues line', () => {
    const result = computeTrend([
      makeReportResult({
        timestamp: '2026-01-01T00:00:00.000Z',
        score: 70,
        issues: 5,
      }),
      makeReportResult({
        timestamp: '2026-02-01T00:00:00.000Z',
        score: 85,
        issues: 2,
      }),
    ]);
    const spark = formatTrendAsSpark(result);
    const issuesLine = spark.split('\n')[1]!;

    assert.ok(issuesLine.startsWith('Issues:'));
    // Latest issue count
    assert.ok(issuesLine.includes('2'));
  });

  it('shows untracked ratio in untracked line', () => {
    const result = computeTrend([
      makeReportResult({
        timestamp: '2026-01-01T00:00:00.000Z',
        score: 70,
        annotations: 8,
        candidates: 2,
      }),
      makeReportResult({
        timestamp: '2026-02-01T00:00:00.000Z',
        score: 85,
        annotations: 10,
        candidates: 0,
      }),
    ]);
    const spark = formatTrendAsSpark(result);
    const untrackedLine = spark.split('\n')[2]!;

    assert.ok(untrackedLine.startsWith('Untracked:'));
    // Latest untracked = 0/(10+0) = 0%
    assert.ok(untrackedLine.includes('0%'));
  });

  it('computes untracked ratio correctly with candidates', () => {
    const result = computeTrend([
      makeReportResult({
        timestamp: '2026-01-01T00:00:00.000Z',
        score: 70,
        annotations: 6,
        candidates: 4,
      }),
    ]);
    const spark = formatTrendAsSpark(result);
    const untrackedLine = spark.split('\n')[2]!;

    // 4/(6+4) = 40%
    assert.ok(untrackedLine.includes('40%'));
  });

  it('is routed by formatTrend with spark format', () => {
    const result = computeTrend([
      makeReportResult({ timestamp: '2026-01-01T00:00:00.000Z', score: 70 }),
      makeReportResult({ timestamp: '2026-02-01T00:00:00.000Z', score: 85 }),
    ]);
    const viaSpark = formatTrendAsSpark(result);
    const viaRouter = formatTrend(result, 'spark');

    assert.equal(viaRouter, viaSpark);
  });
});

describe('computeTrendFromPoints', () => {
  it('returns empty result for empty input', () => {
    const result = computeTrendFromPoints([]);

    assert.equal(result.points.length, 0);
    assert.equal(result.summary.count, 0);
    assert.equal(result.summary.direction, 'stable');
  });

  it('works with pre-extracted TrendPoints', () => {
    const points = [
      {
        timestamp: '2026-02-01T00:00:00.000Z',
        score: 90,
        level: 'healthy' as const,
        issues: 1,
        annotations: 10,
        candidates: 2,
        registryEntries: 8,
      },
      {
        timestamp: '2026-01-01T00:00:00.000Z',
        score: 70,
        level: 'warning' as const,
        issues: 5,
        annotations: 8,
        candidates: 4,
        registryEntries: 6,
      },
    ];

    const result = computeTrendFromPoints(points);

    assert.equal(result.points.length, 2);
    // Sorted oldest first
    assert.equal(result.points[0]!.timestamp, '2026-01-01T00:00:00.000Z');
    assert.equal(result.points[1]!.timestamp, '2026-02-01T00:00:00.000Z');
    assert.equal(result.summary.direction, 'improving');
    assert.equal(result.summary.scoreChange, 20);
  });

  it('produces same result as computeTrend for equivalent input', () => {
    const reports = [
      makeReportResult({ timestamp: '2026-01-01T00:00:00.000Z', score: 60 }),
      makeReportResult({ timestamp: '2026-02-01T00:00:00.000Z', score: 80 }),
    ];

    const viaTrend = computeTrend(reports);
    const points = reports.map(extractTrendPoint);
    const viaFromPoints = computeTrendFromPoints(points);

    assert.deepEqual(viaTrend, viaFromPoints);
  });

  it('does not mutate input array', () => {
    const points = [
      {
        timestamp: '2026-02-01T00:00:00.000Z',
        score: 90,
        level: 'healthy' as const,
        issues: 0,
        annotations: 5,
        candidates: 1,
        registryEntries: 4,
      },
      {
        timestamp: '2026-01-01T00:00:00.000Z',
        score: 70,
        level: 'warning' as const,
        issues: 3,
        annotations: 5,
        candidates: 2,
        registryEntries: 4,
      },
    ];

    const original = [...points];
    computeTrendFromPoints(points);

    // Input array order should not be changed
    assert.equal(points[0]!.timestamp, original[0]!.timestamp);
    assert.equal(points[1]!.timestamp, original[1]!.timestamp);
  });
});

// ── --axis filter tests (ADR 024 Phase 2) ─────────────────────

describe('axis filter: formatTrendAsSpark', () => {
  function makeDualAxisResult(): TrendResult {
    return computeTrend([
      makeReportResult({ timestamp: '2026-01-01T00:00:00.000Z', score: 70 }),
      makeReportResult({ timestamp: '2026-02-01T00:00:00.000Z', score: 85 }),
    ]);
  }

  it('shows all series when axis is undefined', () => {
    const result = makeDualAxisResult();
    const spark = formatTrendAsSpark(result);
    const lines = spark.split('\n');

    assert.equal(lines.length, 5);
    assert.ok(lines[0]!.startsWith('Score:'));
    assert.ok(lines[1]!.startsWith('Issues:'));
    assert.ok(lines[2]!.startsWith('Untracked:'));
    assert.ok(lines[3]!.startsWith('Coverage:'));
    assert.ok(lines[4]!.startsWith('Hygiene:'));
  });

  it('shows only score series when axis=score', () => {
    const result = makeDualAxisResult();
    const spark = formatTrendAsSpark(result, { axis: 'score' });
    const lines = spark.split('\n');

    assert.equal(lines.length, 3);
    assert.ok(lines[0]!.startsWith('Score:'));
    assert.ok(lines[1]!.startsWith('Issues:'));
    assert.ok(lines[2]!.startsWith('Untracked:'));
  });

  it('shows only coverage series when axis=coverage', () => {
    const result = makeDualAxisResult();
    const spark = formatTrendAsSpark(result, { axis: 'coverage' });
    const lines = spark.split('\n');

    assert.equal(lines.length, 1);
    assert.ok(lines[0]!.startsWith('Coverage:'));
  });

  it('shows only hygiene series when axis=hygiene', () => {
    const result = makeDualAxisResult();
    const spark = formatTrendAsSpark(result, { axis: 'hygiene' });
    const lines = spark.split('\n');

    assert.equal(lines.length, 1);
    assert.ok(lines[0]!.startsWith('Hygiene:'));
  });
});

describe('axis filter: formatTrendAsCsv', () => {
  function makeDualAxisResult(): TrendResult {
    return computeTrend([
      makeReportResult({
        timestamp: '2026-01-01T00:00:00.000Z',
        score: 80,
        issues: 3,
        annotations: 10,
        candidates: 2,
        registryEntries: 8,
      }),
    ]);
  }

  it('includes all columns when axis is undefined', () => {
    const result = makeDualAxisResult();
    const csv = formatTrendAsCsv(result);
    const header = csv.split('\n')[0]!;

    assert.equal(
      header,
      'timestamp,score,coverage,hygiene,level,issues,annotations,candidates,registryEntries',
    );
  });

  it('excludes coverage/hygiene columns when axis=score', () => {
    const result = makeDualAxisResult();
    const csv = formatTrendAsCsv(result, { axis: 'score' });
    const header = csv.split('\n')[0]!;

    assert.equal(
      header,
      'timestamp,score,level,issues,annotations,candidates,registryEntries',
    );
    assert.ok(!header.includes('coverage'));
    assert.ok(!header.includes('hygiene'));
  });

  it('shows only coverage column when axis=coverage', () => {
    const result = makeDualAxisResult();
    const csv = formatTrendAsCsv(result, { axis: 'coverage' });
    const header = csv.split('\n')[0]!;

    assert.equal(
      header,
      'timestamp,coverage,level,issues,annotations,candidates,registryEntries',
    );
    assert.ok(!header.includes(',score,'));
    assert.ok(!header.includes('hygiene'));
  });

  it('shows only hygiene column when axis=hygiene', () => {
    const result = makeDualAxisResult();
    const csv = formatTrendAsCsv(result, { axis: 'hygiene' });
    const header = csv.split('\n')[0]!;

    assert.equal(
      header,
      'timestamp,hygiene,level,issues,annotations,candidates,registryEntries',
    );
    assert.ok(!header.includes(',score,'));
    assert.ok(!header.includes('coverage'));
  });

  it('includes correct data values for axis=coverage', () => {
    const result = makeDualAxisResult();
    const csv = formatTrendAsCsv(result, { axis: 'coverage' });
    const dataRow = csv.split('\n')[1]!;

    // coverage=100 for this test data
    assert.equal(dataRow, '2026-01-01T00:00:00.000Z,100,healthy,3,10,2,8');
  });
});

describe('axis filter: formatTrendAsMarkdown', () => {
  function makeDualAxisResult(): TrendResult {
    return computeTrend([
      makeReportResult({ timestamp: '2026-01-01T00:00:00.000Z', score: 80 }),
    ]);
  }

  it('shows all columns when axis is undefined', () => {
    const result = makeDualAxisResult();
    const md = formatTrendAsMarkdown(result);

    assert.ok(md.includes('Score'));
    assert.ok(md.includes('Coverage'));
    assert.ok(md.includes('Hygiene'));
  });

  it('hides dual-axis columns when axis=score', () => {
    const result = makeDualAxisResult();
    const md = formatTrendAsMarkdown(result, { axis: 'score' });

    assert.ok(md.includes('Score'));
    assert.ok(!md.includes('Coverage'));
    assert.ok(!md.includes('Hygiene'));
  });

  it('shows only coverage column when axis=coverage', () => {
    const result = makeDualAxisResult();
    const md = formatTrendAsMarkdown(result, { axis: 'coverage' });
    const timelineSection = md.split('## Timeline')[1]!;

    assert.ok(timelineSection.includes('Coverage'));
    assert.ok(!timelineSection.includes('Hygiene'));
    // Score column should be hidden in Timeline when filtering to coverage
    assert.ok(!timelineSection.includes('| Score'));
  });

  it('shows only hygiene column when axis=hygiene', () => {
    const result = makeDualAxisResult();
    const md = formatTrendAsMarkdown(result, { axis: 'hygiene' });
    const timelineSection = md.split('## Timeline')[1]!;

    assert.ok(timelineSection.includes('Hygiene'));
    assert.ok(!timelineSection.includes('Coverage'));
    assert.ok(!timelineSection.includes('| Score'));
  });
});

describe('axis filter: formatTrend router', () => {
  it('passes axis to spark formatter', () => {
    const result = computeTrend([
      makeReportResult({ timestamp: '2026-01-01T00:00:00.000Z', score: 80 }),
    ]);
    const viaDirect = formatTrendAsSpark(result, { axis: 'coverage' });
    const viaRouter = formatTrend(result, 'spark', { axis: 'coverage' });

    assert.equal(viaRouter, viaDirect);
  });

  it('passes axis to csv formatter', () => {
    const result = computeTrend([
      makeReportResult({ timestamp: '2026-01-01T00:00:00.000Z', score: 80 }),
    ]);
    const viaDirect = formatTrendAsCsv(result, { axis: 'hygiene' });
    const viaRouter = formatTrend(result, 'csv', { axis: 'hygiene' });

    assert.equal(viaRouter, viaDirect);
  });

  it('passes axis to markdown formatter', () => {
    const result = computeTrend([
      makeReportResult({ timestamp: '2026-01-01T00:00:00.000Z', score: 80 }),
    ]);
    const viaDirect = formatTrendAsMarkdown(result, { axis: 'score' });
    const viaRouter = formatTrend(result, 'markdown', { axis: 'score' });

    assert.equal(viaRouter, viaDirect);
  });

  it('ignores axis for json format (full data always)', () => {
    const result = computeTrend([
      makeReportResult({ timestamp: '2026-01-01T00:00:00.000Z', score: 80 }),
    ]);
    const withAxis = formatTrend(result, 'json', { axis: 'coverage' });
    const withoutAxis = formatTrend(result, 'json');

    // JSON always outputs the full TrendResult regardless of axis
    assert.equal(withAxis, withoutAxis);
  });
});
