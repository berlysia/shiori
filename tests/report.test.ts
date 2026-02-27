import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  ScanResult,
  Registry,
  RegistryEntry,
  ShioriAnnotation,
  ShioriCandidate,
} from '../src/core/types.ts';
import {
  report,
  formatReport,
  formatReportAsMarkdown,
  type ReportResult,
} from '../src/commands/report.ts';

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

describe('report', () => {
  describe('health score', () => {
    it('returns score 100 for clean codebase', () => {
      const result = report({
        scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
        registry: {
          'TEST-001': makeRegistryEntry(),
        },
        failOn: [],
        warnOn: [],
      });

      assert.equal(result.health.score, 100);
      assert.equal(result.health.level, 'healthy');
    });

    it('deducts points for expired annotations', () => {
      const result = report({
        scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
        registry: {
          'TEST-001': makeRegistryEntry({ expires: '2020-01-01' }),
        },
        failOn: [],
        warnOn: [],
      });

      assert.ok(result.health.score < 100);
      assert.equal(result.byType['expired'], 1);
    });

    it('deducts points for missing-in-registry', () => {
      const result = report({
        scanResult: makeScanResult([makeAnnotation({ ref: 'MISSING-001' })]),
        registry: {},
        failOn: [],
        warnOn: [],
      });

      assert.ok(result.health.score < 100);
      assert.equal(result.byType['missing-in-registry'], 1);
    });

    it('deducts points for untracked candidates', () => {
      const candidates: ShioriCandidate[] = [
        { pattern: 'eslint', location: { file: 'a.ts', line: 1 } },
        { pattern: 'eslint', location: { file: 'b.ts', line: 2 } },
      ];

      const result = report({
        scanResult: makeScanResult(
          [makeAnnotation({ ref: 'TEST-001' })],
          candidates,
        ),
        registry: {
          'TEST-001': makeRegistryEntry(),
        },
        failOn: [],
        warnOn: [],
      });

      // 2 candidates out of 3 total = ~67% untracked → score reduced
      assert.ok(result.health.score < 100);
    });

    it('returns critical for heavily degraded codebase', () => {
      const annotations = [
        makeAnnotation({ ref: 'EXP-001' }),
        makeAnnotation({ ref: 'EXP-002' }),
        makeAnnotation({ ref: 'EXP-003' }),
        makeAnnotation({ ref: 'EXP-004' }),
        makeAnnotation({ ref: 'MISSING-001' }),
        makeAnnotation({ ref: 'MISSING-002' }),
        makeAnnotation({ ref: 'MISSING-003' }),
        makeAnnotation({
          ref: 'BAD',
          tagged: true,
          syntaxErrors: ['invalid syntax'],
        }),
      ];
      const registry: Registry = {
        'EXP-001': makeRegistryEntry({ expires: '2020-01-01' }),
        'EXP-002': makeRegistryEntry({ expires: '2020-01-01' }),
        'EXP-003': makeRegistryEntry({ expires: '2020-01-01' }),
        'EXP-004': makeRegistryEntry({ expires: '2020-01-01' }),
      };

      const result = report({
        scanResult: makeScanResult(annotations),
        registry,
        failOn: [],
        warnOn: [],
      });

      assert.equal(result.health.level, 'critical');
      assert.ok(result.health.score < 50);
    });

    it('score never goes below 0', () => {
      // Create many issues to try to push score negative
      const annotations = Array.from({ length: 20 }, (_, i) =>
        makeAnnotation({ ref: `MISS-${i}`, rule: 'no-any' }),
      );

      const result = report({
        scanResult: makeScanResult(annotations),
        registry: {},
        failOn: [],
        warnOn: [],
      });

      assert.ok(result.health.score >= 0);
    });
  });

  describe('totals', () => {
    it('reports correct totals', () => {
      const annotations = [
        makeAnnotation({ ref: 'TEST-001' }),
        makeAnnotation({ ref: 'TEST-002' }),
      ];
      const candidates: ShioriCandidate[] = [
        { pattern: 'eslint', location: { file: 'a.ts', line: 1 } },
      ];
      const registry: Registry = {
        'TEST-001': makeRegistryEntry(),
        'TEST-002': makeRegistryEntry(),
        'TEST-003': makeRegistryEntry(),
      };

      const result = report({
        scanResult: makeScanResult(annotations, candidates),
        registry,
        failOn: [],
        warnOn: [],
      });

      assert.equal(result.totals.annotations, 2);
      assert.equal(result.totals.candidates, 1);
      assert.equal(result.totals.registryEntries, 3);
    });
  });

  describe('insights', () => {
    it('generates expired insight', () => {
      const result = report({
        scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
        registry: {
          'TEST-001': makeRegistryEntry({ expires: '2020-01-01' }),
        },
        failOn: [],
        warnOn: [],
      });

      const expired = result.insights.find((i) => i.label === 'expired');
      assert.ok(expired);
      assert.equal(expired.level, 'error');
    });

    it('generates unregistered insight', () => {
      const result = report({
        scanResult: makeScanResult([makeAnnotation({ ref: 'MISSING-001' })]),
        registry: {},
        failOn: [],
        warnOn: [],
      });

      const unregistered = result.insights.find(
        (i) => i.label === 'unregistered',
      );
      assert.ok(unregistered);
      assert.equal(unregistered.level, 'warning');
    });

    it('generates stale insight for unused registry entries', () => {
      const result = report({
        scanResult: makeScanResult([]),
        registry: {
          'STALE-001': makeRegistryEntry(),
        },
        failOn: [],
        warnOn: [],
      });

      const stale = result.insights.find((i) => i.label === 'stale');
      assert.ok(stale);
      assert.equal(stale.level, 'warning');
    });

    it('generates candidates insight', () => {
      const candidates: ShioriCandidate[] = [
        { pattern: 'eslint', location: { file: 'a.ts', line: 1 } },
      ];

      const result = report({
        scanResult: makeScanResult([], candidates),
        registry: {},
        failOn: [],
        warnOn: [],
      });

      const candidateInsight = result.insights.find(
        (i) => i.label === 'candidates',
      );
      assert.ok(candidateInsight);
      assert.equal(candidateInsight.level, 'info');
    });

    it('generates clean insight when no issues', () => {
      const result = report({
        scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
        registry: {
          'TEST-001': makeRegistryEntry(),
        },
        failOn: [],
        warnOn: [],
      });

      const clean = result.insights.find((i) => i.label === 'clean');
      assert.ok(clean);
      assert.equal(clean.level, 'info');
    });
  });

  describe('breakdowns', () => {
    it('aggregates by rule', () => {
      const annotations = [
        makeAnnotation({ ref: 'TEST-001', rule: 'no-console' }),
        makeAnnotation({ ref: 'TEST-002', rule: 'no-console' }),
        makeAnnotation({ ref: 'TEST-003', rule: 'no-debugger' }),
      ];
      const registry: Registry = {
        'TEST-001': makeRegistryEntry(),
        'TEST-002': makeRegistryEntry(),
        'TEST-003': makeRegistryEntry(),
      };

      const result = report({
        scanResult: makeScanResult(annotations),
        registry,
        failOn: [],
        warnOn: [],
      });

      assert.equal(result.byRule.length, 2);
      // Sorted by count descending
      assert.equal(result.byRule[0]!.key, 'no-console');
      assert.equal(result.byRule[0]!.count, 2);
      assert.equal(result.byRule[1]!.key, 'no-debugger');
      assert.equal(result.byRule[1]!.count, 1);
    });

    it('aggregates by owner', () => {
      const registry: Registry = {
        'TEST-001': makeRegistryEntry({ owner: 'team-a' }),
        'TEST-002': makeRegistryEntry({ owner: 'team-a' }),
        'TEST-003': makeRegistryEntry({ owner: 'team-b' }),
      };

      const result = report({
        scanResult: makeScanResult([
          makeAnnotation({ ref: 'TEST-001' }),
          makeAnnotation({ ref: 'TEST-002' }),
          makeAnnotation({ ref: 'TEST-003' }),
        ]),
        registry,
        failOn: [],
        warnOn: [],
      });

      assert.equal(result.byOwner.length, 2);
      assert.equal(result.byOwner[0]!.key, 'team-a');
      assert.equal(result.byOwner[0]!.count, 2);
    });

    it('aggregates by kind', () => {
      const registry: Registry = {
        'TEST-001': makeRegistryEntry({ kind: 'suppression' }),
        'TEST-002': makeRegistryEntry({ kind: 'suppression' }),
        'TEST-003': makeRegistryEntry({ kind: 'decision' }),
      };

      const result = report({
        scanResult: makeScanResult([
          makeAnnotation({ ref: 'TEST-001' }),
          makeAnnotation({ ref: 'TEST-002' }),
          makeAnnotation({ ref: 'TEST-003' }),
        ]),
        registry,
        failOn: [],
        warnOn: [],
      });

      assert.equal(result.byKind.length, 2);
      assert.equal(result.byKind[0]!.key, 'suppression');
      assert.equal(result.byKind[0]!.count, 2);
    });

    it('excludes undefined rule/kind/owner', () => {
      const result = report({
        scanResult: makeScanResult([
          makeAnnotation({ ref: 'TEST-001', rule: undefined }),
        ]),
        registry: {
          'TEST-001': makeRegistryEntry({
            kind: undefined,
            owner: undefined,
          }),
        },
        failOn: [],
        warnOn: [],
      });

      assert.equal(result.byRule.length, 0);
      assert.equal(result.byKind.length, 0);
      assert.equal(result.byOwner.length, 0);
    });
  });

  describe('verifyResult passthrough', () => {
    it('includes underlying verifyResult', () => {
      const result = report({
        scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
        registry: {
          'TEST-001': makeRegistryEntry(),
        },
        failOn: [],
        warnOn: [],
      });

      assert.ok(result.verifyResult);
      assert.ok(result.verifyResult.timestamp);
      assert.ok(result.verifyResult.summary);
    });
  });

  describe('now injection', () => {
    it('uses provided now date for expiry checks', () => {
      const result = report({
        scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
        registry: {
          'TEST-001': makeRegistryEntry({ expires: '2026-06-01' }),
        },
        failOn: [],
        warnOn: [],
        now: new Date('2026-07-01T00:00:00Z'),
      });

      assert.equal(result.byType['expired'], 1);

      const result2 = report({
        scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
        registry: {
          'TEST-001': makeRegistryEntry({ expires: '2026-06-01' }),
        },
        failOn: [],
        warnOn: [],
        now: new Date('2026-05-01T00:00:00Z'),
      });

      assert.equal(result2.byType['expired'], 0);
    });
  });
});

