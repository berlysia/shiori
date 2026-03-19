import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  ScanResult,
  Registry,
  RegistryEntry,
  ShioriAnnotation,
  ShioriCandidate,
  ReportResult,
} from '../src/core/types.ts';
import {
  summary,
  formatSummary,
  formatSummaryAsMarkdown,
} from '../src/commands/summary.ts';
import { report } from '../src/commands/report.ts';

// ── Test helpers (shared pattern with health.test.ts) ────────

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

function makeReportResult(
  annotations: ShioriAnnotation[],
  registry: Registry,
): ReportResult {
  return report({
    scanResult: makeScanResult(annotations),
    registry,
    failOn: [],
    warnOn: [],
  });
}

// ── Tests ────────────────────────────────────────────────────

describe('summary', () => {
  describe('basic result', () => {
    it('returns health-only summary for clean codebase', () => {
      const result = summary({
        scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
        registry: {
          'TEST-001': makeRegistryEntry(),
        },
        failOn: [],
        warnOn: [],
      });

      assert.equal(result.health.health.score, 100);
      assert.equal(result.health.health.level, 'healthy');
      assert.equal(result.delta, undefined);
      assert.equal(result.trend, undefined);
      assert.equal(result.triage, undefined);
      assert.ok(result.timestamp);
    });

    it('includes repository when specified', () => {
      const result = summary({
        scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
        registry: {
          'TEST-001': makeRegistryEntry(),
        },
        failOn: [],
        warnOn: [],
        repository: 'my-org/my-repo',
      });

      assert.equal(result.repository, 'my-org/my-repo');
    });

    it('omits repository when not specified', () => {
      const result = summary({
        scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
        registry: {
          'TEST-001': makeRegistryEntry(),
        },
        failOn: [],
        warnOn: [],
      });

      assert.equal(result.repository, undefined);
    });
  });

  describe('delta integration', () => {
    it('includes delta when baseScanResult is provided', () => {
      const baseScan = makeScanResult([makeAnnotation({ ref: 'OLD-001' })]);
      const headScan = makeScanResult([
        makeAnnotation({ ref: 'OLD-001' }),
        makeAnnotation({
          ref: 'NEW-001',
          location: { file: 'new.ts', line: 5 },
        }),
      ]);

      const result = summary({
        scanResult: headScan,
        registry: {
          'OLD-001': makeRegistryEntry(),
          'NEW-001': makeRegistryEntry(),
        },
        failOn: [],
        warnOn: [],
        baseScanResult: baseScan,
      });

      assert.ok(result.delta);
      assert.equal(result.delta.summary.added, 1);
      assert.equal(result.delta.summary.unchanged, 1);
      assert.equal(result.delta.summary.removed, 0);
    });

    it('skips delta when baseScanResult is not provided', () => {
      const result = summary({
        scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
        registry: {
          'TEST-001': makeRegistryEntry(),
        },
        failOn: [],
        warnOn: [],
      });

      assert.equal(result.delta, undefined);
    });
  });

  describe('trend integration', () => {
    it('includes trend when trendReports are provided', () => {
      const reports: ReportResult[] = [
        makeReportResult([makeAnnotation({ ref: 'TEST-001' })], {
          'TEST-001': makeRegistryEntry(),
        }),
        makeReportResult([makeAnnotation({ ref: 'TEST-001' })], {
          'TEST-001': makeRegistryEntry(),
        }),
      ];

      const result = summary({
        scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
        registry: {
          'TEST-001': makeRegistryEntry(),
        },
        failOn: [],
        warnOn: [],
        trendReports: reports,
      });

      assert.ok(result.trend);
      assert.ok(result.trend.points.length > 0);
    });

    it('skips trend when trendReports is empty', () => {
      const result = summary({
        scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
        registry: {
          'TEST-001': makeRegistryEntry(),
        },
        failOn: [],
        warnOn: [],
        trendReports: [],
      });

      assert.equal(result.trend, undefined);
    });

    it('skips trend when trendReports is not provided', () => {
      const result = summary({
        scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
        registry: {
          'TEST-001': makeRegistryEntry(),
        },
        failOn: [],
        warnOn: [],
      });

      assert.equal(result.trend, undefined);
    });
  });

  describe('triage integration', () => {
    it('includes triage when issues exist', () => {
      const result = summary({
        scanResult: makeScanResult([makeAnnotation({ ref: 'MISS-001' })]),
        registry: {},
        failOn: [],
        warnOn: [],
      });

      // missing-in-registry generates an issue
      assert.ok(result.health.issues.total > 0);
      assert.ok(result.triage);
      assert.ok(result.triage.items.length > 0);
    });

    it('omits triage when no issues exist', () => {
      const result = summary({
        scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
        registry: {
          'TEST-001': makeRegistryEntry(),
        },
        failOn: [],
        warnOn: [],
      });

      assert.equal(result.health.issues.total, 0);
      assert.equal(result.triage, undefined);
    });

    it('respects skipTriage option', () => {
      const result = summary({
        scanResult: makeScanResult([makeAnnotation({ ref: 'MISS-001' })]),
        registry: {},
        failOn: [],
        warnOn: [],
        skipTriage: true,
      });

      assert.ok(result.health.issues.total > 0);
      assert.equal(result.triage, undefined);
    });
  });

  describe('full aggregation', () => {
    it('combines all sections when inputs are available', () => {
      const baseScan = makeScanResult([]);
      const headAnnotations = [makeAnnotation({ ref: 'MISS-001' })];
      const headScan = makeScanResult(headAnnotations);
      const registry: Registry = {};

      const trendReports: ReportResult[] = [
        makeReportResult([], {}),
        makeReportResult(headAnnotations, registry),
      ];

      const result = summary({
        scanResult: headScan,
        registry,
        failOn: [],
        warnOn: [],
        baseScanResult: baseScan,
        trendReports,
        repository: 'test-org/test-repo',
      });

      assert.equal(result.repository, 'test-org/test-repo');
      assert.ok(result.health);
      assert.ok(result.delta);
      assert.ok(result.trend);
      assert.ok(result.triage); // MISS-001 is not in registry → issues exist
    });
  });
});

