import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  ScanResult,
  Registry,
  RegistryEntry,
  ShioriAnnotation,
  ShioriCandidate,
  TrendResult,
} from '../src/core/types.ts';
import {
  health,
  buildHealthResult,
  formatHealth,
  formatHealthSummary,
} from '../src/commands/health.ts';
import { report } from '../src/commands/report.ts';

function makeAnnotation(
  overrides: Partial<ShioriAnnotation> = {},
): ShioriAnnotation {
  return {
    ref: 'TEST-001',
    rule: 'no-console',
    tagged: true,
    ignored: false,
    location: { file: 'test.ts', line: 1 },
    ...overrides,
  };
}

function makeRegistryEntry(
  overrides: Partial<RegistryEntry> = {},
): RegistryEntry {
  return {
    reason: 'test reason',
    target: 'test.ts',
    expires: undefined,
    ticket: undefined,
    owner: undefined,
    notes: undefined,
    kind: undefined,
    ...overrides,
  };
}

function makeScanResult(
  annotations: ShioriAnnotation[] = [],
  candidates: ShioriCandidate[] = [],
): ScanResult {
  return {
    annotations,
    candidates,
    filesScanned: 1,
  };
}

function makeTrendResult(
  overrides: Partial<TrendResult['summary']> = {},
): TrendResult {
  return {
    points: [
      {
        timestamp: '2026-01-01T00:00:00.000Z',
        score: 80,
        level: 'healthy',
        issues: 2,
        annotations: 5,
        candidates: 1,
        registryEntries: 5,
      },
      {
        timestamp: '2026-02-01T00:00:00.000Z',
        score: 90,
        level: 'healthy',
        issues: 1,
        annotations: 5,
        candidates: 0,
        registryEntries: 5,
      },
    ],
    summary: {
      count: 2,
      oldest: '2026-01-01T00:00:00.000Z',
      newest: '2026-02-01T00:00:00.000Z',
      latestScore: 90,
      scoreChange: 10,
      direction: 'improving',
      minScore: 80,
      maxScore: 90,
      ...overrides,
    },
  };
}

describe('health', () => {
  describe('basic result', () => {
    it('returns healthy result for clean codebase', () => {
      const result = health({
        scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
        registry: {
          'TEST-001': makeRegistryEntry(),
        },
        failOn: [],
        warnOn: [],
      });

      assert.equal(result.health.score, 100);
      assert.equal(result.health.level, 'healthy');
      assert.equal(result.issues.total, 0);
      assert.equal(result.issues.errors, 0);
      assert.equal(result.issues.warnings, 0);
      assert.equal(result.expiring.expired, 0);
      assert.equal(result.expiring.expiringSoon, 0);
      assert.ok(result.insights.length > 0);
      assert.equal(result.trend, undefined);
    });

    it('includes expired and expiring-soon counts', () => {
      const result = health({
        scanResult: makeScanResult([
          makeAnnotation({ ref: 'EXP-001' }),
          makeAnnotation({ ref: 'SOON-001' }),
        ]),
        registry: {
          'EXP-001': makeRegistryEntry({ expires: '2020-01-01' }),
          'SOON-001': makeRegistryEntry({ expires: '2026-02-20' }),
        },
        failOn: [],
        warnOn: [],
        now: new Date('2026-02-11T00:00:00Z'),
      });

      assert.equal(result.expiring.expired, 1);
      assert.equal(result.expiring.expiringSoon, 1);
    });

    it('includes issue counts', () => {
      const result = health({
        scanResult: makeScanResult([
          makeAnnotation({ ref: 'MISSING-001' }),
          makeAnnotation({ ref: 'MISSING-002' }),
        ]),
        registry: {},
        failOn: ['missing-in-registry'],
        warnOn: [],
      });

      assert.equal(result.issues.total, 2);
      assert.equal(result.issues.errors, 2);
      assert.equal(result.issues.warnings, 0);
    });
  });

  describe('trend integration', () => {
    it('includes trend summary when trendResult is provided', () => {
      const trendResult = makeTrendResult();
      const result = health({
        scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
        registry: {
          'TEST-001': makeRegistryEntry(),
        },
        failOn: [],
        warnOn: [],
        trendResult,
      });

      assert.ok(result.trend);
      assert.equal(result.trend.direction, 'improving');
      assert.equal(result.trend.scoreChange, 10);
      assert.equal(result.trend.latestScore, 90);
    });

    it('excludes trend when trendResult has no points', () => {
      const emptyTrend: TrendResult = {
        points: [],
        summary: {
          count: 0,
          oldest: '',
          newest: '',
          latestScore: 0,
          scoreChange: 0,
          direction: 'stable',
          minScore: 0,
          maxScore: 0,
        },
      };

      const result = health({
        scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
        registry: {
          'TEST-001': makeRegistryEntry(),
        },
        failOn: [],
        warnOn: [],
        trendResult: emptyTrend,
      });

      assert.equal(result.trend, undefined);
    });
  });
});

