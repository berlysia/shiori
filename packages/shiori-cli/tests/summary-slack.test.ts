import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  HealthResult,
  ReportResult,
  TrendResult,
  DeltaResult,
} from '../src/core/types.ts';
import {
  formatSummaryAsSlack,
  formatSummary,
  type SummaryResult,
} from '../src/commands/summary.ts';
import type { TriageResult, TriagePriority } from '../src/commands/triage.ts';

// ── Test helpers (shared pattern with summary-pulse.test.ts) ─

function makeHealthResult(overrides: Partial<HealthResult> = {}): HealthResult {
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    health: {
      level: 'healthy',
      score: 100,
      summary: 'All annotations are healthy',
    },
    issues: { total: 0, errors: 0, warnings: 0 },
    expiring: { expired: 0, expiringSoon: 0 },
    insights: [],
    ...overrides,
  };
}

function makeReportResult(): ReportResult {
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    health: { level: 'healthy', score: 100, summary: 'All healthy' },
    totals: {
      annotations: 1,
      candidates: 0,
      registryEntries: 1,
      issues: 0,
      errors: 0,
      warnings: 0,
    },
    insights: [],
    byType: {
      expired: 0,
      'expiring-soon': 0,
      'missing-in-registry': 0,
      'syntax-error': 0,
      'ref-format': 0,
      'unused-in-source': 0,
      'ref-collision': 0,
      'unrouted-ref': 0,
      'registry-routing-mismatch': 0,
      'ref-status-closed': 0,
      'intentional-without-reason': 0,
      'temporary-without-expires': 0,
    },
    byRule: [],
    byKind: [],
    byOwner: [],
    verifyResult: {
      issues: [],
      timestamp: '2026-01-01T00:00:00.000Z',
      scannedRecords: 1,
      registryEntries: 1,
      summary: {
        total: 0,
        errors: 0,
        warnings: 0,
        byType: {
          expired: 0,
          'expiring-soon': 0,
          'missing-in-registry': 0,
          'syntax-error': 0,
          'ref-format': 0,
          'unused-in-source': 0,
          'ref-collision': 0,
          'unrouted-ref': 0,
          'registry-routing-mismatch': 0,
          'ref-status-closed': 0,
          'intentional-without-reason': 0,
          'temporary-without-expires': 0,
        },
      },
    },
  };
}

function makeSummaryResult(
  overrides: Partial<SummaryResult> = {},
): SummaryResult {
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    health: makeHealthResult(),
    _reportResult: makeReportResult(),
    ...overrides,
  };
}

function makeTriageResult(
  items: Array<{ ref: string; priority: TriagePriority }>,
): TriageResult {
  const byPriority: Record<TriagePriority, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  const triageItems = items.map((i) => {
    byPriority[i.priority]++;
    return {
      ref: i.ref,
      priority: i.priority,
      issues: [],
      registryEntry: undefined,
      sourceLocations: [],
      url: undefined,
      action: `shiori update ${i.ref}`,
    };
  });
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    items: triageItems,
    summary: { total: triageItems.length, byPriority },
  };
}

// ── Tests ────────────────────────────────────────────────────

