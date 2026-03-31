import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { why, isFound, computeRefScoreImpact } from '../src/commands/why.ts';
import type {
  ShioriAnnotation,
  Registry,
  VerifyIssue,
} from '../src/core/types.ts';

const makeAnnotation = (
  ref: string,
  file: string,
  line: number,
  opts?: { rule?: string },
): ShioriAnnotation => ({
  ref,
  rule: opts?.rule,
  tagged: true,
  ignored: false,
  location: { file, line },
});

describe('why', () => {
  const registry: Registry = {
    'JIRA:PROJ-123': {
      reason: 'Legacy API compatibility',
      target: 'src/api/legacy.ts',
      expires: '2026-06',
      ticket: 'https://jira.example.com/browse/PROJ-123',
      owner: 'team-platform',
      notes: 'Will be removed after v3 migration',
      kind: 'compat',
    },
  };

  const annotations: ShioriAnnotation[] = [
    makeAnnotation('JIRA:PROJ-123', 'src/api/legacy.ts', 42, {
      rule: 'no-deprecated-api',
    }),
    makeAnnotation('JIRA:PROJ-123', 'src/api/legacy.ts', 87, {
      rule: '@typescript-eslint/no-explicit-any',
    }),
    makeAnnotation('SUP-999', 'src/util.ts', 10),
  ];

  const refPatterns = [
    {
      match: 'JIRA:{id}',
      urlTemplate: 'https://jira.example.com/browse/{id}',
    },
  ];

  it('returns full info for ref in registry and source', () => {
    const result = why({
      ref: 'JIRA:PROJ-123',
      registry,
      annotations,
      refPatterns,
    });

    assert.equal(result.ref, 'JIRA:PROJ-123');
    assert.deepEqual(result.registryEntry, registry['JIRA:PROJ-123']);
    assert.equal(result.sourceLocations.length, 2);
    assert.deepEqual(result.sourceLocations[0], {
      file: 'src/api/legacy.ts',
      line: 42,
      rule: 'no-deprecated-api',
    });
    assert.deepEqual(result.sourceLocations[1], {
      file: 'src/api/legacy.ts',
      line: 87,
      rule: '@typescript-eslint/no-explicit-any',
    });
    assert.equal(result.url, 'https://jira.example.com/browse/PROJ-123');
  });

  it('includes rule info in source locations', () => {
    const result = why({
      ref: 'JIRA:PROJ-123',
      registry,
      annotations,
      refPatterns,
    });

    assert.equal(result.sourceLocations[0]?.rule, 'no-deprecated-api');
    assert.equal(
      result.sourceLocations[1]?.rule,
      '@typescript-eslint/no-explicit-any',
    );
  });

  it('returns issues for ref missing from registry', () => {
    const result = why({
      ref: 'SUP-999',
      registry,
      annotations,
      refPatterns: undefined,
    });

    assert.equal(result.registryEntry, undefined);
    assert.equal(result.sourceLocations.length, 1);
    assert.ok(result.issues.length > 0);
    assert.ok(
      result.issues.some((i) => i.type === 'missing-in-registry'),
      'Expected missing-in-registry issue',
    );
  });

  it('returns issues for expired registry entry', () => {
    const expiredRegistry: Registry = {
      'EXP-001': {
        reason: 'Temporary workaround',
        target: 'src/hack.ts',
        expires: '2020-01-01',
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: 'intentional',
      },
    };
    const expiredAnnotations = [makeAnnotation('EXP-001', 'src/hack.ts', 5)];

    const result = why({
      ref: 'EXP-001',
      registry: expiredRegistry,
      annotations: expiredAnnotations,
      refPatterns: undefined,
      now: new Date('2025-06-01'),
    });

    assert.ok(
      result.issues.some((i) => i.type === 'expired'),
      'Expected expired issue',
    );
  });

  it('returns no issues when ref is healthy', () => {
    const result = why({
      ref: 'JIRA:PROJ-123',
      registry,
      annotations,
      refPatterns,
      now: new Date('2025-01-01'),
    });

    assert.deepEqual(result.issues, []);
  });

  it('returns empty result for unknown ref', () => {
    const result = why({
      ref: 'UNKNOWN-999',
      registry,
      annotations,
      refPatterns: undefined,
    });

    assert.equal(result.registryEntry, undefined);
    assert.deepEqual(result.sourceLocations, []);
    assert.equal(result.url, undefined);
  });

  it('builds human-readable summary with all fields', () => {
    const result = why({
      ref: 'JIRA:PROJ-123',
      registry,
      annotations,
      refPatterns,
      now: new Date('2025-01-01'),
    });

    assert.ok(result.summary.includes('ref: JIRA:PROJ-123'));
    assert.ok(result.summary.includes('reason: Legacy API compatibility'));
    assert.ok(result.summary.includes('owner: team-platform'));
    assert.ok(result.summary.includes('expires: 2026-06'));
    assert.ok(result.summary.includes('kind: compat'));
    assert.ok(
      result.summary.includes(
        'ticket: https://jira.example.com/browse/PROJ-123',
      ),
    );
    assert.ok(
      result.summary.includes('notes: Will be removed after v3 migration'),
    );
    assert.ok(
      result.summary.includes('url: https://jira.example.com/browse/PROJ-123'),
    );
    assert.ok(result.summary.includes('locations: 2 occurrence(s)'));
    assert.ok(result.summary.includes('issues: none'));
  });

  it('summary shows registry: not found for missing entry', () => {
    const result = why({
      ref: 'SUP-999',
      registry,
      annotations,
      refPatterns: undefined,
    });

    assert.ok(result.summary.includes('registry: not found'));
  });

  it('summary shows issue details', () => {
    const result = why({
      ref: 'SUP-999',
      registry,
      annotations,
      refPatterns: undefined,
    });

    assert.ok(
      result.summary.some((line) => line.includes('missing-in-registry')),
    );
  });

  it('does not report unused-in-source for other registry entries (scoped verify)', () => {
    // why() scopes verify to the target ref only, so other registry entries
    // that are "unused" in the scoped view should not generate issues.
    const largeRegistry: Registry = {
      'JIRA:PROJ-123': registry['JIRA:PROJ-123']!,
      'OTHER-001': {
        reason: 'unrelated entry',
        target: 'other.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: 'intentional',
      },
    };

    const result = why({
      ref: 'JIRA:PROJ-123',
      registry: largeRegistry,
      annotations,
      refPatterns,
      now: new Date('2025-01-01'),
    });

    // Should not have unused-in-source for OTHER-001
    assert.ok(
      !result.issues.some((i) => i.type === 'unused-in-source'),
      'Expected no unused-in-source issues for unrelated registry entries',
    );
    assert.deepEqual(result.issues, []);
  });
});

