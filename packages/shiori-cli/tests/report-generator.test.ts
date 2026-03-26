import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  CliJournalEntry,
  ReportResult,
  JournalVelocityResult,
  Registry,
  CollectedReportData,
  AnalyzedReportMetrics,
} from '../src/core/types.ts';
import {
  resolvePresetPeriod,
  filterJournalByPeriod,
  collectReportData,
  computeActivitySummary,
  analyzeReportData,
} from '../src/core/report-generator.ts';
import {
  formatWeeklyReportAsMarkdown,
  formatWeeklyReportAsHtml,
  formatWeeklyReport,
} from '../src/formatters/weekly-report-formatter.ts';

// ── Test helpers ─────────────────────────────────────────────

function makeEntry(overrides?: Partial<CliJournalEntry>): CliJournalEntry {
  return {
    timestamp: '2026-03-18T12:00:00.000Z',
    source: 'cli',
    event_type: 'cli.resolve',
    refs: ['SUP-1234'],
    success: true,
    entries_added: null,
    entries_removed: 1,
    ...overrides,
  };
}

function makeReportResult(overrides?: Partial<ReportResult>): ReportResult {
  return {
    timestamp: '2026-03-18T12:00:00.000Z',
    health: { level: 'healthy', score: 85, summary: 'All good' },
    totals: {
      annotations: 10,
      candidates: 2,
      registryEntries: 8,
      issues: 1,
      errors: 0,
      warnings: 1,
    },
    insights: [
      {
        level: 'info',
        label: 'clean',
        message: 'No major issues.',
      },
    ],
    byType: {
      expired: 0,
      'missing-in-registry': 0,
      'unused-in-source': 0,
      'syntax-error': 0,
      'ref-format': 0,
      'ref-collision': 0,
      'unrouted-ref': 0,
      'registry-routing-mismatch': 0,
      'expiring-soon': 1,
      'ref-status-closed': 0,
      'intentional-without-reason': 0,
      'temporary-without-expires': 0,
    },
    byRule: [],
    byKind: [],
    byOwner: [],
    verifyResult: {
      timestamp: '2026-03-18T12:00:00.000Z',
      issues: [],
      summary: {
        total: 1,
        errors: 0,
        warnings: 1,
        byType: {
          expired: 0,
          'missing-in-registry': 0,
          'unused-in-source': 0,
          'syntax-error': 0,
          'ref-format': 0,
          'ref-collision': 0,
          'unrouted-ref': 0,
          'registry-routing-mismatch': 0,
          'expiring-soon': 1,
          'ref-status-closed': 0,
          'intentional-without-reason': 0,
          'temporary-without-expires': 0,
        },
      },
      scannedRecords: 10,
      registryEntries: 8,
    },
    ...overrides,
  };
}

function makeVelocity(
  overrides?: Partial<JournalVelocityResult>,
): JournalVelocityResult {
  return {
    points: [],
    summary: {
      count: 0,
      oldest: '',
      newest: '',
      totalOperations: 0,
      successRate: 0,
      totalNetChange: 0,
      direction: 'neutral',
    },
    ...overrides,
  };
}

// ── resolvePresetPeriod ──────────────────────────────────────

