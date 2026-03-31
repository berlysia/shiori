import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  ScanResult,
  Registry,
  ShioriAnnotation,
  ShioriCandidate,
  VerifyResult,
  VerifyIssue,
  ImpactResult,
} from '../src/core/types.ts';
import {
  computeImpact,
  formatImpact,
  formatImpactMarkdown,
} from '../src/commands/impact.ts';
import { makeRegistryEntry } from './helpers/registry.ts';

// ── Test helpers ────────────────────────────────────────────

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
  return {
    annotations,
    candidates,
    filesScanned: 1,
  };
}

function makeVerifyResult(
  issues: VerifyIssue[] = [],
  overrides: Partial<VerifyResult> = {},
): VerifyResult {
  const byType = {
    'missing-in-registry': 0,
    'unused-in-source': 0,
    expired: 0,
    'syntax-error': 0,
    'ref-format': 0,
    'ref-collision': 0,
    'unrouted-ref': 0,
    'registry-routing-mismatch': 0,
    'expiring-soon': 0,
    'ref-status-closed': 0,
    'intentional-without-reason': 0,
    'temporary-without-expires': 0,
  };
  for (const issue of issues) {
    byType[issue.type]++;
  }
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    issues,
    summary: {
      total: issues.length,
      errors: issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity === 'warning').length,
      byType,
    },
    scannedRecords: 5,
    registryEntries: 5,
    ...overrides,
  };
}

function makeIssue(overrides: Partial<VerifyIssue> = {}): VerifyIssue {
  return {
    type: 'expired',
    severity: 'error',
    ref: 'TEST-001',
    message: 'Annotation has expired',
    file: 'test.ts',
    line: 1,
    ...overrides,
  };
}

// ── computeImpact ───────────────────────────────────────────

