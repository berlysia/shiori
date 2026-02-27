import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatReportAsBadge,
  type ShieldsBadge,
} from '../../src/formatters/badge.ts';
import type {
  ScanResult,
  Registry,
  RegistryEntry,
  ShioriAnnotation,
  ShioriCandidate,
} from '../../src/core/types.ts';
import { report, type ReportResult } from '../../src/commands/report.ts';

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
    'TEST-001': makeRegistryEntry(),
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
    // Create enough expired entries to push score into warning range
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
    // Many expired + missing to push score below 50
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
});
