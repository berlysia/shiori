import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  ScanResult,
  Registry,
  RegistryEntry,
  ShioriAnnotation,
  ShioriCandidate,
  TrendResult,
  PitchResult,
} from '../src/core/types.ts';
import { pitch, formatPitchAsMarkdown } from '../src/commands/pitch.ts';
import { formatPitch } from '../src/commands/pitch-cli.ts';
import { report } from '../src/commands/report.ts';
import { triage } from '../src/commands/triage.ts';

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

describe('pitch', () => {
  describe('basic result', () => {
    it('returns pitch for healthy codebase', () => {
      const scanResult = makeScanResult([makeAnnotation({ ref: 'TEST-001' })]);
      const registry: Registry = {
        'TEST-001': makeRegistryEntry(),
      };
      const reportResult = report({
        scanResult,
        registry,
        failOn: [],
        warnOn: [],
      });

      const result = pitch({
        reportResult,
        teamName: 'My Team',
      });

      assert.equal(result.health.score, 100);
      assert.equal(result.health.level, 'healthy');
      assert.equal(result.teamName, 'My Team');
      assert.ok(result.headline.includes('My Team'));
      assert.ok(result.headline.includes('100/100'));
      assert.ok(result.highlights.length > 0);
      assert.ok(result.nextSteps.length > 0);
      assert.equal(result.trend, undefined);
    });

    it('includes health highlight in all cases', () => {
      const scanResult = makeScanResult([makeAnnotation({ ref: 'TEST-001' })]);
      const reportResult = report({
        scanResult,
        registry: { 'TEST-001': makeRegistryEntry() },
        failOn: [],
        warnOn: [],
      });

      const result = pitch({
        reportResult,
        teamName: 'Team A',
      });

      const healthHighlight = result.highlights.find(
        (h) => h.category === 'health',
      );
      assert.ok(healthHighlight);
      assert.ok(healthHighlight.message.includes('100/100'));
    });
  });

  describe('headline variants', () => {
    it('shows enforce-ready headline for healthy score', () => {
      const scanResult = makeScanResult([makeAnnotation({ ref: 'TEST-001' })]);
      const reportResult = report({
        scanResult,
        registry: { 'TEST-001': makeRegistryEntry() },
        failOn: [],
        warnOn: [],
      });

      const result = pitch({ reportResult, teamName: 'X' });
      assert.ok(result.headline.includes('enforce'));
    });

    it('shows quick-wins headline for warning-level score', () => {
      const annotations = Array.from({ length: 5 }, (_, i) =>
        makeAnnotation({ ref: `MISS-${i}` }),
      );
      const reportResult = report({
        scanResult: makeScanResult(annotations),
        registry: {},
        failOn: [],
        warnOn: [],
      });

      // Score should be in warning range (50-79)
      assert.ok(reportResult.health.score >= 50);
      assert.ok(reportResult.health.score < 80);

      const result = pitch({ reportResult, teamName: 'Y' });
      assert.ok(result.headline.includes('quick wins'));
    });

    it('shows high-impact headline for critical score', () => {
      // Combine expired (max -40) + missing-in-registry (max -30) to push below 50
      const expired = Array.from({ length: 5 }, (_, i) =>
        makeAnnotation({ ref: `EXP-${i}` }),
      );
      const missing = Array.from({ length: 6 }, (_, i) =>
        makeAnnotation({ ref: `MISS-${i}` }),
      );
      const annotations = [...expired, ...missing];
      const registry: Registry = {};
      for (const a of expired) {
        registry[a.ref] = makeRegistryEntry({ expires: '2020-01-01' });
      }
      // missing refs NOT in registry → missing-in-registry issues

      const reportResult = report({
        scanResult: makeScanResult(annotations),
        registry,
        failOn: [],
        warnOn: [],
      });

      assert.ok(
        reportResult.health.score < 50,
        `Expected score < 50, got ${reportResult.health.score}`,
      );

      const result = pitch({ reportResult, teamName: 'Z' });
      assert.ok(result.headline.includes('high-impact'));
    });
  });

  describe('coverage highlight', () => {
    it('shows coverage when candidates exist', () => {
      const scanResult = makeScanResult(
        [makeAnnotation({ ref: 'TEST-001' })],
        [
          {
            pattern: 'eslint',
            rule: 'no-unused-vars',
            location: { file: 'a.ts', line: 1 },
            directive: 'eslint-disable-next-line',
          },
        ],
      );
      const reportResult = report({
        scanResult,
        registry: { 'TEST-001': makeRegistryEntry() },
        failOn: [],
        warnOn: [],
      });

      const result = pitch({ reportResult, teamName: 'T' });

      const coverageHighlight = result.highlights.find(
        (h) => h.category === 'coverage',
      );
      assert.ok(coverageHighlight);
      assert.ok(coverageHighlight.message.includes('50%'));
      assert.ok(coverageHighlight.message.includes('1 tracked'));
      assert.ok(coverageHighlight.message.includes('1 untracked'));
    });
  });

  describe('trend integration', () => {
    it('includes trend in result when provided', () => {
      const scanResult = makeScanResult([makeAnnotation({ ref: 'TEST-001' })]);
      const reportResult = report({
        scanResult,
        registry: { 'TEST-001': makeRegistryEntry() },
        failOn: [],
        warnOn: [],
      });
      const trendResult = makeTrendResult();

      const result = pitch({
        reportResult,
        trendResult,
        teamName: 'T',
      });

      assert.ok(result.trend);
      assert.equal(result.trend.direction, 'improving');
      assert.equal(result.trend.scoreChange, 10);
      assert.equal(result.trend.dataPoints, 2);
    });

    it('adds trend highlight when available', () => {
      const scanResult = makeScanResult([makeAnnotation({ ref: 'TEST-001' })]);
      const reportResult = report({
        scanResult,
        registry: { 'TEST-001': makeRegistryEntry() },
        failOn: [],
        warnOn: [],
      });
      const trendResult = makeTrendResult({
        direction: 'declining',
        scoreChange: -3,
      });

      const result = pitch({
        reportResult,
        trendResult,
        teamName: 'T',
      });

      const trendHighlight = result.highlights.find(
        (h) => h.category === 'trend',
      );
      assert.ok(trendHighlight);
      assert.ok(trendHighlight.message.includes('declining'));
    });

    it('omits trend when no data points', () => {
      const scanResult = makeScanResult([makeAnnotation({ ref: 'TEST-001' })]);
      const reportResult = report({
        scanResult,
        registry: { 'TEST-001': makeRegistryEntry() },
        failOn: [],
        warnOn: [],
      });
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

      const result = pitch({
        reportResult,
        trendResult: emptyTrend,
        teamName: 'T',
      });

      assert.equal(result.trend, undefined);
    });
  });

  describe('triage integration', () => {
    it('includes risk highlight when urgent issues exist', () => {
      const annotations = [
        makeAnnotation({ ref: 'EXP-001' }),
        makeAnnotation({ ref: 'MISS-001' }),
      ];
      const registry: Registry = {
        'EXP-001': makeRegistryEntry({ expires: '2020-01-01' }),
      };
      const scanResult = makeScanResult(annotations);
      const reportResult = report({
        scanResult,
        registry,
        failOn: [],
        warnOn: [],
      });
      const triageResult = triage({
        scanResult,
        registry,
        failOn: [],
        warnOn: [],
      });

      const result = pitch({
        reportResult,
        triageResult,
        teamName: 'T',
      });

      const riskHighlight = result.highlights.find(
        (h) => h.category === 'risk',
      );
      assert.ok(riskHighlight);
      assert.ok(riskHighlight.message.includes('urgent'));
    });
  });

  describe('expired highlight', () => {
    it('shows expired count when annotations are expired', () => {
      const annotations = [makeAnnotation({ ref: 'EXP-001' })];
      const registry: Registry = {
        'EXP-001': makeRegistryEntry({ expires: '2020-01-01' }),
      };
      const reportResult = report({
        scanResult: makeScanResult(annotations),
        registry,
        failOn: [],
        warnOn: [],
      });

      const result = pitch({ reportResult, teamName: 'T' });

      const expiredHighlight = result.highlights.find(
        (h) => h.category === 'expired',
      );
      assert.ok(expiredHighlight);
      assert.ok(expiredHighlight.message.includes('1'));
    });
  });

  describe('next steps', () => {
    it('suggests triage --expired-only for expired annotations', () => {
      const annotations = [makeAnnotation({ ref: 'EXP-001' })];
      const registry: Registry = {
        'EXP-001': makeRegistryEntry({ expires: '2020-01-01' }),
      };
      const reportResult = report({
        scanResult: makeScanResult(annotations),
        registry,
        failOn: [],
        warnOn: [],
      });

      const result = pitch({ reportResult, teamName: 'T' });
      assert.ok(
        result.nextSteps.some((s) => s.includes('triage --expired-only')),
      );
    });

    it('suggests update for missing refs', () => {
      const reportResult = report({
        scanResult: makeScanResult([makeAnnotation({ ref: 'MISS-001' })]),
        registry: {},
        failOn: [],
        warnOn: [],
      });

      const result = pitch({ reportResult, teamName: 'T' });
      assert.ok(result.nextSteps.some((s) => s.includes('update')));
    });

    it('suggests adopt when candidates exist', () => {
      const scanResult = makeScanResult(
        [makeAnnotation({ ref: 'TEST-001' })],
        [
          {
            pattern: 'eslint',
            rule: 'no-unused-vars',
            location: { file: 'a.ts', line: 1 },
            directive: 'eslint-disable-next-line',
          },
        ],
      );
      const reportResult = report({
        scanResult,
        registry: { 'TEST-001': makeRegistryEntry() },
        failOn: [],
        warnOn: [],
      });

      const result = pitch({ reportResult, teamName: 'T' });
      assert.ok(result.nextSteps.some((s) => s.includes('adopt')));
    });

    it('suggests CI enforcement when healthy', () => {
      const reportResult = report({
        scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
        registry: { 'TEST-001': makeRegistryEntry() },
        failOn: [],
        warnOn: [],
      });

      const result = pitch({ reportResult, teamName: 'T' });
      assert.ok(result.nextSteps.some((s) => s.includes('check --fail-on')));
    });

    it('suggests snapshot when no trend data', () => {
      const reportResult = report({
        scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
        registry: { 'TEST-001': makeRegistryEntry() },
        failOn: [],
        warnOn: [],
      });

      const result = pitch({ reportResult, teamName: 'T' });
      assert.ok(result.nextSteps.some((s) => s.includes('--snapshot')));
    });
  });
});

