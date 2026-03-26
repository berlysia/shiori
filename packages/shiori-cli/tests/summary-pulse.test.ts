import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  HealthResult,
  ReportResult,
  TrendResult,
  DeltaResult,
  HealthPrescription,
} from '../src/core/types.ts';
import {
  formatSummaryAsPulse,
  formatSummary,
  type SummaryResult,
} from '../src/commands/summary.ts';
import type { TriageResult, TriagePriority } from '../src/commands/triage.ts';

// ── Test helpers ─────────────────────────────────────────────

function makeHealthResult(overrides: Partial<HealthResult> = {}): HealthResult {
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    health: {
      level: 'healthy',
      score: 100,
      coverage: 100,
      hygiene: 100,
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
    health: {
      level: 'healthy',
      score: 100,
      coverage: 100,
      hygiene: 100,
      summary: 'All healthy',
    },
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

describe('formatSummaryAsPulse', () => {
  it('renders health header with score and level', () => {
    const result = makeSummaryResult();
    const output = formatSummaryAsPulse(result);

    assert.ok(output.includes('Health: 100/100 (healthy)'));
    assert.ok(output.includes('┌'));
    assert.ok(output.includes('└'));
  });

  it('renders issue counts', () => {
    const result = makeSummaryResult({
      health: makeHealthResult({
        issues: { total: 5, errors: 2, warnings: 3 },
      }),
    });
    const output = formatSummaryAsPulse(result);

    assert.ok(output.includes('Issues: 5 (2 errors, 3 warnings)'));
  });

  it('shows expiring info when present', () => {
    const result = makeSummaryResult({
      health: makeHealthResult({
        expiring: { expired: 2, expiringSoon: 3 },
      }),
    });
    const output = formatSummaryAsPulse(result);

    assert.ok(output.includes('Expired: 2, Expiring soon: 3'));
  });

  it('omits expiring line when counts are zero', () => {
    const result = makeSummaryResult();
    const output = formatSummaryAsPulse(result);

    assert.ok(!output.includes('Expired:'));
  });

  it('renders delta when present', () => {
    const delta: DeltaResult = {
      deltas: [],
      summary: { added: 3, removed: 1, unchanged: 5, net: 2 },
    };
    const result = makeSummaryResult({ delta });
    const output = formatSummaryAsPulse(result);

    assert.ok(output.includes('Delta: +3/-1 (net +2)'));
  });

  it('renders negative net delta', () => {
    const delta: DeltaResult = {
      deltas: [],
      summary: { added: 0, removed: 3, unchanged: 5, net: -3 },
    };
    const result = makeSummaryResult({ delta });
    const output = formatSummaryAsPulse(result);

    assert.ok(output.includes('Delta: +0/-3 (net -3)'));
  });

  it('renders trend with sparkline when present', () => {
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
    const output = formatSummaryAsPulse(result);

    assert.ok(output.includes('Trend:'));
    assert.ok(output.includes('improving'));
    assert.ok(output.includes('+20'));
  });

  it('renders triage section when present', () => {
    const triageData = makeTriageResult([
      { ref: 'EXP-001', priority: 'critical' },
      { ref: 'MISS-001', priority: 'high' },
    ]);
    const result = makeSummaryResult({ triage: triageData });
    const output = formatSummaryAsPulse(result);

    assert.ok(output.includes('Triage: 2 items'));
  });

  it('omits triage section when no items', () => {
    const result = makeSummaryResult();
    const output = formatSummaryAsPulse(result);

    assert.ok(!output.includes('Triage:'));
  });

  it('renders prescriptions when present', () => {
    const prescriptions: HealthPrescription[] = [
      {
        urgency: 'critical',
        message: 'Resolve expired annotations',
        command: 'shiori resolve EXP-001',
        scoreImpact: 10,
        actionType: 'update',
        axis: 'hygiene' as const,
      },
    ];
    const result = makeSummaryResult({
      health: makeHealthResult({ prescriptions }),
    });
    const output = formatSummaryAsPulse(result);

    assert.ok(output.includes('Prescriptions:'));
    assert.ok(output.includes('+10pt: shiori resolve EXP-001'));
  });

  it('limits prescriptions to 3', () => {
    const prescriptions: HealthPrescription[] = Array.from(
      { length: 5 },
      (_, i) => ({
        urgency: 'recommended' as const,
        message: `Fix ${i}`,
        command: `shiori fix ${i}`,
        scoreImpact: 5,
        actionType: 'update' as const,
        axis: 'hygiene' as const,
      }),
    );
    const result = makeSummaryResult({
      health: makeHealthResult({ prescriptions }),
    });
    const output = formatSummaryAsPulse(result);

    // Should only show first 3
    assert.ok(output.includes('shiori fix 0'));
    assert.ok(output.includes('shiori fix 2'));
    assert.ok(!output.includes('shiori fix 3'));
  });

  it('shows triage CTA when issues exist', () => {
    const result = makeSummaryResult({
      health: makeHealthResult({
        issues: { total: 1, errors: 1, warnings: 0 },
      }),
    });
    const output = formatSummaryAsPulse(result);

    assert.ok(output.includes('Run: shiori triage'));
  });

  it('omits triage CTA when no issues', () => {
    const result = makeSummaryResult();
    const output = formatSummaryAsPulse(result);

    assert.ok(!output.includes('Run: shiori triage'));
  });
});

describe('formatSummary pulse integration', () => {
  it('dispatches pulse format through formatSummary', () => {
    const result = makeSummaryResult();
    const output = formatSummary(result, 'pulse');

    assert.ok(output.includes('Health: 100/100 (healthy)'));
    assert.ok(output.includes('┌'));
  });
});