describe('resolvePresetPeriod', () => {
  it('weekly preset defaults to past 7 days', () => {
    const result = resolvePresetPeriod('weekly');
    const today = new Date().toISOString().slice(0, 10);
    assert.equal(result.until, today);
    // since should be 7 days before until
    const sinceDate = new Date(result.since);
    const untilDate = new Date(result.until);
    const diffDays = Math.round(
      (untilDate.getTime() - sinceDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    assert.equal(diffDays, 7);
  });

  it('health preset uses wide range by default', () => {
    const result = resolvePresetPeriod('health');
    assert.equal(result.since, '1970-01-01');
  });

  it('custom preset defaults to past 30 days', () => {
    const result = resolvePresetPeriod('custom');
    const today = new Date().toISOString().slice(0, 10);
    assert.equal(result.until, today);
    const sinceDate = new Date(result.since);
    const untilDate = new Date(result.until);
    const diffDays = Math.round(
      (untilDate.getTime() - sinceDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    assert.equal(diffDays, 30);
  });

  it('respects explicit since/until', () => {
    const result = resolvePresetPeriod('weekly', '2026-01-01', '2026-01-07');
    assert.equal(result.since, '2026-01-01');
    assert.equal(result.until, '2026-01-07');
  });
});

// ── filterJournalByPeriod ────────────────────────────────────

describe('filterJournalByPeriod', () => {
  it('filters entries within range', () => {
    const entries = [
      makeEntry({ timestamp: '2026-03-10T12:00:00.000Z' }),
      makeEntry({ timestamp: '2026-03-15T12:00:00.000Z' }),
      makeEntry({ timestamp: '2026-03-18T12:00:00.000Z' }),
      makeEntry({ timestamp: '2026-03-20T12:00:00.000Z' }),
    ];
    const result = filterJournalByPeriod(entries, '2026-03-15', '2026-03-18');
    assert.equal(result.length, 2);
    assert.equal(result[0]!.timestamp, '2026-03-15T12:00:00.000Z');
    assert.equal(result[1]!.timestamp, '2026-03-18T12:00:00.000Z');
  });

  it('returns empty for no matches', () => {
    const entries = [makeEntry({ timestamp: '2026-01-01T12:00:00.000Z' })];
    const result = filterJournalByPeriod(entries, '2026-03-01', '2026-03-31');
    assert.equal(result.length, 0);
  });

  it('handles empty input', () => {
    const result = filterJournalByPeriod([], '2026-01-01', '2026-12-31');
    assert.equal(result.length, 0);
  });
});

// ── collectReportData ────────────────────────────────────────

describe('collectReportData', () => {
  it('assembles data with filtered journal entries', () => {
    const entries = [
      makeEntry({ timestamp: '2026-03-10T12:00:00.000Z' }),
      makeEntry({ timestamp: '2026-03-15T12:00:00.000Z' }),
    ];
    const registry: Registry = {};
    const reportResult = makeReportResult();
    const velocity = makeVelocity();

    const result = collectReportData({
      journalEntries: entries,
      registry,
      reportResult,
      velocity,
      preset: 'weekly',
      since: '2026-03-14',
      until: '2026-03-18',
    });

    // Only the entry within range should be included
    assert.equal(result.journalEntries.length, 1);
    assert.equal(result.period.since, '2026-03-14');
    assert.equal(result.period.until, '2026-03-18');
    assert.equal(result.reportResult, reportResult);
  });
});

// ── computeActivitySummary ───────────────────────────────────

describe('computeActivitySummary', () => {
  it('computes summary from entries', () => {
    const entries = [
      makeEntry({
        event_type: 'cli.resolve',
        refs: ['SUP-1'],
        success: true,
        entries_removed: 1,
        entries_added: 0,
      }),
      makeEntry({
        event_type: 'cli.adopt',
        refs: ['SUP-2', 'SUP-3'],
        success: true,
        entries_added: 2,
        entries_removed: null,
      }),
      makeEntry({
        event_type: 'cli.resolve',
        refs: ['SUP-4'],
        success: false,
        entries_added: null,
        entries_removed: null,
      }),
    ];

    const summary = computeActivitySummary(entries);

    assert.equal(summary.totalOperations, 3);
    assert.equal(summary.successfulOperations, 2);
    assert.equal(summary.failedOperations, 1);
    assert.equal(summary.successRate, 67);
    assert.equal(summary.netChange, 1); // 2 added - 1 removed
    assert.deepEqual(summary.uniqueRefs, ['SUP-1', 'SUP-2', 'SUP-3', 'SUP-4']);
    assert.equal(summary.byEventType['cli.resolve'], 2);
    assert.equal(summary.byEventType['cli.adopt'], 1);
  });

  it('handles empty entries', () => {
    const summary = computeActivitySummary([]);
    assert.equal(summary.totalOperations, 0);
    assert.equal(summary.successRate, 0);
    assert.deepEqual(summary.uniqueRefs, []);
  });
});

// ── analyzeReportData ────────────────────────────────────────

describe('analyzeReportData', () => {
  it('produces metrics from collected data', () => {
    const data: CollectedReportData = {
      journalEntries: [
        makeEntry({ refs: ['SUP-1'], entries_added: 1, entries_removed: null }),
      ],
      registry: {
        'SUP-1': {
          reason: 'test',
          target: 'src/foo.ts:1',
          expires: undefined,
          ticket: undefined,
          owner: undefined,
          notes: undefined,
          kind: 'intentional',
        },
      },
      reportResult: makeReportResult(),
      velocity: makeVelocity(),
      period: { since: '2026-03-11', until: '2026-03-18' },
    };

    const metrics = analyzeReportData(data);

    assert.equal(metrics.activity.totalOperations, 1);
    assert.equal(metrics.health.score, 85);
    assert.equal(metrics.health.level, 'healthy');
    assert.equal(metrics.registryOverview.totalAnnotations, 10);
    assert.equal(metrics.registryOverview.totalIssues, 1);
    assert.equal(metrics.period.since, '2026-03-11');
    assert.ok(metrics.timestamp);
  });
});

// ── formatWeeklyReportAsMarkdown ─────────────────────────────

describe('formatWeeklyReportAsMarkdown', () => {
  function makeMetrics(
    overrides?: Partial<AnalyzedReportMetrics>,
  ): AnalyzedReportMetrics {
    return {
      timestamp: '2026-03-18T12:00:00.000Z',
      period: { since: '2026-03-11', until: '2026-03-18' },
      activity: {
        totalOperations: 5,
        successfulOperations: 4,
        failedOperations: 1,
        successRate: 80,
        netChange: 3,
        uniqueRefs: ['SUP-1', 'SUP-2'],
        byEventType: { 'cli.resolve': 3, 'cli.adopt': 2 },
      },
      health: { level: 'healthy', score: 90, summary: 'All clear' },
      registryOverview: {
        totalEntries: 10,
        totalAnnotations: 8,
        totalCandidates: 2,
        totalIssues: 0,
      },
      insights: [
        { level: 'info', label: 'clean', message: 'No issues found.' },
      ],
      velocity: {
        count: 3,
        oldest: '2026-03-11T00:00:00.000Z',
        newest: '2026-03-18T00:00:00.000Z',
        totalOperations: 5,
        successRate: 80,
        totalNetChange: 3,
        direction: 'growing',
      },
      ...overrides,
    };
  }

  it('generates weekly report with all sections', () => {
    const md = formatWeeklyReportAsMarkdown(makeMetrics(), 'weekly');

    assert.ok(md.includes('# Shiori Weekly Report'));
    assert.ok(md.includes('**Period:** 2026-03-11 → 2026-03-18'));
    assert.ok(md.includes('90/100'));
    assert.ok(md.includes('## Registry Overview'));
    assert.ok(md.includes('## Activity Summary'));
    assert.ok(md.includes('## Velocity'));
    assert.ok(md.includes('## Insights'));
    assert.ok(md.includes('cli.resolve'));
    assert.ok(md.includes('cli.adopt'));
  });

  it('uses correct preset label for health', () => {
    const md = formatWeeklyReportAsMarkdown(makeMetrics(), 'health');
    assert.ok(md.includes('# Shiori Health Report'));
  });

  it('uses correct preset label for custom', () => {
    const md = formatWeeklyReportAsMarkdown(makeMetrics(), 'custom');
    assert.ok(md.includes('# Shiori Custom Report'));
  });

  it('skips activity section for health preset with no operations', () => {
    const metrics = makeMetrics({
      activity: {
        totalOperations: 0,
        successfulOperations: 0,
        failedOperations: 0,
        successRate: 0,
        netChange: 0,
        uniqueRefs: [],
        byEventType: {},
      },
    });
    const md = formatWeeklyReportAsMarkdown(metrics, 'health');
    assert.ok(!md.includes('## Activity Summary'));
  });

  it('skips velocity section when no data', () => {
    const metrics = makeMetrics({
      velocity: {
        count: 0,
        oldest: '',
        newest: '',
        totalOperations: 0,
        successRate: 0,
        totalNetChange: 0,
        direction: 'neutral',
      },
    });
    const md = formatWeeklyReportAsMarkdown(metrics, 'weekly');
    assert.ok(!md.includes('## Velocity'));
  });

  it('shows trend sparkline when trend data has 2+ snapshots (EP-0144)', () => {
    const metrics = makeMetrics({
      trend: {
        count: 5,
        oldest: '2026-02-18T00:00:00.000Z',
        newest: '2026-03-18T00:00:00.000Z',
        latestScore: 90,
        scoreChange: 15,
        direction: 'improving',
        minScore: 60,
        maxScore: 90,
      },
    });
    const md = formatWeeklyReportAsMarkdown(metrics, 'weekly');
    assert.ok(md.includes('## Score Trend'));
    assert.ok(md.includes('90/100'));
    assert.ok(md.includes('improving'));
    assert.ok(md.includes('+15'));
    assert.ok(md.includes('5 snapshots'));
  });

  it('omits trend section when trend is undefined', () => {
    const metrics = makeMetrics({ trend: undefined });
    const md = formatWeeklyReportAsMarkdown(metrics, 'weekly');
    assert.ok(!md.includes('## Score Trend'));
  });

  it('omits trend section when only 1 snapshot', () => {
    const metrics = makeMetrics({
      trend: {
        count: 1,
        oldest: '2026-03-18T00:00:00.000Z',
        newest: '2026-03-18T00:00:00.000Z',
        latestScore: 85,
        scoreChange: 0,
        direction: 'stable',
        minScore: 85,
        maxScore: 85,
      },
    });
    const md = formatWeeklyReportAsMarkdown(metrics, 'weekly');
    assert.ok(!md.includes('## Score Trend'));
  });
});

// ── formatWeeklyReportAsHtml ─────────────────────────────────

describe('formatWeeklyReportAsHtml', () => {
  function makeMetrics(): AnalyzedReportMetrics {
    return {
      timestamp: '2026-03-18T12:00:00.000Z',
      period: { since: '2026-03-11', until: '2026-03-18' },
      activity: {
        totalOperations: 3,
        successfulOperations: 3,
        failedOperations: 0,
        successRate: 100,
        netChange: 2,
        uniqueRefs: ['SUP-1'],
        byEventType: { 'cli.resolve': 3 },
      },
      health: { level: 'healthy', score: 95, summary: 'Excellent' },
      registryOverview: {
        totalEntries: 5,
        totalAnnotations: 4,
        totalCandidates: 1,
        totalIssues: 0,
      },
      insights: [],
      velocity: {
        count: 0,
        oldest: '',
        newest: '',
        totalOperations: 0,
        successRate: 0,
        totalNetChange: 0,
        direction: 'neutral',
      },
    };
  }

  it('generates valid HTML document', () => {
    const html = formatWeeklyReportAsHtml(makeMetrics(), 'weekly');
    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('<title>Shiori Weekly Report</title>'));
    assert.ok(html.includes('95/100'));
    assert.ok(html.includes('Governance Health'));
  });

  it('escapes HTML entities in content', () => {
    const metrics = makeMetrics();
    metrics.health.summary = 'Score <80 means "warning"';
    const html = formatWeeklyReportAsHtml(metrics, 'weekly');
    assert.ok(html.includes('&lt;80'));
    assert.ok(html.includes('&quot;warning&quot;'));
  });

  it('uses correct health color for warning', () => {
    const metrics = makeMetrics();
    metrics.health.level = 'warning';
    const html = formatWeeklyReportAsHtml(metrics, 'weekly');
    assert.ok(html.includes('#eab308'));
  });

  it('uses correct health color for critical', () => {
    const metrics = makeMetrics();
    metrics.health.level = 'critical';
    const html = formatWeeklyReportAsHtml(metrics, 'weekly');
    assert.ok(html.includes('#ef4444'));
  });

  it('shows trend section in HTML when trend data has 2+ snapshots (EP-0144)', () => {
    const metrics = makeMetrics();
    metrics.trend = {
      count: 3,
      oldest: '2026-02-18T00:00:00.000Z',
      newest: '2026-03-18T00:00:00.000Z',
      latestScore: 95,
      scoreChange: 10,
      direction: 'improving',
      minScore: 70,
      maxScore: 95,
    };
    const html = formatWeeklyReportAsHtml(metrics, 'weekly');
    assert.ok(html.includes('Score Trend'));
    assert.ok(html.includes('95/100'));
    assert.ok(html.includes('improving'));
    assert.ok(html.includes('3 snapshots'));
  });

  it('omits trend section in HTML when trend is undefined', () => {
    const html = formatWeeklyReportAsHtml(makeMetrics(), 'weekly');
    assert.ok(!html.includes('Score Trend'));
  });
});

// ── formatWeeklyReport (dispatcher) ──────────────────────────

describe('formatWeeklyReport', () => {
  function makeMetrics(): AnalyzedReportMetrics {
    return {
      timestamp: '2026-03-18T12:00:00.000Z',
      period: { since: '2026-03-11', until: '2026-03-18' },
      activity: {
        totalOperations: 0,
        successfulOperations: 0,
        failedOperations: 0,
        successRate: 0,
        netChange: 0,
        uniqueRefs: [],
        byEventType: {},
      },
      health: { level: 'healthy', score: 100, summary: 'Perfect' },
      registryOverview: {
        totalEntries: 0,
        totalAnnotations: 0,
        totalCandidates: 0,
        totalIssues: 0,
      },
      insights: [],
      velocity: {
        count: 0,
        oldest: '',
        newest: '',
        totalOperations: 0,
        successRate: 0,
        totalNetChange: 0,
        direction: 'neutral',
      },
    };
  }

  it('dispatches to markdown formatter', () => {
    const output = formatWeeklyReport(makeMetrics(), 'markdown', 'weekly');
    assert.ok(output.includes('# Shiori Weekly Report'));
  });

  it('dispatches to html formatter', () => {
    const output = formatWeeklyReport(makeMetrics(), 'html', 'weekly');
    assert.ok(output.includes('<!DOCTYPE html>'));
  });

  it('dispatches to json formatter', () => {
    const output = formatWeeklyReport(makeMetrics(), 'json', 'weekly');
    const envelope = JSON.parse(output);
    assert.ok(envelope.meta, 'should have meta envelope');
    assert.equal(envelope.meta.command, 'weekly-report');
    assert.equal(envelope.meta.schemaVersion, 1);
    const parsed = envelope.data;
    assert.equal(parsed.health.score, 100);
    assert.equal(parsed.period.since, '2026-03-11');
  });

  it('json output includes trend when present (EP-0144)', () => {
    const metrics = makeMetrics();
    metrics.trend = {
      count: 4,
      oldest: '2026-02-01T00:00:00.000Z',
      newest: '2026-03-18T00:00:00.000Z',
      latestScore: 100,
      scoreChange: 20,
      direction: 'improving',
      minScore: 80,
      maxScore: 100,
    };
    const output = formatWeeklyReport(metrics, 'json', 'weekly');
    const envelope = JSON.parse(output);
    const parsed = envelope.data;
    assert.equal(parsed.trend.count, 4);
    assert.equal(parsed.trend.direction, 'improving');
    assert.equal(parsed.trend.scoreChange, 20);
  });
});