describe('why — expiringThresholdDays propagation', () => {
  it('uses custom expiringThresholdDays for expiring-soon detection', () => {
    const soonRegistry: Registry = {
      'SOON-001': {
        reason: 'Expiring soon workaround',
        target: 'src/workaround.ts',
        expires: '2025-01-20',
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: 'intentional',
      },
    };
    const soonAnnotations = [
      makeAnnotation('SOON-001', 'src/workaround.ts', 5),
    ];

    // With default (14 days), 2025-01-20 is within range from 2025-01-10
    const resultDefault = why({
      ref: 'SOON-001',
      registry: soonRegistry,
      annotations: soonAnnotations,
      refPatterns: undefined,
      now: new Date('2025-01-10'),
    });
    assert.ok(
      resultDefault.issues.some((i) => i.type === 'expiring-soon'),
      'Expected expiring-soon with default threshold',
    );

    // With 3 days, 2025-01-20 is NOT within range from 2025-01-10
    const resultCustom = why({
      ref: 'SOON-001',
      registry: soonRegistry,
      annotations: soonAnnotations,
      refPatterns: undefined,
      now: new Date('2025-01-10'),
      expiringThresholdDays: 3,
    });
    assert.ok(
      !resultCustom.issues.some((i) => i.type === 'expiring-soon'),
      'Expected no expiring-soon with 3-day threshold',
    );
  });
});