describe('formatSummary', () => {
  const cleanResult = summary({
    scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
    registry: {
      'TEST-001': makeRegistryEntry(),
    },
    failOn: [],
    warnOn: [],
  });

  it('formats as JSON', () => {
    const output = formatSummary(cleanResult, 'json');
    const parsed = JSON.parse(output);
    assert.equal(parsed.health.health.score, 100);
    assert.equal(parsed.health.health.level, 'healthy');
    assert.ok(parsed.timestamp);
  });

  it('formats as markdown', () => {
    const output = formatSummary(cleanResult, 'markdown');
    assert.ok(output.includes('## Shiori Governance Summary'));
    assert.ok(output.includes('Health:'));
    assert.ok(output.includes('100/100'));
  });
});

describe('formatSummaryAsMarkdown', () => {
  it('includes repository in header when specified', () => {
    const result = summary({
      scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
      registry: {
        'TEST-001': makeRegistryEntry(),
      },
      failOn: [],
      warnOn: [],
      repository: 'my-org/my-repo',
    });

    const output = formatSummaryAsMarkdown(result);
    assert.ok(output.includes('my-org/my-repo'));
  });

  it('includes delta table when delta is present', () => {
    const baseScan = makeScanResult([]);
    const headScan = makeScanResult([makeAnnotation({ ref: 'NEW-001' })]);

    const result = summary({
      scanResult: headScan,
      registry: {
        'NEW-001': makeRegistryEntry(),
      },
      failOn: [],
      warnOn: [],
      baseScanResult: baseScan,
    });

    const output = formatSummaryAsMarkdown(result);
    assert.ok(output.includes('### Delta'));
    assert.ok(output.includes('Added'));
    assert.ok(output.includes('Removed'));
  });

  it('includes triage section when issues exist', () => {
    const result = summary({
      scanResult: makeScanResult([makeAnnotation({ ref: 'MISS-001' })]),
      registry: {},
      failOn: [],
      warnOn: [],
    });

    const output = formatSummaryAsMarkdown(result);
    assert.ok(output.includes('### Triage'));
  });

  it('includes insights section', () => {
    const result = summary({
      scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
      registry: {
        'TEST-001': makeRegistryEntry(),
      },
      failOn: [],
      warnOn: [],
    });

    const output = formatSummaryAsMarkdown(result);
    assert.ok(output.includes('### Insights'));
  });

  it('shows issue counts when issues exist', () => {
    const result = summary({
      scanResult: makeScanResult([makeAnnotation({ ref: 'MISS-001' })]),
      registry: {},
      failOn: ['missing-in-registry'],
      warnOn: [],
    });

    const output = formatSummaryAsMarkdown(result);
    assert.ok(output.includes('**Issues:**'));
  });

  it('shows expiring info when present', () => {
    const result = summary({
      scanResult: makeScanResult([makeAnnotation({ ref: 'EXP-001' })]),
      registry: {
        'EXP-001': makeRegistryEntry({ expires: '2020-01-01' }),
      },
      failOn: [],
      warnOn: [],
    });

    const output = formatSummaryAsMarkdown(result);
    assert.ok(output.includes('**Expired:**'));
  });
});