describe('formatSummaryAsSlack', () => {
  it('produces valid JSON with blocks array', () => {
    const result = makeSummaryResult();
    const output = formatSummaryAsSlack(result);
    const parsed = JSON.parse(output);

    assert.ok(Array.isArray(parsed.blocks));
    assert.ok(parsed.blocks.length > 0);
  });

  it('includes header block with health score', () => {
    const result = makeSummaryResult();
    const output = formatSummaryAsSlack(result);
    const parsed = JSON.parse(output);

    const header = parsed.blocks.find(
      (b: { type: string }) => b.type === 'header',
    );
    assert.ok(header);
    assert.ok(header.text.text.includes('100/100'));
    assert.ok(header.text.text.includes('healthy'));
  });

  it('uses green circle emoji for healthy level', () => {
    const result = makeSummaryResult();
    const output = formatSummaryAsSlack(result);
    const parsed = JSON.parse(output);

    const header = parsed.blocks.find(
      (b: { type: string }) => b.type === 'header',
    );
    assert.ok(header.text.text.includes(':large_green_circle:'));
  });

  it('uses yellow circle emoji for warning level', () => {
    const result = makeSummaryResult({
      health: makeHealthResult({
        health: { level: 'warning', score: 60, summary: 'Some issues' },
      }),
    });
    const output = formatSummaryAsSlack(result);
    const parsed = JSON.parse(output);

    const header = parsed.blocks.find(
      (b: { type: string }) => b.type === 'header',
    );
    assert.ok(header.text.text.includes(':large_yellow_circle:'));
  });

  it('uses red circle emoji for critical level', () => {
    const result = makeSummaryResult({
      health: makeHealthResult({
        health: { level: 'critical', score: 20, summary: 'Critical issues' },
      }),
    });
    const output = formatSummaryAsSlack(result);
    const parsed = JSON.parse(output);

    const header = parsed.blocks.find(
      (b: { type: string }) => b.type === 'header',
    );
    assert.ok(header.text.text.includes(':red_circle:'));
  });

  it('includes health score and issues in section fields', () => {
    const result = makeSummaryResult({
      health: makeHealthResult({
        issues: { total: 5, errors: 2, warnings: 3 },
      }),
    });
    const output = formatSummaryAsSlack(result);
    const parsed = JSON.parse(output);

    const section = parsed.blocks.find(
      (b: { type: string; fields?: unknown }) =>
        b.type === 'section' && b.fields,
    );
    assert.ok(section);

    const issueField = section.fields.find((f: { text: string }) =>
      f.text.includes('*Issues*'),
    );
    assert.ok(issueField);
    assert.ok(issueField.text.includes('5'));
    assert.ok(issueField.text.includes('2 errors'));
    assert.ok(issueField.text.includes('3 warnings'));
  });

  it('includes expiring fields when present', () => {
    const result = makeSummaryResult({
      health: makeHealthResult({
        expiring: { expired: 2, expiringSoon: 3 },
      }),
    });
    const output = formatSummaryAsSlack(result);
    const parsed = JSON.parse(output);

    const section = parsed.blocks.find(
      (b: { type: string; fields?: unknown }) =>
        b.type === 'section' && b.fields,
    );
    const expiredField = section.fields.find((f: { text: string }) =>
      f.text.includes('*Expired*'),
    );
    assert.ok(expiredField);
    assert.ok(expiredField.text.includes('2'));

    const expiringField = section.fields.find((f: { text: string }) =>
      f.text.includes('*Expiring Soon*'),
    );
    assert.ok(expiringField);
    assert.ok(expiringField.text.includes('3'));
  });

  it('omits expiring fields when counts are zero', () => {
    const result = makeSummaryResult();
    const output = formatSummaryAsSlack(result);
    const parsed = JSON.parse(output);

    const section = parsed.blocks.find(
      (b: { type: string; fields?: unknown }) =>
        b.type === 'section' && b.fields,
    );
    const expiredField = section.fields.find((f: { text: string }) =>
      f.text.includes('*Expired*'),
    );
    assert.equal(expiredField, undefined);
  });

  it('includes delta field when present', () => {
    const delta: DeltaResult = {
      deltas: [],
      summary: { added: 3, removed: 1, unchanged: 5, net: 2 },
    };
    const result = makeSummaryResult({ delta });
    const output = formatSummaryAsSlack(result);
    const parsed = JSON.parse(output);

    const section = parsed.blocks.find(
      (b: { type: string; fields?: unknown }) =>
        b.type === 'section' && b.fields,
    );
    const deltaField = section.fields.find((f: { text: string }) =>
      f.text.includes('*Delta*'),
    );
    assert.ok(deltaField);
    assert.ok(deltaField.text.includes('+3'));
    assert.ok(deltaField.text.includes('-1'));
    assert.ok(deltaField.text.includes('+2'));
  });

  it('includes trend section when present', () => {
    const trend: TrendResult = {
      points: [
        {
          timestamp: '2026-01-01T00:00:00.000Z',
          score: 60,
          level: 'warning',
          issues: 5,
          annotations: 10,
          candidates: 2,
          registryEntries: 8,
        },
        {
          timestamp: '2026-02-01T00:00:00.000Z',
          score: 80,
          level: 'healthy',
          issues: 2,
          annotations: 10,
          candidates: 1,
          registryEntries: 10,
        },
      ],
      summary: {
        count: 2,
        oldest: '2026-01-01T00:00:00.000Z',
        newest: '2026-02-01T00:00:00.000Z',
        latestScore: 80,
        scoreChange: 20,
        direction: 'improving',
        minScore: 60,
        maxScore: 80,
      },
    };
    const result = makeSummaryResult({ trend });
    const output = formatSummaryAsSlack(result);
    const parsed = JSON.parse(output);

    const trendSection = parsed.blocks.find(
      (b: { type: string; text?: { text: string } }) =>
        b.type === 'section' && b.text?.text?.includes('*Trend:*'),
    );
    assert.ok(trendSection);
    assert.ok(trendSection.text.text.includes('improving'));
    assert.ok(trendSection.text.text.includes('+20'));
    assert.ok(trendSection.text.text.includes(':chart_with_upwards_trend:'));
  });

  it('uses declining emoji for declining trend', () => {
    const trend: TrendResult = {
      points: [
        {
          timestamp: '2026-01-01T00:00:00.000Z',
          score: 80,
          level: 'healthy',
          issues: 2,
          annotations: 10,
          candidates: 1,
          registryEntries: 10,
        },
        {
          timestamp: '2026-02-01T00:00:00.000Z',
          score: 60,
          level: 'warning',
          issues: 5,
          annotations: 10,
          candidates: 2,
          registryEntries: 8,
        },
      ],
      summary: {
        count: 2,
        oldest: '2026-01-01T00:00:00.000Z',
        newest: '2026-02-01T00:00:00.000Z',
        latestScore: 60,
        scoreChange: -20,
        direction: 'declining',
        minScore: 60,
        maxScore: 80,
      },
    };
    const result = makeSummaryResult({ trend });
    const output = formatSummaryAsSlack(result);
    const parsed = JSON.parse(output);

    const trendSection = parsed.blocks.find(
      (b: { type: string; text?: { text: string } }) =>
        b.type === 'section' && b.text?.text?.includes('*Trend:*'),
    );
    assert.ok(trendSection.text.text.includes(':chart_with_downwards_trend:'));
  });

  it('omits trend section when no trend data', () => {
    const result = makeSummaryResult();
    const output = formatSummaryAsSlack(result);
    const parsed = JSON.parse(output);

    const trendSection = parsed.blocks.find(
      (b: { type: string; text?: { text: string } }) =>
        b.type === 'section' && b.text?.text?.includes('*Trend:*'),
    );
    assert.equal(trendSection, undefined);
  });

  it('includes triage section with top-3 items', () => {
    const triageData = makeTriageResult([
      { ref: 'EXP-001', priority: 'critical' },
      { ref: 'MISS-001', priority: 'high' },
      { ref: 'LOW-001', priority: 'low' },
    ]);
    const result = makeSummaryResult({ triage: triageData });
    const output = formatSummaryAsSlack(result);
    const parsed = JSON.parse(output);

    const triageSummary = parsed.blocks.find(
      (b: { type: string; text?: { text: string } }) =>
        b.type === 'section' && b.text?.text?.includes('*Triage:*'),
    );
    assert.ok(triageSummary);
    assert.ok(triageSummary.text.text.includes('3 items'));

    const triageItems = parsed.blocks.find(
      (b: { type: string; text?: { text: string } }) =>
        b.type === 'section' && b.text?.text?.includes('EXP-001'),
    );
    assert.ok(triageItems);
    assert.ok(triageItems.text.text.includes('MISS-001'));
    assert.ok(triageItems.text.text.includes('LOW-001'));
  });

  it('limits triage to top 3 and shows "more" context', () => {
    const triageData = makeTriageResult([
      { ref: 'A-001', priority: 'critical' },
      { ref: 'B-001', priority: 'high' },
      { ref: 'C-001', priority: 'medium' },
      { ref: 'D-001', priority: 'low' },
      { ref: 'E-001', priority: 'low' },
    ]);
    const result = makeSummaryResult({ triage: triageData });
    const output = formatSummaryAsSlack(result);
    const parsed = JSON.parse(output);

    // Top 3 shown
    const triageItems = parsed.blocks.find(
      (b: { type: string; text?: { text: string } }) =>
        b.type === 'section' && b.text?.text?.includes('A-001'),
    );
    assert.ok(triageItems);
    assert.ok(triageItems.text.text.includes('B-001'));
    assert.ok(triageItems.text.text.includes('C-001'));
    assert.ok(!triageItems.text.text.includes('D-001'));

    // "more" context block
    const moreContext = parsed.blocks.find(
      (b: { type: string; elements?: Array<{ text: string }> }) =>
        b.type === 'context' &&
        b.elements?.some((e) => e.text.includes('...and 2 more')),
    );
    assert.ok(moreContext);
  });

  it('omits triage section when no items', () => {
    const result = makeSummaryResult();
    const output = formatSummaryAsSlack(result);
    const parsed = JSON.parse(output);

    const triageSummary = parsed.blocks.find(
      (b: { type: string; text?: { text: string } }) =>
        b.type === 'section' && b.text?.text?.includes('*Triage:*'),
    );
    assert.equal(triageSummary, undefined);
  });

  it('includes footer with timestamp', () => {
    const result = makeSummaryResult();
    const output = formatSummaryAsSlack(result);
    const parsed = JSON.parse(output);

    const footer = parsed.blocks.find(
      (b: { type: string; elements?: Array<{ text: string }> }) =>
        b.type === 'context' &&
        b.elements?.some((e) => e.text.includes('Generated by shiori')),
    );
    assert.ok(footer);
    assert.ok(footer.elements[0].text.includes('2026-01-01'));
  });

  it('includes divider blocks for visual separation', () => {
    const result = makeSummaryResult();
    const output = formatSummaryAsSlack(result);
    const parsed = JSON.parse(output);

    const dividers = parsed.blocks.filter(
      (b: { type: string }) => b.type === 'divider',
    );
    assert.ok(dividers.length >= 1);
  });
});

describe('formatSummary slack integration', () => {
  it('dispatches slack format through formatSummary', () => {
    const result = makeSummaryResult();
    const output = formatSummary(result, 'slack');
    const parsed = JSON.parse(output);

    assert.ok(Array.isArray(parsed.blocks));
    assert.ok(parsed.blocks.length > 0);
  });
});