describe('why — duplicates and refOrigins propagation', () => {
  it('reports ref-collision when duplicates are provided', () => {
    const reg: Registry = {
      'DUP-001': {
        reason: 'Duplicate test',
        target: 'src/dup.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: 'intentional',
      },
    };
    const ann = [makeAnnotation('DUP-001', 'src/dup.ts', 1)];

    const result = why({
      ref: 'DUP-001',
      registry: reg,
      annotations: ann,
      refPatterns: undefined,
      now: new Date('2025-01-01'),
      duplicates: [
        {
          ref: 'DUP-001',
          defaultFile: 'registry.json',
          patternFile: 'registry-jira.json',
        },
      ],
    });

    assert.ok(
      result.issues.some((i) => i.type === 'ref-collision'),
      'Expected ref-collision issue from duplicates',
    );
  });

  it('does not report ref-collision for unrelated duplicates', () => {
    const reg: Registry = {
      'CLEAN-001': {
        reason: 'Clean entry',
        target: 'src/clean.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: 'intentional',
      },
    };
    const ann = [makeAnnotation('CLEAN-001', 'src/clean.ts', 1)];

    const result = why({
      ref: 'CLEAN-001',
      registry: reg,
      annotations: ann,
      refPatterns: undefined,
      now: new Date('2025-01-01'),
      duplicates: [
        {
          ref: 'OTHER-DUP',
          defaultFile: 'registry.json',
          patternFile: 'registry-other.json',
        },
      ],
    });

    assert.ok(
      !result.issues.some((i) => i.type === 'ref-collision'),
      'Should not report ref-collision for unrelated ref',
    );
  });

  it('reports registry-routing-mismatch when refOrigins mismatch', () => {
    const reg: Registry = {
      'JIRA:ROUTE-001': {
        reason: 'Routing test',
        target: 'src/route.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: 'intentional',
      },
    };
    const ann = [makeAnnotation('JIRA:ROUTE-001', 'src/route.ts', 1)];
    const patterns = [
      {
        match: 'JIRA:{id}',
        urlTemplate: 'https://jira.example.com/browse/{id}',
        registryFile: 'registry-jira.json',
      },
    ];

    // ref is in default registry (null) but pattern routes to registry-jira.json
    const refOrigins = new Map<string, string | null>([
      ['JIRA:ROUTE-001', null],
    ]);

    const result = why({
      ref: 'JIRA:ROUTE-001',
      registry: reg,
      annotations: ann,
      refPatterns: patterns,
      now: new Date('2025-01-01'),
      refOrigins,
    });

    assert.ok(
      result.issues.some((i) => i.type === 'registry-routing-mismatch'),
      'Expected registry-routing-mismatch issue',
    );
  });
});

describe('isFound (why)', () => {
  it('returns true when registryEntry exists', () => {
    assert.equal(
      isFound({
        ref: 'X',
        registryEntry: {
          reason: 'test',
          target: 'a.ts',
          expires: undefined,
          ticket: undefined,
          owner: undefined,
          notes: undefined,
          kind: 'intentional',
        },
        sourceLocations: [],
        url: undefined,
        issues: [],
        summary: [],
      }),
      true,
    );
  });

  it('returns true when sourceLocations exist', () => {
    assert.equal(
      isFound({
        ref: 'X',
        registryEntry: undefined,
        sourceLocations: [{ file: 'a.ts', line: 1 }],
        url: undefined,
        issues: [],
        summary: [],
      }),
      true,
    );
  });

  it('returns false when neither exists', () => {
    assert.equal(
      isFound({
        ref: 'X',
        registryEntry: undefined,
        sourceLocations: [],
        url: undefined,
        issues: [],
        summary: [],
      }),
      false,
    );
  });
});