describe('computeImpact', () => {
  it('returns perfect scores for owner with no issues', () => {
    const registry: Registry = {
      'TEST-001': makeRegistryEntry({ owner: 'alice' }),
      'TEST-002': makeRegistryEntry({ owner: 'alice' }),
    };
    const annotations = [
      makeAnnotation({ ref: 'TEST-001' }),
      makeAnnotation({ ref: 'TEST-002', location: { file: 'b.ts', line: 2 } }),
    ];
    const scanResult = makeScanResult(annotations);
    const verifyResult = makeVerifyResult();

    const result = computeImpact({
      owner: 'alice',
      scanResult,
      registry,
      verifyResult,
    });

    assert.equal(result.owner, 'alice');
    assert.equal(result.coverage, 100);
    assert.equal(result.hygiene, 100);
    assert.equal(result.annotationCount, 2);
    assert.equal(result.refs.length, 2);
    assert.equal(result.prescriptions.length, 0);
  });

  it('filters annotations to the specified owner only', () => {
    const registry: Registry = {
      'ALICE-001': makeRegistryEntry({ owner: 'alice' }),
      'BOB-001': makeRegistryEntry({ owner: 'bob' }),
    };
    const annotations = [
      makeAnnotation({ ref: 'ALICE-001' }),
      makeAnnotation({ ref: 'BOB-001', location: { file: 'bob.ts', line: 5 } }),
    ];
    const scanResult = makeScanResult(annotations);
    const verifyResult = makeVerifyResult();

    const result = computeImpact({
      owner: 'alice',
      scanResult,
      registry,
      verifyResult,
    });

    assert.equal(result.annotationCount, 1);
    assert.equal(result.refs.length, 1);
    assert.equal(result.refs[0]!.ref, 'ALICE-001');
  });

  it('includes registry-only refs with no source annotations', () => {
    const registry: Registry = {
      'TEST-001': makeRegistryEntry({ owner: 'alice' }),
      'TEST-002': makeRegistryEntry({ owner: 'alice' }),
    };
    // Only TEST-001 has a source annotation
    const annotations = [makeAnnotation({ ref: 'TEST-001' })];
    const scanResult = makeScanResult(annotations);
    const verifyResult = makeVerifyResult();

    const result = computeImpact({
      owner: 'alice',
      scanResult,
      registry,
      verifyResult,
    });

    assert.equal(result.annotationCount, 1);
    // Both refs should appear (TEST-002 from registry only)
    assert.equal(result.refs.length, 2);
    const refNames = result.refs.map((r) => r.ref).sort();
    assert.deepEqual(refNames, ['TEST-001', 'TEST-002']);

    // TEST-002 should have empty locations
    const test002 = result.refs.find((r) => r.ref === 'TEST-002')!;
    assert.equal(test002.locations.length, 0);
  });

  it('calculates coverage with candidates in denominator', () => {
    const registry: Registry = {
      'TEST-001': makeRegistryEntry({ owner: 'alice' }),
    };
    const annotations = [makeAnnotation({ ref: 'TEST-001' })];
    const candidates: ShioriCandidate[] = [
      {
        pattern: 'eslint',
        rule: 'no-console',
        location: { file: 'c.ts', line: 10 },
      },
      {
        pattern: 'eslint',
        rule: 'no-console',
        location: { file: 'd.ts', line: 20 },
      },
      {
        pattern: 'eslint',
        rule: 'no-console',
        location: { file: 'e.ts', line: 30 },
      },
    ];
    const scanResult = makeScanResult(annotations, candidates);
    const verifyResult = makeVerifyResult();

    const result = computeImpact({
      owner: 'alice',
      scanResult,
      registry,
      verifyResult,
    });

    // 1 annotation / (1 annotation + 3 candidates) = 25%
    assert.equal(result.coverage, 25);
  });

  it('returns 100 coverage when no annotations and no candidates', () => {
    const registry: Registry = {
      'TEST-001': makeRegistryEntry({ owner: 'alice' }),
    };
    const scanResult = makeScanResult([], []);
    const verifyResult = makeVerifyResult();

    const result = computeImpact({
      owner: 'alice',
      scanResult,
      registry,
      verifyResult,
    });

    assert.equal(result.coverage, 100);
  });

  it('deducts hygiene from owner issues using DEDUCTION_TIERS', () => {
    const registry: Registry = {
      'TEST-001': makeRegistryEntry({ owner: 'alice' }),
    };
    const annotations = [makeAnnotation({ ref: 'TEST-001' })];
    const scanResult = makeScanResult(annotations);
    const issues = [
      makeIssue({ ref: 'TEST-001', type: 'expired', severity: 'error' }),
    ];
    const verifyResult = makeVerifyResult(issues);

    const result = computeImpact({
      owner: 'alice',
      scanResult,
      registry,
      verifyResult,
    });

    // expired is critical tier: 10pt/issue, so 100 - 10 = 90
    assert.equal(result.hygiene, 90);
  });

  it('does not deduct hygiene for other owners issues', () => {
    const registry: Registry = {
      'ALICE-001': makeRegistryEntry({ owner: 'alice' }),
      'BOB-001': makeRegistryEntry({ owner: 'bob' }),
    };
    const annotations = [
      makeAnnotation({ ref: 'ALICE-001' }),
      makeAnnotation({ ref: 'BOB-001', location: { file: 'bob.ts', line: 5 } }),
    ];
    const scanResult = makeScanResult(annotations);
    // Only bob's ref has an issue
    const issues = [
      makeIssue({ ref: 'BOB-001', type: 'expired', severity: 'error' }),
    ];
    const verifyResult = makeVerifyResult(issues);

    const result = computeImpact({
      owner: 'alice',
      scanResult,
      registry,
      verifyResult,
    });

    assert.equal(result.hygiene, 100);
  });

  it('generates prescriptions for fixable issues', () => {
    const registry: Registry = {
      'TEST-001': makeRegistryEntry({ owner: 'alice' }),
    };
    const annotations = [makeAnnotation({ ref: 'TEST-001' })];
    const scanResult = makeScanResult(annotations);
    const issues = [
      makeIssue({ ref: 'TEST-001', type: 'expired', severity: 'error' }),
      makeIssue({
        ref: 'TEST-001',
        type: 'missing-in-registry',
        severity: 'error',
      }),
    ];
    const verifyResult = makeVerifyResult(issues);

    const result = computeImpact({
      owner: 'alice',
      scanResult,
      registry,
      verifyResult,
    });

    assert.ok(result.prescriptions.length > 0);
    // Prescriptions should be sorted by scoreImpact descending
    for (let i = 1; i < result.prescriptions.length; i++) {
      assert.ok(
        result.prescriptions[i - 1]!.scoreImpact >=
          result.prescriptions[i]!.scoreImpact,
        'prescriptions should be sorted by scoreImpact descending',
      );
    }
  });

  it('attaches issue types to ref entries', () => {
    const registry: Registry = {
      'TEST-001': makeRegistryEntry({ owner: 'alice' }),
    };
    const annotations = [makeAnnotation({ ref: 'TEST-001' })];
    const scanResult = makeScanResult(annotations);
    const issues = [
      makeIssue({ ref: 'TEST-001', type: 'expired', severity: 'error' }),
      makeIssue({
        ref: 'TEST-001',
        type: 'expiring-soon',
        severity: 'warning',
      }),
    ];
    const verifyResult = makeVerifyResult(issues);

    const result = computeImpact({
      owner: 'alice',
      scanResult,
      registry,
      verifyResult,
    });

    const refEntry = result.refs.find((r) => r.ref === 'TEST-001')!;
    assert.ok(refEntry.issues.includes('expired'));
    assert.ok(refEntry.issues.includes('expiring-soon'));
  });

  it('sorts refs by issue count descending then ref ascending', () => {
    const registry: Registry = {
      'AAA-001': makeRegistryEntry({ owner: 'alice' }),
      'BBB-001': makeRegistryEntry({ owner: 'alice' }),
      'CCC-001': makeRegistryEntry({ owner: 'alice' }),
    };
    const annotations = [
      makeAnnotation({ ref: 'AAA-001' }),
      makeAnnotation({ ref: 'BBB-001', location: { file: 'b.ts', line: 2 } }),
      makeAnnotation({ ref: 'CCC-001', location: { file: 'c.ts', line: 3 } }),
    ];
    const scanResult = makeScanResult(annotations);
    // BBB has 2 issues, AAA has 1, CCC has 0
    const issues = [
      makeIssue({ ref: 'BBB-001', type: 'expired', severity: 'error' }),
      makeIssue({ ref: 'BBB-001', type: 'expiring-soon', severity: 'warning' }),
      makeIssue({ ref: 'AAA-001', type: 'expired', severity: 'error' }),
    ];
    const verifyResult = makeVerifyResult(issues);

    const result = computeImpact({
      owner: 'alice',
      scanResult,
      registry,
      verifyResult,
    });

    assert.equal(result.refs[0]!.ref, 'BBB-001'); // 2 issues
    assert.equal(result.refs[1]!.ref, 'AAA-001'); // 1 issue
    assert.equal(result.refs[2]!.ref, 'CCC-001'); // 0 issues
  });

  it('uses verifyResult.timestamp for result timestamp', () => {
    const registry: Registry = {
      'TEST-001': makeRegistryEntry({ owner: 'alice' }),
    };
    const scanResult = makeScanResult([makeAnnotation({ ref: 'TEST-001' })]);
    const verifyResult = makeVerifyResult([], {
      timestamp: '2026-06-15T12:00:00.000Z',
    });

    const result = computeImpact({
      owner: 'alice',
      scanResult,
      registry,
      verifyResult,
    });

    assert.equal(result.timestamp, '2026-06-15T12:00:00.000Z');
  });

  it('resolves kind from registry entry', () => {
    const registry: Registry = {
      'TEST-001': makeRegistryEntry({ owner: 'alice', kind: 'intentional' }),
      'TEST-002': makeRegistryEntry({ owner: 'alice', kind: undefined }),
    };
    const annotations = [
      makeAnnotation({ ref: 'TEST-001' }),
      makeAnnotation({ ref: 'TEST-002', location: { file: 'b.ts', line: 2 } }),
    ];
    const scanResult = makeScanResult(annotations);
    const verifyResult = makeVerifyResult();

    const result = computeImpact({
      owner: 'alice',
      scanResult,
      registry,
      verifyResult,
    });

    const intentional = result.refs.find((r) => r.ref === 'TEST-001')!;
    const temporary = result.refs.find((r) => r.ref === 'TEST-002')!;
    assert.equal(intentional.kind, 'intentional');
    assert.equal(temporary.kind, 'temporary');
  });

  it('clamps hygiene to 0 when many issues', () => {
    const registry: Registry = {};
    const annotations: ShioriAnnotation[] = [];
    const issues: VerifyIssue[] = [];

    // Create many refs with expired issues to exceed max deductions
    for (let i = 0; i < 20; i++) {
      const ref = `TEST-${String(i).padStart(3, '0')}`;
      registry[ref] = makeRegistryEntry({ owner: 'alice' });
      annotations.push(
        makeAnnotation({ ref, location: { file: `f${i}.ts`, line: i } }),
      );
      issues.push(makeIssue({ ref, type: 'expired', severity: 'error' }));
      issues.push(
        makeIssue({ ref, type: 'missing-in-registry', severity: 'error' }),
      );
    }

    const scanResult = makeScanResult(annotations);
    const verifyResult = makeVerifyResult(issues);

    const result = computeImpact({
      owner: 'alice',
      scanResult,
      registry,
      verifyResult,
    });

    assert.ok(result.hygiene >= 0, 'hygiene should never go below 0');
    assert.ok(result.hygiene <= 100, 'hygiene should never exceed 100');
  });
});

