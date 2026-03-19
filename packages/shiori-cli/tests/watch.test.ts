import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  ScanResult,
  ShioriAnnotation,
  RegistryEntry,
} from '../src/core/types.ts';
import { watchReport } from '../src/commands/watch.ts';

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

function makeScanResult(annotations: ShioriAnnotation[] = []): ScanResult {
  return {
    annotations,
    candidates: [],
    filesScanned: 1,
  };
}

describe('watchReport', () => {
  it('generates a ReportResult from scan result and registry', () => {
    const annotation = makeAnnotation();
    const scanResult = makeScanResult([annotation]);
    const registry = { 'TEST-001': makeRegistryEntry() };

    const result = watchReport({
      scanResult,
      registry,
      failOn: [],
      warnOn: [],
    });

    assert.equal(result.health.level, 'healthy');
    assert.equal(result.health.score, 100);
    assert.equal(result.totals.annotations, 1);
    assert.equal(result.totals.registryEntries, 1);
    assert.equal(result.totals.issues, 0);
  });

  it('detects missing-in-registry issues', () => {
    const annotation = makeAnnotation({ ref: 'MISSING-001' });
    const scanResult = makeScanResult([annotation]);
    const registry = {};

    const result = watchReport({
      scanResult,
      registry,
      failOn: [],
      warnOn: [],
    });

    assert.ok(result.health.score < 100);
    assert.ok(result.totals.issues > 0);
    assert.ok(result.verifyResult.summary.byType['missing-in-registry'] > 0);
  });

  it('passes refPatterns through to verify', () => {
    const annotation = makeAnnotation({ ref: 'SUP-001' });
    const scanResult = makeScanResult([annotation]);
    const registry = { 'SUP-001': makeRegistryEntry() };

    const result = watchReport({
      scanResult,
      registry,
      failOn: [],
      warnOn: [],
      refPatterns: [{ match: '^SUP-', registryFile: 'sup-registry.json' }],
    });

    // With refPatterns but no refOrigins, routing mismatch may occur
    assert.ok(result.timestamp);
    assert.equal(result.totals.annotations, 1);
  });

  it('includes health insights in result', () => {
    const annotation = makeAnnotation();
    const scanResult = makeScanResult([annotation]);
    const registry = { 'TEST-001': makeRegistryEntry() };

    const result = watchReport({
      scanResult,
      registry,
      failOn: [],
      warnOn: [],
    });

    assert.ok(Array.isArray(result.insights));
    assert.ok(result.insights.length > 0);
  });
});