describe('computeRefScoreImpact (EP-0199)', () => {
  it('computes coverage contribution from annotation count', () => {
    const impact = computeRefScoreImpact({
      refAnnotationCount: 2,
      totalAnnotations: 10,
      totalCandidates: 0,
      issues: [],
    });
    assert.equal(impact.coverageContribution, 20); // 2/10 * 100
    assert.equal(impact.hygieneDeduction, 0);
    assert.equal(impact.deductionSources.length, 0);
  });

  it('includes candidates in coverage calculation', () => {
    const impact = computeRefScoreImpact({
      refAnnotationCount: 1,
      totalAnnotations: 3,
      totalCandidates: 7,
      issues: [],
    });
    assert.equal(impact.coverageContribution, 10); // 1/10 * 100
  });

  it('returns 0 coverage when totals are zero', () => {
    const impact = computeRefScoreImpact({
      refAnnotationCount: 0,
      totalAnnotations: 0,
      totalCandidates: 0,
      issues: [],
    });
    assert.equal(impact.coverageContribution, 0);
  });

  it('computes hygiene deduction from expired issues', () => {
    const issues: VerifyIssue[] = [
      {
        type: 'expired',
        severity: 'error',
        ref: 'X',
        message: 'expired',
        file: 'a.ts',
        line: 1,
      },
    ];
    const impact = computeRefScoreImpact({
      refAnnotationCount: 1,
      totalAnnotations: 5,
      totalCandidates: 0,
      issues,
    });
    assert.equal(impact.hygieneDeduction, 10); // expired is 10pt per issue
    assert.equal(impact.deductionSources.length, 1);
    assert.equal(impact.deductionSources[0]!.type, 'expired');
    assert.equal(impact.deductionSources[0]!.points, 10);
  });

  it('computes hygiene deduction from missing-in-registry', () => {
    const issues: VerifyIssue[] = [
      {
        type: 'missing-in-registry',
        severity: 'warning',
        ref: 'X',
        message: 'missing',
        file: 'a.ts',
        line: 1,
      },
    ];
    const impact = computeRefScoreImpact({
      refAnnotationCount: 1,
      totalAnnotations: 5,
      totalCandidates: 0,
      issues,
    });
    assert.equal(impact.hygieneDeduction, 5); // missing-in-registry is 5pt per issue
    assert.equal(impact.deductionSources[0]!.type, 'missing-in-registry');
  });

  it('accumulates deductions from multiple issue types', () => {
    const issues: VerifyIssue[] = [
      {
        type: 'expired',
        severity: 'error',
        ref: 'X',
        message: 'expired',
        file: 'a.ts',
        line: 1,
      },
      {
        type: 'temporary-without-expires',
        severity: 'warning',
        ref: 'X',
        message: 'no expires',
        file: 'a.ts',
        line: 1,
      },
    ];
    const impact = computeRefScoreImpact({
      refAnnotationCount: 1,
      totalAnnotations: 5,
      totalCandidates: 0,
      issues,
    });
    // expired = 10pt, temporary-without-expires = 2pt
    assert.equal(impact.hygieneDeduction, 12);
    assert.equal(impact.deductionSources.length, 2);
  });

  it('caps tier-1 deduction at maxDeduction (40)', () => {
    // 5 expired issues × 10pt = 50pt raw, but tier-1 maxDeduction = 40
    const issues: VerifyIssue[] = Array.from({ length: 5 }, (_, i) => ({
      type: 'expired' as const,
      severity: 'error' as const,
      ref: 'X',
      message: `expired ${i}`,
      file: 'a.ts',
      line: i + 1,
    }));
    const impact = computeRefScoreImpact({
      refAnnotationCount: 1,
      totalAnnotations: 5,
      totalCandidates: 0,
      issues,
    });
    assert.equal(impact.hygieneDeduction, 40); // capped at 40, not 50
  });

  it('caps tier-2 deduction at maxDeduction (30)', () => {
    // 7 missing-in-registry issues × 5pt = 35pt raw, tier-2 maxDeduction = 30
    const issues: VerifyIssue[] = Array.from({ length: 7 }, (_, i) => ({
      type: 'missing-in-registry' as const,
      severity: 'warning' as const,
      ref: 'X',
      message: `missing ${i}`,
      file: 'a.ts',
      line: i + 1,
    }));
    const impact = computeRefScoreImpact({
      refAnnotationCount: 1,
      totalAnnotations: 5,
      totalCandidates: 0,
      issues,
    });
    assert.equal(impact.hygieneDeduction, 30); // capped at 30, not 35
  });

  it('caps tier-3 deduction at maxDeduction (10)', () => {
    // 6 ref-format issues × 2pt = 12pt raw, tier-3 maxDeduction = 10
    const issues: VerifyIssue[] = Array.from({ length: 6 }, (_, i) => ({
      type: 'ref-format' as const,
      severity: 'warning' as const,
      ref: 'X',
      message: `ref-format ${i}`,
      file: 'a.ts',
      line: i + 1,
    }));
    const impact = computeRefScoreImpact({
      refAnnotationCount: 1,
      totalAnnotations: 5,
      totalCandidates: 0,
      issues,
    });
    assert.equal(impact.hygieneDeduction, 10); // capped at 10, not 12
  });

  it('applies maxDeduction caps per tier independently', () => {
    // tier-1: 5 expired × 10 = 50 → capped 40
    // tier-3: 6 ref-format × 2 = 12 → capped 10
    // total = 50 (40 + 10)
    const issues: VerifyIssue[] = [
      ...Array.from({ length: 5 }, (_, i) => ({
        type: 'expired' as const,
        severity: 'error' as const,
        ref: 'X',
        message: `expired ${i}`,
        file: 'a.ts',
        line: i + 1,
      })),
      ...Array.from({ length: 6 }, (_, i) => ({
        type: 'ref-format' as const,
        severity: 'warning' as const,
        ref: 'X',
        message: `ref-format ${i}`,
        file: 'a.ts',
        line: i + 10,
      })),
    ];
    const impact = computeRefScoreImpact({
      refAnnotationCount: 1,
      totalAnnotations: 5,
      totalCandidates: 0,
      issues,
    });
    assert.equal(impact.hygieneDeduction, 50); // 40 + 10
  });

  it('does not cap when under maxDeduction', () => {
    // 3 expired × 10 = 30 < 40 → no capping
    const issues: VerifyIssue[] = Array.from({ length: 3 }, (_, i) => ({
      type: 'expired' as const,
      severity: 'error' as const,
      ref: 'X',
      message: `expired ${i}`,
      file: 'a.ts',
      line: i + 1,
    }));
    const impact = computeRefScoreImpact({
      refAnnotationCount: 1,
      totalAnnotations: 5,
      totalCandidates: 0,
      issues,
    });
    assert.equal(impact.hygieneDeduction, 30); // 3 × 10 = 30, under 40 cap
    assert.equal(impact.deductionSources[0]!.points, 30); // not scaled
  });
});