describe('formatPitchAsMarkdown', () => {
  it('generates valid markdown with headline', () => {
    const reportResult = report({
      scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
      registry: { 'TEST-001': makeRegistryEntry() },
      failOn: [],
      warnOn: [],
    });
    const result = pitch({ reportResult, teamName: 'My Team' });

    const md = formatPitchAsMarkdown(result);

    assert.ok(md.startsWith('# My Team:'));
    assert.ok(md.includes('**Governance Health:**'));
    assert.ok(md.includes('100/100'));
    assert.ok(md.includes('## Key Findings'));
    assert.ok(md.includes('## Recommended Next Steps'));
    assert.ok(md.includes('shiori pitch'));
  });

  it('includes trend section when available', () => {
    const reportResult = report({
      scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
      registry: { 'TEST-001': makeRegistryEntry() },
      failOn: [],
      warnOn: [],
    });
    const trendResult = makeTrendResult();
    const result = pitch({ reportResult, trendResult, teamName: 'T' });

    const md = formatPitchAsMarkdown(result);
    assert.ok(md.includes('## Trend'));
    assert.ok(md.includes('improving'));
    assert.ok(md.includes('+10'));
  });

  it('omits trend section when no trend', () => {
    const reportResult = report({
      scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
      registry: { 'TEST-001': makeRegistryEntry() },
      failOn: [],
      warnOn: [],
    });
    const result = pitch({ reportResult, teamName: 'T' });

    const md = formatPitchAsMarkdown(result);
    assert.ok(!md.includes('## Trend'));
  });
});

