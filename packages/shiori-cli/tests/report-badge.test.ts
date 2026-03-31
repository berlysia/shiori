import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { report } from '../src/commands/report.ts';
import {
  formatReportAsBadge,
  type ShieldsBadge,
} from '../src/formatters/report-formatter.ts';
import type {
  ScanResult,
  Registry,
  ShioriAnnotation,
  ShioriCandidate,
  ReportResult,
  MaturityLevel,
} from '../src/core/types.ts';
import { makeRegistryEntry } from './helpers/registry.ts';
import { maturityStageFromLevel } from '../src/core/types.ts';

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

function makeScanResult(
  annotations: ShioriAnnotation[] = [],
  candidates: ShioriCandidate[] = [],
): ScanResult {
  return { annotations, candidates, filesScanned: 1 };
}

function makeReport(overrides: {
  annotations?: ShioriAnnotation[];
  candidates?: ShioriCandidate[];
  registry?: Registry;
  now?: Date;
}): ReportResult {
  const annotations = overrides.annotations ?? [
    makeAnnotation({ ref: 'TEST-001' }),
  ];
  const candidates = overrides.candidates ?? [];
  const registry = overrides.registry ?? {
    'TEST-001': makeRegistryEntry({ kind: 'intentional' }),
  };
  return report({
    scanResult: makeScanResult(annotations, candidates),
    registry,
    failOn: [],
    warnOn: [],
    now: overrides.now,
  });
}

describe('formatReportAsBadge', () => {
  it('outputs valid shields.io endpoint JSON', () => {
    const result = makeReport({});
    const output = formatReportAsBadge(result);
    const badge = JSON.parse(output) as ShieldsBadge;

    assert.equal(badge.schemaVersion, 1);
    assert.equal(badge.label, 'governance');
    assert.equal(typeof badge.message, 'string');
    assert.ok(
      ['brightgreen', 'yellow', 'red'].includes(badge.color),
      `unexpected color: ${badge.color}`,
    );
  });

  it('shows brightgreen for healthy score (≥80)', () => {
    const result = makeReport({});
    assert.equal(result.health.score, 100);
    assert.equal(result.health.level, 'healthy');

    const badge = JSON.parse(formatReportAsBadge(result)) as ShieldsBadge;
    assert.equal(badge.color, 'brightgreen');
    assert.equal(badge.message, '100/100');
  });

  it('shows yellow for warning score (50-79)', () => {
    const annotations = Array.from({ length: 5 }, (_, i) =>
      makeAnnotation({ ref: `EXP-${i}` }),
    );
    const registry: Registry = Object.fromEntries(
      annotations.map((a) => [
        a.ref,
        makeRegistryEntry({ expires: '2020-01-01' }),
      ]),
    );
    const result = makeReport({ annotations, registry });

    assert.equal(result.health.level, 'warning');
    const badge = JSON.parse(formatReportAsBadge(result)) as ShieldsBadge;
    assert.equal(badge.color, 'yellow');
    assert.ok(badge.message.includes('/100'));
  });

  it('shows red for critical score (<50)', () => {
    const annotations = [
      ...Array.from({ length: 5 }, (_, i) =>
        makeAnnotation({ ref: `EXP-${i}` }),
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        makeAnnotation({ ref: `MISS-${i}` }),
      ),
    ];
    const registry: Registry = Object.fromEntries(
      annotations
        .slice(0, 5)
        .map((a) => [a.ref, makeRegistryEntry({ expires: '2020-01-01' })]),
    );
    const result = makeReport({ annotations, registry });

    assert.equal(result.health.level, 'critical');
    const badge = JSON.parse(formatReportAsBadge(result)) as ShieldsBadge;
    assert.equal(badge.color, 'red');
  });

  it('message format is score/100', () => {
    const result = makeReport({});
    const badge = JSON.parse(formatReportAsBadge(result)) as ShieldsBadge;
    assert.match(badge.message, /^\d+\/100$/);
  });

  it('produces pretty-printed JSON', () => {
    const result = makeReport({});
    const output = formatReportAsBadge(result);
    // Pretty-printed JSON has newlines
    assert.ok(output.includes('\n'));
    // Round-trip: parse and re-stringify preserves output
    assert.equal(JSON.stringify(JSON.parse(output), null, 2), output);
  });

  it('omits stage when maturityLevel is not provided', () => {
    const result = makeReport({});
    const badge = JSON.parse(formatReportAsBadge(result)) as ShieldsBadge;
    assert.equal(badge.stage, undefined);
  });

  it('includes stage Discover for maturity level 0', () => {
    const result = makeReport({});
    const badge = JSON.parse(formatReportAsBadge(result, 0)) as ShieldsBadge;
    assert.equal(badge.stage, 'Discover');
  });

  it('includes stage Adopt for maturity level 1', () => {
    const result = makeReport({});
    const badge = JSON.parse(formatReportAsBadge(result, 1)) as ShieldsBadge;
    assert.equal(badge.stage, 'Adopt');
  });

  it('includes stage Adopt for maturity level 2', () => {
    const result = makeReport({});
    const badge = JSON.parse(formatReportAsBadge(result, 2)) as ShieldsBadge;
    assert.equal(badge.stage, 'Adopt');
  });

  it('includes stage Enforce for maturity level 3', () => {
    const result = makeReport({});
    const badge = JSON.parse(formatReportAsBadge(result, 3)) as ShieldsBadge;
    assert.equal(badge.stage, 'Enforce');
  });

  it('includes stage Enforce for maturity level 4', () => {
    const result = makeReport({});
    const badge = JSON.parse(formatReportAsBadge(result, 4)) as ShieldsBadge;
    assert.equal(badge.stage, 'Enforce');
  });
});

describe('maturityStageFromLevel', () => {
  it('maps level 0 to Discover', () => {
    assert.equal(maturityStageFromLevel(0), 'Discover');
  });

  it('maps level 1 to Adopt', () => {
    assert.equal(maturityStageFromLevel(1), 'Adopt');
  });

  it('maps level 2 to Adopt', () => {
    assert.equal(maturityStageFromLevel(2), 'Adopt');
  });

  it('maps level 3 to Enforce', () => {
    assert.equal(maturityStageFromLevel(3), 'Enforce');
  });

  it('maps level 4 to Enforce', () => {
    assert.equal(maturityStageFromLevel(4), 'Enforce');
  });

  it('covers all MaturityLevel values', () => {
    const levels: MaturityLevel[] = [0, 1, 2, 3, 4];
    const validStages = ['Discover', 'Adopt', 'Enforce'];
    for (const level of levels) {
      const stage = maturityStageFromLevel(level);
      assert.ok(
        validStages.includes(stage),
        `Level ${level} mapped to unexpected stage: ${stage}`,
      );
    }
  });
});