// ── formatImpactMarkdown ────────────────────────────────────

describe('formatImpactMarkdown', () => {
  it('renders markdown with metrics table', () => {
    const result: ImpactResult = {
      timestamp: '2026-01-01T00:00:00.000Z',
      owner: 'alice',
      coverage: 80,
      hygiene: 90,
      annotationCount: 5,
      refs: [],
      prescriptions: [],
    };

    const md = formatImpactMarkdown(result);

    assert.ok(md.includes('# Impact: alice'));
    assert.ok(md.includes('| Coverage | 80/100 |'));
    assert.ok(md.includes('| Hygiene | 90/100 |'));
    assert.ok(md.includes('| Annotations | 5 |'));
  });

  it('renders refs table when refs present', () => {
    const result: ImpactResult = {
      timestamp: '2026-01-01T00:00:00.000Z',
      owner: 'alice',
      coverage: 100,
      hygiene: 100,
      annotationCount: 1,
      refs: [
        {
          ref: 'TEST-001',
          kind: 'intentional',
          issues: ['expired'],
          locations: [{ file: 'test.ts', line: 1 }],
        },
      ],
      prescriptions: [],
    };

    const md = formatImpactMarkdown(result);

    assert.ok(md.includes('## Refs'));
    assert.ok(md.includes('| TEST-001 | intentional | expired | test.ts:1 |'));
  });

  it('renders prescriptions when present', () => {
    const result: ImpactResult = {
      timestamp: '2026-01-01T00:00:00.000Z',
      owner: 'alice',
      coverage: 100,
      hygiene: 90,
      annotationCount: 1,
      refs: [],
      prescriptions: [
        {
          urgency: 'critical',
          message: '1 expired issue(s) for alice: fix it',
          command: 'shiori triage --expired-only',
          scoreImpact: 10,
          axis: 'hygiene',
        },
      ],
    };

    const md = formatImpactMarkdown(result);

    assert.ok(md.includes('## Prescriptions'));
    assert.ok(md.includes('**+10hyg**'));
    assert.ok(md.includes('shiori triage --expired-only'));
  });

  it('omits refs section when no refs', () => {
    const result: ImpactResult = {
      timestamp: '2026-01-01T00:00:00.000Z',
      owner: 'alice',
      coverage: 100,
      hygiene: 100,
      annotationCount: 0,
      refs: [],
      prescriptions: [],
    };

    const md = formatImpactMarkdown(result);

    assert.ok(!md.includes('## Refs'));
  });

  it('omits prescriptions section when no prescriptions', () => {
    const result: ImpactResult = {
      timestamp: '2026-01-01T00:00:00.000Z',
      owner: 'alice',
      coverage: 100,
      hygiene: 100,
      annotationCount: 0,
      refs: [],
      prescriptions: [],
    };

    const md = formatImpactMarkdown(result);

    assert.ok(!md.includes('## Prescriptions'));
  });
});

// ── formatImpact ────────────────────────────────────────────

describe('formatImpact', () => {
  const result: ImpactResult = {
    timestamp: '2026-01-01T00:00:00.000Z',
    owner: 'alice',
    coverage: 100,
    hygiene: 100,
    annotationCount: 1,
    refs: [],
    prescriptions: [],
  };

  it('returns JSON with schema envelope for json format', () => {
    const output = formatImpact(result, 'json');
    const parsed = JSON.parse(output);

    assert.equal(parsed.meta.command, 'impact');
    assert.equal(parsed.meta.schemaVersion, 1);
    assert.equal(parsed.data.owner, 'alice');
    assert.equal(parsed.data.coverage, 100);
  });

  it('returns markdown for markdown format', () => {
    const output = formatImpact(result, 'markdown');

    assert.ok(output.includes('# Impact: alice'));
  });
});
