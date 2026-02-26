import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  Registry,
  RegistryEntry,
  ShioriAnnotation,
  ShioriCandidate,
  VerifyResult,
} from '../../src/core/types.ts';
import {
  formatAsSummary,
  type SummaryInput,
} from '../../src/formatters/summary.ts';

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
    target: 'all',
    expires: undefined,
    ticket: undefined,
    owner: undefined,
    notes: undefined,
    kind: undefined,
    ...overrides,
  };
}

function makeResult(overrides: Partial<VerifyResult> = {}): VerifyResult {
  return {
    timestamp: '2026-02-16T00:00:00.000Z',
    issues: [],
    summary: {
      total: 0,
      errors: 0,
      warnings: 0,
      byType: {
        'missing-in-registry': 0,
        'unused-in-source': 0,
        expired: 0,
        'syntax-error': 0,
        'ref-format': 0,
        'ref-collision': 0,
        'unrouted-ref': 0,
      },
    },
    scannedRecords: 0,
    registryEntries: 0,
    ...overrides,
  };
}

function makeInput(overrides: Partial<SummaryInput> = {}): SummaryInput {
  return {
    verifyResult: makeResult(),
    annotations: [],
    candidates: [],
    registry: {},
    ...overrides,
  };
}

describe('formatAsSummary', () => {
  it('returns zero counts for empty input', () => {
    const input = makeInput();
    const summary = JSON.parse(formatAsSummary(input)) as {
      totals: {
        annotations: number;
        candidates: number;
        expired: number;
        missing: number;
      };
      byRule: Record<string, number>;
      byKind: Record<string, number>;
      byOwner: Record<string, number>;
    };
    assert.equal(summary.totals.annotations, 0);
    assert.equal(summary.totals.candidates, 0);
    assert.equal(summary.totals.expired, 0);
    assert.equal(summary.totals.missing, 0);
    assert.deepEqual(summary.byRule, {});
    assert.deepEqual(summary.byKind, {});
    assert.deepEqual(summary.byOwner, {});
  });

  it('counts totals correctly', () => {
    const input = makeInput({
      verifyResult: makeResult({
        summary: {
          total: 3,
          errors: 2,
          warnings: 1,
          byType: {
            'missing-in-registry': 1,
            'unused-in-source': 0,
            expired: 2,
            'syntax-error': 0,
            'ref-format': 0,
            'ref-collision': 0,
            'unrouted-ref': 0,
          },
        },
      }),
      annotations: [
        makeAnnotation({ ref: 'SUP-001' }),
        makeAnnotation({ ref: 'SUP-002' }),
      ],
      candidates: [
        { pattern: 'eslint', location: { file: 'a.ts', line: 1 } },
      ] as ShioriCandidate[],
    });
    const summary = JSON.parse(formatAsSummary(input)) as {
      totals: {
        annotations: number;
        candidates: number;
        expired: number;
        missing: number;
      };
    };
    assert.equal(summary.totals.annotations, 2);
    assert.equal(summary.totals.candidates, 1);
    assert.equal(summary.totals.expired, 2);
    assert.equal(summary.totals.missing, 1);
  });

  it('aggregates by rule', () => {
    const input = makeInput({
      annotations: [
        makeAnnotation({ rule: 'no-console' }),
        makeAnnotation({ rule: 'no-console' }),
        makeAnnotation({ rule: 'no-debugger' }),
      ],
    });
    const summary = JSON.parse(formatAsSummary(input)) as {
      byRule: Record<string, number>;
    };
    assert.equal(summary.byRule['no-console'], 2);
    assert.equal(summary.byRule['no-debugger'], 1);
  });

  it('excludes undefined rules from byRule', () => {
    const input = makeInput({
      annotations: [
        makeAnnotation({ rule: undefined }),
        makeAnnotation({ rule: 'no-console' }),
      ],
    });
    const summary = JSON.parse(formatAsSummary(input)) as {
      byRule: Record<string, number>;
    };
    assert.equal(Object.keys(summary.byRule).length, 1);
    assert.equal(summary.byRule['no-console'], 1);
  });

  it('aggregates by kind', () => {
    const registry: Registry = {
      'SUP-001': makeRegistryEntry({ kind: 'suppression' }),
      'SUP-002': makeRegistryEntry({ kind: 'suppression' }),
      'ADR-001': makeRegistryEntry({ kind: 'decision' }),
    };
    const input = makeInput({ registry });
    const summary = JSON.parse(formatAsSummary(input)) as {
      byKind: Record<string, number>;
    };
    assert.equal(summary.byKind['suppression'], 2);
    assert.equal(summary.byKind['decision'], 1);
  });

  it('excludes undefined kind from byKind', () => {
    const registry: Registry = {
      'SUP-001': makeRegistryEntry({ kind: undefined }),
      'SUP-002': makeRegistryEntry({ kind: 'suppression' }),
    };
    const input = makeInput({ registry });
    const summary = JSON.parse(formatAsSummary(input)) as {
      byKind: Record<string, number>;
    };
    assert.equal(Object.keys(summary.byKind).length, 1);
  });

  it('aggregates by owner', () => {
    const registry: Registry = {
      'SUP-001': makeRegistryEntry({ owner: 'team-a' }),
      'SUP-002': makeRegistryEntry({ owner: 'team-a' }),
      'SUP-003': makeRegistryEntry({ owner: 'team-b' }),
    };
    const input = makeInput({ registry });
    const summary = JSON.parse(formatAsSummary(input)) as {
      byOwner: Record<string, number>;
    };
    assert.equal(summary.byOwner['team-a'], 2);
    assert.equal(summary.byOwner['team-b'], 1);
  });

  it('excludes undefined owner from byOwner', () => {
    const registry: Registry = {
      'SUP-001': makeRegistryEntry({ owner: undefined }),
      'SUP-002': makeRegistryEntry({ owner: 'team-a' }),
    };
    const input = makeInput({ registry });
    const summary = JSON.parse(formatAsSummary(input)) as {
      byOwner: Record<string, number>;
    };
    assert.equal(Object.keys(summary.byOwner).length, 1);
  });
});