describe('formatReport', () => {
  function makeReportResult(): ReportResult {
    return report({
      scanResult: makeScanResult(
        [
          makeAnnotation({ ref: 'TEST-001', rule: 'no-console' }),
          makeAnnotation({ ref: 'TEST-002', rule: 'no-debugger' }),
        ],
        [{ pattern: 'eslint', location: { file: 'a.ts', line: 1 } }],
      ),
      registry: {
        'TEST-001': makeRegistryEntry({ owner: 'team-a', kind: 'suppression' }),
        'TEST-002': makeRegistryEntry({ owner: 'team-b', kind: 'decision' }),
      },
      failOn: [],
      warnOn: [],
    });
  }

  it('formats as JSON', () => {
    const result = makeReportResult();
    const output = formatReport(result, 'json');
    const parsed = JSON.parse(output) as ReportResult;
    assert.equal(parsed.health.level, result.health.level);
    assert.equal(parsed.totals.annotations, 2);
  });

  it('formats as Markdown', () => {
    const result = makeReportResult();
    const output = formatReport(result, 'markdown');
    assert.ok(output.includes('# Shiori Governance Report'));
    assert.ok(output.includes('Health:'));
    assert.ok(output.includes('Overview'));
    assert.ok(output.includes('Insights'));
  });
});