describe('buildHealthResult', () => {
  it('builds result from ReportResult without trend', () => {
    const reportResult = report({
      scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
      registry: {
        'TEST-001': makeRegistryEntry(),
      },
      failOn: [],
      warnOn: [],
    });

    const result = buildHealthResult(reportResult);

    assert.equal(result.health.score, reportResult.health.score);
    assert.equal(result.health.level, reportResult.health.level);
    assert.equal(result.issues.total, reportResult.totals.issues);
    assert.equal(result.trend, undefined);
  });

  it('builds result from ReportResult with trend', () => {
    const reportResult = report({
      scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
      registry: {
        'TEST-001': makeRegistryEntry(),
      },
      failOn: [],
      warnOn: [],
    });

    const trendResult = makeTrendResult({
      direction: 'declining',
      scoreChange: -5,
    });
    const result = buildHealthResult(reportResult, trendResult);

    assert.ok(result.trend);
    assert.equal(result.trend.direction, 'declining');
    assert.equal(result.trend.scoreChange, -5);
  });
});

describe('formatHealth', () => {
  it('formats as JSON', () => {
    const result = health({
      scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
      registry: {
        'TEST-001': makeRegistryEntry(),
      },
      failOn: [],
      warnOn: [],
    });

    const output = formatHealth(result, 'json');
    const parsed = JSON.parse(output);
    assert.equal(parsed.health.score, 100);
    assert.equal(parsed.health.level, 'healthy');
    assert.equal(parsed.issues.total, 0);
    assert.equal(parsed.expiring.expired, 0);
  });

  it('formats as summary', () => {
    const result = health({
      scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
      registry: {
        'TEST-001': makeRegistryEntry(),
      },
      failOn: [],
      warnOn: [],
    });

    const output = formatHealth(result, 'summary');
    assert.ok(output.includes('Health:'));
    assert.ok(output.includes('100/100'));
    assert.ok(output.includes('healthy'));
  });
});

describe('formatHealthSummary', () => {
  it('shows box with health info', () => {
    const result = health({
      scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
      registry: {
        'TEST-001': makeRegistryEntry(),
      },
      failOn: [],
      warnOn: [],
    });

    const output = formatHealthSummary(result);
    assert.ok(output.includes('┌'));
    assert.ok(output.includes('┘'));
    assert.ok(output.includes('Health:'));
    assert.ok(output.includes('Issues:'));
  });

  it('shows expiring info when present', () => {
    const result = health({
      scanResult: makeScanResult([makeAnnotation({ ref: 'EXP-001' })]),
      registry: {
        'EXP-001': makeRegistryEntry({ expires: '2020-01-01' }),
      },
      failOn: [],
      warnOn: [],
    });

    const output = formatHealthSummary(result);
    assert.ok(output.includes('Expired:'));
  });

  it('shows trend when present', () => {
    const trendResult = makeTrendResult({
      direction: 'improving',
      scoreChange: 5,
    });
    const result = health({
      scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
      registry: {
        'TEST-001': makeRegistryEntry(),
      },
      failOn: [],
      warnOn: [],
      trendResult,
    });

    const output = formatHealthSummary(result);
    assert.ok(output.includes('Trend:'));
    assert.ok(output.includes('improving'));
  });

  it('omits expiring line when counts are zero', () => {
    const result = health({
      scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
      registry: {
        'TEST-001': makeRegistryEntry(),
      },
      failOn: [],
      warnOn: [],
    });

    const output = formatHealthSummary(result);
    assert.ok(!output.includes('Expired:'));
  });

  it('shows critical emoji for critical health', () => {
    const annotations = Array.from({ length: 10 }, (_, i) =>
      makeAnnotation({ ref: `MISS-${i}` }),
    );
    const registry: Registry = {};
    for (const a of annotations) {
      registry[a.ref] = makeRegistryEntry({ expires: '2020-01-01' });
    }

    const result = health({
      scanResult: makeScanResult(annotations),
      registry,
      failOn: [],
      warnOn: [],
    });

    const output = formatHealthSummary(result);
    // Should show warning or critical emoji
    assert.ok(output.includes('🟡') || output.includes('🔴'));
  });
});
