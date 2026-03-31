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
  formatHealthSummary,
  interpretDualAxis,
} from '../src/commands/health.ts';
import { formatHealth } from '../src/commands/health-cli.ts';
import { isAtOrBelowLevel } from '../src/core/types.ts';
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
    kind: 'intentional',
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

  describe('triage suggestion', () => {
    it('appends triage insight when issues exist', () => {
      const result = health({
        scanResult: makeScanResult([makeAnnotation({ ref: 'MISS-001' })]),
        registry: {},
        failOn: [],
        warnOn: [],
      });

      // Has issues (missing-in-registry), so triage insight should exist
      assert.ok(result.issues.total > 0);
      const triageInsight = result.insights.find((i) => i.label === 'triage');
      assert.ok(triageInsight, 'triage insight should be present');
      assert.equal(triageInsight.level, 'info');
      assert.ok(triageInsight.message.includes('shiori triage'));
      assert.ok(triageInsight.message.includes('--triage'));
    });

    it('does not append triage insight when no issues exist', () => {
      const result = health({
        scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
        registry: {
          'TEST-001': makeRegistryEntry(),
        },
        failOn: [],
        warnOn: [],
      });

      assert.equal(result.issues.total, 0);
      const triageInsight = result.insights.find((i) => i.label === 'triage');
      assert.equal(triageInsight, undefined);
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
    const envelope = JSON.parse(output);
    assert.ok(envelope.meta, 'should have meta envelope');
    assert.equal(envelope.meta.command, 'health');
    assert.equal(envelope.meta.schemaVersion, 1);
    const parsed = envelope.data;
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

  it('shows trend with sparkline when present (EP-0145)', () => {
    const trendResult = makeTrendResult({
      direction: 'improving',
      scoreChange: 5,
      count: 3,
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
    assert.ok(output.includes('+5'));
    assert.ok(output.includes('3 pts'));
    // Sparkline block characters should be present (▁-█ range)
    assert.ok(
      /[▁▂▃▄▅▆▇█]/.test(output),
      'should contain sparkline block characters',
    );
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

  it('shows triage suggestion when issues exist', () => {
    const result = health({
      scanResult: makeScanResult([makeAnnotation({ ref: 'MISS-001' })]),
      registry: {},
      failOn: [],
      warnOn: [],
    });

    const output = formatHealthSummary(result);
    assert.ok(output.includes('shiori health --triage'));
  });

  it('omits triage suggestion when no issues', () => {
    const result = health({
      scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
      registry: {
        'TEST-001': makeRegistryEntry(),
      },
      failOn: [],
      warnOn: [],
    });

    const output = formatHealthSummary(result);
    assert.ok(!output.includes('--triage'));
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

  it('produces consistent box width across all lines including prescriptions', () => {
    const annotations = [
      makeAnnotation({ ref: 'EXP-001' }),
      makeAnnotation({ ref: 'MISS-001' }),
    ];
    const registry: Registry = {
      'EXP-001': makeRegistryEntry({ expires: '2020-01-01' }),
    };

    const result = health({
      scanResult: makeScanResult(annotations, [
        {
          pattern: 'eslint',
          rule: 'no-unused-vars',
          location: { file: 'a.ts', line: 1 },
          directive: 'eslint-disable-next-line',
        },
      ]),
      registry,
      failOn: [],
      warnOn: [],
    });

    const output = formatHealthSummary(result);
    const lines = output.split('\n');

    // All lines should have the same character length for the box border characters
    // Top and bottom lines use ┌─┐ and └─┘, middle separators use ├─┤
    // Content lines start with │ and end with │
    const topLine = lines[0]!;
    const bottomLine = lines[lines.length - 1]!;

    // Top line starts with ┌ and ends with ┐
    assert.ok(
      topLine.startsWith('┌'),
      `top line should start with ┌: ${topLine}`,
    );
    assert.ok(topLine.endsWith('┐'), `top line should end with ┐: ${topLine}`);

    // Bottom line starts with └ and ends with ┘
    assert.ok(
      bottomLine.startsWith('└'),
      `bottom line should start with └: ${bottomLine}`,
    );
    assert.ok(
      bottomLine.endsWith('┘'),
      `bottom line should end with ┘: ${bottomLine}`,
    );

    // All border lines (┌/├/└) should have the same length
    const borderLines = lines.filter(
      (l) => l.startsWith('┌') || l.startsWith('├') || l.startsWith('└'),
    );
    const borderLength = borderLines[0]!.length;
    for (const bl of borderLines) {
      assert.equal(
        bl.length,
        borderLength,
        `border line length mismatch: "${bl}" (${bl.length} vs ${borderLength})`,
      );
    }

    // All content lines should start with │ and end with │
    const contentLines = lines.filter((l) => l.startsWith('│'));
    for (const cl of contentLines) {
      assert.ok(cl.startsWith('│'), `content line should start with │: ${cl}`);
      assert.ok(cl.endsWith('│'), `content line should end with │: ${cl}`);
    }
  });
});

describe('interpretDualAxis (EP-0198)', () => {
  it('returns well-tracked message for both high', () => {
    const msg = interpretDualAxis(80, 90);
    assert.ok(msg.includes('well-tracked'));
  });

  it('returns hygiene gap message for high coverage / low hygiene', () => {
    const msg = interpretDualAxis(80, 50);
    assert.ok(msg.includes('lack expires or reason'));
    assert.ok(msg.includes('shiori triage'));
  });

  it('returns coverage gap message for low coverage / high hygiene', () => {
    const msg = interpretDualAxis(40, 90);
    assert.ok(msg.includes('Not all lint disables are tracked yet'));
    assert.ok(msg.includes('shiori adopt'));
  });

  it('returns both-low message for both below threshold', () => {
    const msg = interpretDualAxis(30, 40);
    assert.ok(msg.includes('both need improvement'));
  });

  it('treats exactly 70 as high', () => {
    const msg = interpretDualAxis(70, 70);
    assert.ok(msg.includes('well-tracked'));
  });

  it('treats 69 as low', () => {
    const msg = interpretDualAxis(69, 69);
    assert.ok(msg.includes('both need improvement'));
  });
});

describe('health diagnosis integration (EP-0198)', () => {
  it('includes diagnosis in HealthResult', () => {
    const result = health({
      scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
      registry: {
        'TEST-001': makeRegistryEntry(),
      },
      failOn: [],
      warnOn: [],
    });

    assert.ok(result.diagnosis);
    assert.ok(typeof result.diagnosis === 'string');
    assert.ok(result.diagnosis.length > 0);
  });

  it('shows diagnosis in formatHealthSummary', () => {
    const result = health({
      scanResult: makeScanResult([makeAnnotation({ ref: 'TEST-001' })]),
      registry: {
        'TEST-001': makeRegistryEntry(),
      },
      failOn: [],
      warnOn: [],
    });

    const output = formatHealthSummary(result);
    assert.ok(output.includes('📊'));
  });
});

describe('isAtOrBelowLevel', () => {
  it('critical is at or below critical', () => {
    assert.equal(isAtOrBelowLevel('critical', 'critical'), true);
  });

  it('critical is at or below warning', () => {
    assert.equal(isAtOrBelowLevel('critical', 'warning'), true);
  });

  it('critical is at or below healthy', () => {
    assert.equal(isAtOrBelowLevel('critical', 'healthy'), true);
  });

  it('warning is not at or below critical', () => {
    assert.equal(isAtOrBelowLevel('warning', 'critical'), false);
  });

  it('warning is at or below warning', () => {
    assert.equal(isAtOrBelowLevel('warning', 'warning'), true);
  });

  it('warning is at or below healthy', () => {
    assert.equal(isAtOrBelowLevel('warning', 'healthy'), true);
  });

  it('healthy is not at or below critical', () => {
    assert.equal(isAtOrBelowLevel('healthy', 'critical'), false);
  });

  it('healthy is not at or below warning', () => {
    assert.equal(isAtOrBelowLevel('healthy', 'warning'), false);
  });

  it('healthy is at or below healthy', () => {
    assert.equal(isAtOrBelowLevel('healthy', 'healthy'), true);
  });
});