describe('formatReportAsMarkdown', () => {
  it('includes all sections', () => {
    const result = report({
      scanResult: makeScanResult(
        [
          makeAnnotation({ ref: 'TEST-001', rule: 'no-console' }),
          makeAnnotation({ ref: 'MISSING-001', rule: 'no-any' }),
        ],
        [{ pattern: 'eslint', location: { file: 'a.ts', line: 1 } }],
      ),
      registry: {
        'TEST-001': makeRegistryEntry({
          owner: 'team-a',
          kind: 'suppression',
        }),
      },
      failOn: [],
      warnOn: [],
    });

    const md = formatReportAsMarkdown(result);

    assert.ok(md.includes('# Shiori Governance Report'));
    assert.ok(md.includes('## Health:'));
    assert.ok(md.includes('## Overview'));
    assert.ok(md.includes('## Insights'));
    assert.ok(md.includes('## Issues by Type'));
    assert.ok(md.includes('## Annotations by Rule'));
    assert.ok(md.includes('## Ownership'));
    assert.ok(md.includes('## Annotation Kinds'));
  });

  it('omits empty breakdown sections', () => {
    const result = report({
      scanResult: makeScanResult([
        makeAnnotation({ ref: 'TEST-001', rule: undefined }),
      ]),
      registry: {
        'TEST-001': makeRegistryEntry({ kind: undefined, owner: undefined }),
      },
      failOn: [],
      warnOn: [],
    });

    const md = formatReportAsMarkdown(result);

    assert.ok(!md.includes('## Annotations by Rule'));
    assert.ok(!md.includes('## Ownership'));
    assert.ok(!md.includes('## Annotation Kinds'));
  });

  it('shows correct health emoji', () => {
    // Healthy
    const healthy = report({
      scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
      registry: { 'TEST-001': makeRegistryEntry() },
      failOn: [],
      warnOn: [],
    });
    assert.ok(formatReportAsMarkdown(healthy).includes('🟢'));

    // Critical
    const annotations = Array.from({ length: 10 }, (_, i) =>
      makeAnnotation({ ref: `MISS-${i}` }),
    );
    const critical = report({
      scanResult: makeScanResult(annotations),
      registry: {
        // All expired
        ...Object.fromEntries(
          annotations.map((a) => [
            a.ref,
            makeRegistryEntry({ expires: '2020-01-01' }),
          ]),
        ),
      },
      failOn: [],
      warnOn: [],
    });
    // Should be warning or critical due to expired
    const md = formatReportAsMarkdown(critical);
    assert.ok(md.includes('🟡') || md.includes('🔴'));
  });
});