describe('why — scoreImpact integration (EP-0199)', () => {
  it('includes scoreImpact in WhyResult', () => {
    const ann = [makeAnnotation('TEST-001', 'src/a.ts', 1)];
    const reg: Registry = {
      'TEST-001': {
        reason: 'test',
        target: 'src/a.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: 'intentional',
      },
    };

    const result = why({
      ref: 'TEST-001',
      registry: reg,
      annotations: ann,
      candidates: [
        {
          pattern: 'eslint',
          directive: 'eslint-disable-next-line',
          location: { file: 'src/b.ts', line: 2 },
        },
      ],
      refPatterns: undefined,
    });

    assert.ok(result.scoreImpact);
    assert.equal(result.scoreImpact.coverageContribution, 50); // 1/(1+1) * 100
    assert.equal(result.scoreImpact.hygieneDeduction, 0); // no issues
  });

  it('shows impact in summary output', () => {
    const ann = [makeAnnotation('EXP-001', 'src/a.ts', 1)];
    const reg: Registry = {
      'EXP-001': {
        reason: 'expired workaround',
        target: 'src/a.ts',
        expires: '2020-01-01',
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: 'intentional',
      },
    };

    const result = why({
      ref: 'EXP-001',
      registry: reg,
      annotations: ann,
      refPatterns: undefined,
      now: new Date('2025-06-01'),
    });

    assert.ok(result.summary.some((line) => line.includes('impact:')));
    assert.ok(result.summary.some((line) => line.includes('coverage +')));
    assert.ok(result.summary.some((line) => line.includes('hygiene -')));
  });

  it('works without candidates (backward compat)', () => {
    const ann = [makeAnnotation('TEST-001', 'src/a.ts', 1)];
    const reg: Registry = {
      'TEST-001': {
        reason: 'test',
        target: 'src/a.ts',
        expires: undefined,
        ticket: undefined,
        owner: undefined,
        notes: undefined,
        kind: 'intentional',
      },
    };

    const result = why({
      ref: 'TEST-001',
      registry: reg,
      annotations: ann,
      // candidates not provided
      refPatterns: undefined,
    });

    assert.ok(result.scoreImpact);
    // 1/(1+0) * 100 = 100
    assert.equal(result.scoreImpact.coverageContribution, 100);
  });
});