describe('formatPitch', () => {
  it('formats as JSON with schema envelope', () => {
    const reportResult = report({
      scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
      registry: { 'TEST-001': makeRegistryEntry() },
      failOn: [],
      warnOn: [],
    });
    const result = pitch({ reportResult, teamName: 'T' });

    const output = formatPitch(result, 'json');
    const envelope = JSON.parse(output);
    assert.ok(envelope.meta);
    assert.equal(envelope.meta.command, 'pitch');
    assert.equal(envelope.meta.schemaVersion, 1);
    assert.ok(envelope.data);
    assert.equal(envelope.data.health.score, 100);
    assert.equal(envelope.data.teamName, 'T');
  });

  it('formats as markdown', () => {
    const reportResult = report({
      scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
      registry: { 'TEST-001': makeRegistryEntry() },
      failOn: [],
      warnOn: [],
    });
    const result = pitch({ reportResult, teamName: 'T' });

    const output = formatPitch(result, 'markdown');
    assert.ok(output.startsWith('# T:'));
    assert.ok(output.includes('Governance Health'));
  });
});

describe('graceful degradation', () => {
  it('works with empty registry (zero annotations)', () => {
    const reportResult = report({
      scanResult: makeScanResult(),
      registry: {},
      failOn: [],
      warnOn: [],
    });

    const result = pitch({ reportResult, teamName: 'Empty Project' });

    assert.equal(result.health.score, 100);
    assert.equal(result.health.level, 'healthy');
    assert.ok(result.headline.includes('Empty Project'));
    assert.ok(result.highlights.length > 0);
  });

  it('works without trendResult', () => {
    const reportResult = report({
      scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
      registry: { 'TEST-001': makeRegistryEntry() },
      failOn: [],
      warnOn: [],
    });

    const result = pitch({ reportResult, teamName: 'T' });
    assert.equal(result.trend, undefined);
  });

  it('works without triageResult', () => {
    const reportResult = report({
      scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
      registry: { 'TEST-001': makeRegistryEntry() },
      failOn: [],
      warnOn: [],
    });

    const result = pitch({ reportResult, teamName: 'T' });
    // Should not crash, no risk highlight
    const riskHighlight = result.highlights.find((h) => h.category === 'risk');
    assert.equal(riskHighlight, undefined);
  });
});
