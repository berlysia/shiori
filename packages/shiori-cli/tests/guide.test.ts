import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  USE_CASES,
  groupUseCases,
  findUseCase,
  formatUseCase,
  formatAllUseCases,
  formatUseCasesJson,
  evaluateCondition,
  scoreUseCase,
  rankUseCasesByContext,
  formatWizardResult,
  formatWizardResultJson,
  mapDoctorToGuideContext,
  type UseCaseCategory,
  type GuideContext,
  type ContextCondition,
  type UseCase,
} from '../src/commands/guide.ts';
import type {
  DoctorResult,
  ReportResult,
  VerifyResult,
} from '../src/core/types.ts';

describe('guide', () => {
  describe('USE_CASES', () => {
    it('has at least one use case', () => {
      assert.ok(USE_CASES.length > 0);
    });

    it('all use cases have unique ids', () => {
      const ids = USE_CASES.map((uc) => uc.id);
      const unique = new Set(ids);
      assert.equal(
        ids.length,
        unique.size,
        `Duplicate IDs found: ${ids.filter((id, i) => ids.indexOf(id) !== i).join(', ')}`,
      );
    });

    it('all use cases have required fields', () => {
      for (const uc of USE_CASES) {
        assert.ok(uc.id, `Use case missing id`);
        assert.ok(uc.label, `Use case ${uc.id} missing label`);
        assert.ok(uc.category, `Use case ${uc.id} missing category`);
        assert.ok(uc.commands.length > 0, `Use case ${uc.id} has no commands`);
        assert.ok(uc.explanation, `Use case ${uc.id} missing explanation`);
      }
    });

    it('all categories are valid', () => {
      const validCategories: UseCaseCategory[] = [
        'setup',
        'daily',
        'review',
        'governance',
        'diagnostics',
      ];
      for (const uc of USE_CASES) {
        assert.ok(
          validCategories.includes(uc.category),
          `Use case ${uc.id} has invalid category: ${uc.category}`,
        );
      }
    });

    it('options arrays contain non-empty strings when present', () => {
      for (const uc of USE_CASES) {
        if (uc.options) {
          assert.ok(
            Array.isArray(uc.options),
            `Use case ${uc.id}: options must be an array`,
          );
          for (const opt of uc.options) {
            assert.ok(
              typeof opt === 'string' && opt.length > 0,
              `Use case ${uc.id}: option must be a non-empty string`,
            );
          }
        }
      }
    });

    it('recipe filenames end with .md when present', () => {
      for (const uc of USE_CASES) {
        if (uc.recipes) {
          assert.ok(
            Array.isArray(uc.recipes),
            `Use case ${uc.id}: recipes must be an array`,
          );
          for (const recipe of uc.recipes) {
            assert.ok(
              recipe.endsWith('.md'),
              `Use case ${uc.id}: recipe "${recipe}" must end with .md`,
            );
          }
        }
      }
    });

    it('at least some use cases have options', () => {
      const withOptions = USE_CASES.filter(
        (uc) => uc.options && uc.options.length > 0,
      );
      assert.ok(
        withOptions.length > 0,
        'Expected at least some use cases to have options',
      );
    });

    it('at least some use cases have recipes', () => {
      const withRecipes = USE_CASES.filter(
        (uc) => uc.recipes && uc.recipes.length > 0,
      );
      assert.ok(
        withRecipes.length > 0,
        'Expected at least some use cases to have recipes',
      );
    });
  });

  describe('groupUseCases', () => {
    it('returns groups in expected category order', () => {
      const grouped = groupUseCases();
      const categories = grouped.map((g) => g.category);
      assert.deepEqual(categories, [
        'setup',
        'daily',
        'review',
        'governance',
        'diagnostics',
      ]);
    });

    it('every use case is assigned to a group', () => {
      const grouped = groupUseCases();
      const groupedCount = grouped.reduce(
        (sum, g) => sum + g.useCases.length,
        0,
      );
      assert.equal(groupedCount, USE_CASES.length);
    });

    it('each group has a human-readable category label', () => {
      const grouped = groupUseCases();
      for (const group of grouped) {
        assert.ok(group.categoryLabel, `Group ${group.category} missing label`);
        assert.notEqual(group.categoryLabel, group.category);
      }
    });
  });

  describe('findUseCase', () => {
    it('finds existing use case by id', () => {
      const result = findUseCase('quick-check');
      assert.ok(result);
      assert.equal(result.id, 'quick-check');
      assert.equal(result.category, 'daily');
    });

    it('returns undefined for unknown id', () => {
      const result = findUseCase('nonexistent-id');
      assert.equal(result, undefined);
    });
  });

  describe('formatUseCase', () => {
    it('includes label, explanation, and commands', () => {
      const uc = findUseCase('quick-check')!;
      const output = formatUseCase(uc);
      assert.ok(output.includes(uc.label));
      assert.ok(output.includes(uc.explanation));
      for (const cmd of uc.commands) {
        assert.ok(output.includes(`$ ${cmd}`));
      }
    });

    it('shows options section when use case has options', () => {
      const uc = findUseCase('generate-report')!;
      assert.ok(
        uc.options && uc.options.length > 0,
        'generate-report should have options',
      );
      const output = formatUseCase(uc);
      assert.ok(output.includes('Options:'));
      for (const opt of uc.options!) {
        assert.ok(output.includes(opt), `Missing option: ${opt}`);
      }
    });

    it('shows recipes section when use case has recipes', () => {
      const uc = findUseCase('generate-report')!;
      assert.ok(
        uc.recipes && uc.recipes.length > 0,
        'generate-report should have recipes',
      );
      const output = formatUseCase(uc);
      assert.ok(output.includes('Recipes:'));
      for (const recipe of uc.recipes!) {
        assert.ok(
          output.includes(`docs/recipes/${recipe}`),
          `Missing recipe path: ${recipe}`,
        );
      }
    });

    it('omits options section when use case has no options', () => {
      const uc = findUseCase('full-docs')!;
      assert.ok(!uc.options, 'full-docs should not have options');
      const output = formatUseCase(uc);
      assert.ok(!output.includes('Options:'));
    });

    it('omits recipes section when use case has no recipes', () => {
      const uc = findUseCase('adopt-existing')!;
      assert.ok(!uc.recipes, 'adopt-existing should not have recipes');
      const output = formatUseCase(uc);
      assert.ok(!output.includes('Recipes:'));
    });
  });

  describe('formatAllUseCases', () => {
    it('includes header and all category labels', () => {
      const grouped = groupUseCases();
      const output = formatAllUseCases(grouped);
      assert.ok(output.includes('shiori guide'));
      for (const group of grouped) {
        assert.ok(
          output.includes(group.categoryLabel),
          `Missing category label: ${group.categoryLabel}`,
        );
      }
    });

    it('includes all use case labels', () => {
      const grouped = groupUseCases();
      const output = formatAllUseCases(grouped);
      for (const uc of USE_CASES) {
        assert.ok(
          output.includes(uc.label),
          `Missing use case label: ${uc.label}`,
        );
      }
    });

    it('shows recipe count for use cases with recipes', () => {
      const grouped = groupUseCases();
      const output = formatAllUseCases(grouped);
      // generate-report has 3 recipes
      assert.ok(
        output.includes('3 recipes'),
        'generate-report should show 3 recipes',
      );
      // multi-repo has 1 recipe
      assert.ok(
        output.includes('1 recipe)'),
        'multi-repo should show 1 recipe',
      );
    });
  });

  describe('formatUseCasesJson', () => {
    it('produces valid JSON with all groups', () => {
      const grouped = groupUseCases();
      const json = formatUseCasesJson(grouped);
      const parsed = JSON.parse(json);
      assert.ok(Array.isArray(parsed));
      assert.equal(parsed.length, grouped.length);
    });

    it('each group in JSON has category and useCases', () => {
      const grouped = groupUseCases();
      const json = formatUseCasesJson(grouped);
      const parsed = JSON.parse(json) as Array<{
        category: string;
        categoryLabel: string;
        useCases: Array<{ id: string }>;
      }>;
      for (const group of parsed) {
        assert.ok(group.category);
        assert.ok(group.categoryLabel);
        assert.ok(Array.isArray(group.useCases));
        assert.ok(group.useCases.length > 0);
      }
    });

    it('includes options and recipes in JSON output', () => {
      const grouped = groupUseCases();
      const json = formatUseCasesJson(grouped);
      const parsed = JSON.parse(json) as Array<{
        useCases: Array<{
          id: string;
          options?: string[];
          recipes?: string[];
        }>;
      }>;
      // Find generate-report which has both options and recipes
      const allUseCases = parsed.flatMap((g) => g.useCases);
      const report = allUseCases.find((uc) => uc.id === 'generate-report');
      assert.ok(report, 'generate-report should be in JSON output');
      assert.ok(
        Array.isArray(report.options) && report.options.length > 0,
        'generate-report should have options in JSON',
      );
      assert.ok(
        Array.isArray(report.recipes) && report.recipes.length > 0,
        'generate-report should have recipes in JSON',
      );
    });
  });
});

// ── Wizard logic (EP-0100) ──────────────────────────────────

describe('wizard: evaluateCondition', () => {
  it('truthy returns true for truthy values', () => {
    const cond: ContextCondition = {
      field: 'hasExpiredAnnotations',
      op: 'truthy',
      boost: 10,
    };
    assert.equal(
      evaluateCondition(cond, { hasExpiredAnnotations: true }),
      true,
    );
  });

  it('truthy returns false for falsy values', () => {
    const cond: ContextCondition = {
      field: 'hasExpiredAnnotations',
      op: 'truthy',
      boost: 10,
    };
    assert.equal(
      evaluateCondition(cond, { hasExpiredAnnotations: false }),
      false,
    );
  });

  it('truthy returns false for undefined fields', () => {
    const cond: ContextCondition = {
      field: 'hasExpiredAnnotations',
      op: 'truthy',
      boost: 10,
    };
    assert.equal(evaluateCondition(cond, {}), false);
  });

  it('falsy returns true for falsy values', () => {
    const cond: ContextCondition = {
      field: 'hasExpiredAnnotations',
      op: 'falsy',
      boost: 5,
    };
    assert.equal(
      evaluateCondition(cond, { hasExpiredAnnotations: false }),
      true,
    );
  });

  it('eq matches exact value', () => {
    const cond: ContextCondition = {
      field: 'maturity',
      op: 'eq',
      value: 0,
      boost: 20,
    };
    assert.equal(evaluateCondition(cond, { maturity: 0 }), true);
    assert.equal(evaluateCondition(cond, { maturity: 1 }), false);
  });

  it('neq matches non-equal value', () => {
    const cond: ContextCondition = {
      field: 'maturity',
      op: 'neq',
      value: 0,
      boost: 5,
    };
    assert.equal(evaluateCondition(cond, { maturity: 1 }), true);
    assert.equal(evaluateCondition(cond, { maturity: 0 }), false);
  });

  it('lt compares numbers correctly', () => {
    const cond: ContextCondition = {
      field: 'healthScore',
      op: 'lt',
      value: 80,
      boost: 10,
    };
    assert.equal(evaluateCondition(cond, { healthScore: 50 }), true);
    assert.equal(evaluateCondition(cond, { healthScore: 80 }), false);
    assert.equal(evaluateCondition(cond, { healthScore: 90 }), false);
  });

  it('lte compares numbers correctly', () => {
    const cond: ContextCondition = {
      field: 'maturity',
      op: 'lte',
      value: 2,
      boost: 5,
    };
    assert.equal(evaluateCondition(cond, { maturity: 1 }), true);
    assert.equal(evaluateCondition(cond, { maturity: 2 }), true);
    assert.equal(evaluateCondition(cond, { maturity: 3 }), false);
  });

  it('gt compares numbers correctly', () => {
    const cond: ContextCondition = {
      field: 'candidateCount',
      op: 'gt',
      value: 0,
      boost: 10,
    };
    assert.equal(evaluateCondition(cond, { candidateCount: 5 }), true);
    assert.equal(evaluateCondition(cond, { candidateCount: 0 }), false);
  });

  it('gte compares numbers correctly', () => {
    const cond: ContextCondition = {
      field: 'maturity',
      op: 'gte',
      value: 2,
      boost: 5,
    };
    assert.equal(evaluateCondition(cond, { maturity: 2 }), true);
    assert.equal(evaluateCondition(cond, { maturity: 3 }), true);
    assert.equal(evaluateCondition(cond, { maturity: 1 }), false);
  });

  it('returns false for undefined field regardless of operator', () => {
    const ops = ['eq', 'neq', 'lt', 'lte', 'gt', 'gte'] as const;
    for (const op of ops) {
      const cond: ContextCondition = {
        field: 'healthScore',
        op,
        value: 50,
        boost: 10,
      };
      assert.equal(
        evaluateCondition(cond, {}),
        false,
        `op=${op} should return false for undefined field`,
      );
    }
  });
});

describe('wizard: scoreUseCase', () => {
  it('returns 0 for use case without contextConditions', () => {
    const uc: UseCase = {
      id: 'test',
      label: 'Test',
      category: 'daily',
      commands: ['shiori test'],
      explanation: 'Test use case',
    };
    assert.equal(scoreUseCase(uc, { maturity: 2 }), 0);
  });

  it('sums matching condition boosts', () => {
    const uc: UseCase = {
      id: 'test',
      label: 'Test',
      category: 'daily',
      commands: ['shiori test'],
      explanation: 'Test use case',
      contextConditions: [
        { field: 'maturity', op: 'gte', value: 1, boost: 5 },
        { field: 'hasExpiredAnnotations', op: 'truthy', boost: 10 },
      ],
    };
    const ctx: GuideContext = {
      maturity: 2,
      hasExpiredAnnotations: true,
    };
    assert.equal(scoreUseCase(uc, ctx), 15);
  });

  it('only sums matching conditions', () => {
    const uc: UseCase = {
      id: 'test',
      label: 'Test',
      category: 'daily',
      commands: ['shiori test'],
      explanation: 'Test use case',
      contextConditions: [
        { field: 'maturity', op: 'eq', value: 0, boost: 20 },
        { field: 'hasExpiredAnnotations', op: 'truthy', boost: 10 },
      ],
    };
    const ctx: GuideContext = {
      maturity: 2,
      hasExpiredAnnotations: true,
    };
    // maturity=2 != 0, so only hasExpiredAnnotations matches
    assert.equal(scoreUseCase(uc, ctx), 10);
  });
});

describe('wizard: rankUseCasesByContext', () => {
  it('returns top 3 recommendations by default', () => {
    const result = rankUseCasesByContext({ maturity: 0 });
    assert.equal(result.recommendations.length, 3);
  });

  it('respects custom topN parameter', () => {
    const result = rankUseCasesByContext({ maturity: 2 }, 5);
    assert.equal(result.recommendations.length, 5);
  });

  it('includes context in result', () => {
    const ctx: GuideContext = { maturity: 1, healthScore: 70 };
    const result = rankUseCasesByContext(ctx);
    assert.deepEqual(result.context, ctx);
  });

  it('ranks first-setup highest for maturity 0', () => {
    const result = rankUseCasesByContext({ maturity: 0 });
    assert.ok(result.recommendations.length > 0);
    assert.equal(result.recommendations[0]?.useCase.id, 'first-setup');
    assert.equal(result.recommendations[0]?.score, 20);
  });

  it('ranks resolve-ref high when expired annotations exist', () => {
    const ctx: GuideContext = {
      maturity: 2,
      hasExpiredAnnotations: true,
      healthScore: 60,
    };
    const result = rankUseCasesByContext(ctx);
    const resolveRef = result.recommendations.find(
      (r) => r.useCase.id === 'resolve-ref',
    );
    assert.ok(resolveRef, 'resolve-ref should be in top recommendations');
    assert.equal(resolveRef.score, 20);
  });

  it('ranks ci-setup high for maturity 1', () => {
    const ctx: GuideContext = { maturity: 1, healthScore: 90 };
    const result = rankUseCasesByContext(ctx);
    const ciSetup = result.recommendations.find(
      (r) => r.useCase.id === 'ci-setup',
    );
    assert.ok(ciSetup, 'ci-setup should be in top recommendations');
    assert.equal(ciSetup.score, 15);
  });

  it('recommendations are sorted by score descending', () => {
    const result = rankUseCasesByContext({
      maturity: 1,
      hasExpiredAnnotations: true,
      candidateCount: 5,
      healthScore: 40,
    });
    for (let i = 1; i < result.recommendations.length; i++) {
      const prev = result.recommendations[i - 1];
      const curr = result.recommendations[i];
      assert.ok(prev !== undefined && curr !== undefined);
      assert.ok(
        prev.score >= curr.score,
        `Recommendation ${i - 1} (score=${prev.score}) should >= recommendation ${i} (score=${curr.score})`,
      );
    }
  });

  it('returns scores of 0 for use cases without conditions when context is empty', () => {
    const result = rankUseCasesByContext({});
    // All scores should be 0 since no context data matches any condition
    for (const rec of result.recommendations) {
      assert.equal(rec.score, 0, `${rec.useCase.id} should score 0`);
    }
  });
});

describe('wizard: contextConditions data integrity', () => {
  it('all contextConditions use valid GuideContext fields', () => {
    const validFields: Array<keyof GuideContext> = [
      'maturity',
      'healthScore',
      'healthLevel',
      'hasExpiredAnnotations',
      'hasExpiringSoonAnnotations',
      'candidateCount',
      'annotationCount',
      'diagnostics',
      'hasDoctorFailures',
      'hasDoctorWarnings',
      'errors',
    ];
    for (const uc of USE_CASES) {
      if (uc.contextConditions) {
        for (const cond of uc.contextConditions) {
          assert.ok(
            validFields.includes(cond.field),
            `${uc.id}: invalid field "${cond.field}"`,
          );
        }
      }
    }
  });

  it('all contextConditions have positive boost values', () => {
    for (const uc of USE_CASES) {
      if (uc.contextConditions) {
        for (const cond of uc.contextConditions) {
          assert.ok(
            cond.boost > 0,
            `${uc.id}: boost should be positive, got ${cond.boost}`,
          );
        }
      }
    }
  });

  it('at least some use cases have contextConditions', () => {
    const withConditions = USE_CASES.filter(
      (uc) => uc.contextConditions && uc.contextConditions.length > 0,
    );
    assert.ok(
      withConditions.length > 5,
      `Expected many use cases to have contextConditions, got ${withConditions.length}`,
    );
  });
});

describe('wizard: formatWizardResult', () => {
  it('includes header and context summary', () => {
    const result = rankUseCasesByContext({
      maturity: 1,
      healthScore: 75,
    });
    const output = formatWizardResult(result);
    assert.ok(output.includes('shiori guide --wizard'));
    assert.ok(output.includes('Maturity: Level 1'));
    assert.ok(output.includes('Health: 75/100'));
  });

  it('includes numbered recommendations with scores', () => {
    const result = rankUseCasesByContext({ maturity: 0 });
    const output = formatWizardResult(result);
    assert.ok(output.includes('1.'), 'should have numbered item');
    assert.ok(output.includes('score:'), 'should show score');
    assert.ok(output.includes('$'), 'should show command');
  });

  it('shows expired annotation context when present', () => {
    const result = rankUseCasesByContext({ hasExpiredAnnotations: true });
    const output = formatWizardResult(result);
    assert.ok(output.includes('Expired annotations detected'));
  });

  it('shows candidate count when present', () => {
    const result = rankUseCasesByContext({ candidateCount: 10 });
    const output = formatWizardResult(result);
    assert.ok(output.includes('10 untracked candidate(s)'));
  });

  it('omits context summary when context is empty', () => {
    const result = rankUseCasesByContext({});
    const output = formatWizardResult(result);
    assert.ok(!output.includes('Project context:'));
  });
});

describe('wizard: formatWizardResultJson', () => {
  it('produces valid JSON with context and recommendations', () => {
    const ctx: GuideContext = { maturity: 2, healthScore: 85 };
    const result = rankUseCasesByContext(ctx);
    const json = formatWizardResultJson(result);
    const parsed = JSON.parse(json) as {
      context: GuideContext;
      recommendations: Array<{
        id: string;
        label: string;
        category: string;
        commands: string[];
        explanation: string;
        score: number;
      }>;
    };

    assert.deepEqual(parsed.context, ctx);
    assert.ok(Array.isArray(parsed.recommendations));
    assert.equal(parsed.recommendations.length, 3);

    for (const rec of parsed.recommendations) {
      assert.ok(typeof rec.id === 'string');
      assert.ok(typeof rec.label === 'string');
      assert.ok(typeof rec.category === 'string');
      assert.ok(Array.isArray(rec.commands));
      assert.ok(typeof rec.explanation === 'string');
      assert.ok(typeof rec.score === 'number');
    }
  });
});

// ── mapDoctorToGuideContext (Phase 2) ────────────────────────

/** Minimal VerifyResult for testing */
function stubVerifyResult(
  overrides: Partial<VerifyResult['summary']['byType']> = {},
): VerifyResult {
  return {
    timestamp: new Date().toISOString(),
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
        'registry-routing-mismatch': 0,
        'expiring-soon': 0,
        'ref-status-closed': 0,
        ...overrides,
      },
    },
    scannedRecords: 0,
    registryEntries: 0,
  };
}

/** Minimal ReportResult for testing */
function stubReportResult(
  overrides: Partial<{
    score: number;
    level: 'healthy' | 'warning' | 'critical';
    annotations: number;
    candidates: number;
    verifyByType: Partial<VerifyResult['summary']['byType']>;
  }> = {},
): ReportResult {
  return {
    timestamp: new Date().toISOString(),
    health: {
      level: overrides.level ?? 'healthy',
      score: overrides.score ?? 100,
      summary: 'test',
    },
    totals: {
      annotations: overrides.annotations ?? 0,
      candidates: overrides.candidates ?? 0,
      registryEntries: 0,
      issues: 0,
      errors: 0,
      warnings: 0,
    },
    insights: [],
    byType: {} as Record<string, number>,
    byRule: [],
    byKind: [],
    byOwner: [],
    verifyResult: stubVerifyResult(overrides.verifyByType),
  } as ReportResult;
}

/** Minimal DoctorResult for testing */
function stubDoctorResult(
  overrides: Partial<{
    pass: number;
    warn: number;
    fail: number;
    maturityLevel: 0 | 1 | 2 | 3 | 4;
  }> = {},
): DoctorResult {
  const result: DoctorResult = {
    checks: [],
    summary: {
      pass: overrides.pass ?? 3,
      warn: overrides.warn ?? 0,
      fail: overrides.fail ?? 0,
    },
  };
  if (overrides.maturityLevel !== undefined) {
    result.maturity = {
      level: overrides.maturityLevel,
      levelLabel: `Level ${overrides.maturityLevel}`,
      signals: [],
      nextActions: [],
    };
  }
  return result;
}

describe('mapDoctorToGuideContext', () => {
  it('returns empty context for empty input', () => {
    const ctx = mapDoctorToGuideContext({});
    assert.deepEqual(ctx, {});
  });

  it('extracts maturity from DoctorResult', () => {
    const ctx = mapDoctorToGuideContext({
      doctorResult: stubDoctorResult({ maturityLevel: 2 }),
    });
    assert.equal(ctx.maturity, 2);
  });

  it('does not set maturity when doctor has no maturity assessment', () => {
    const ctx = mapDoctorToGuideContext({
      doctorResult: stubDoctorResult({}),
    });
    assert.equal(ctx.maturity, undefined);
  });

  it('extracts diagnostics summary from DoctorResult', () => {
    const ctx = mapDoctorToGuideContext({
      doctorResult: stubDoctorResult({ pass: 5, warn: 2, fail: 1 }),
    });
    assert.deepEqual(ctx.diagnostics, { pass: 5, warn: 2, fail: 1 });
    assert.equal(ctx.hasDoctorFailures, true);
    assert.equal(ctx.hasDoctorWarnings, true);
  });

  it('sets hasDoctorFailures=false when no failures', () => {
    const ctx = mapDoctorToGuideContext({
      doctorResult: stubDoctorResult({ pass: 5, warn: 0, fail: 0 }),
    });
    assert.equal(ctx.hasDoctorFailures, false);
    assert.equal(ctx.hasDoctorWarnings, false);
  });

  it('extracts health from ReportResult', () => {
    const ctx = mapDoctorToGuideContext({
      reportResult: stubReportResult({ score: 75, level: 'warning' }),
    });
    assert.equal(ctx.healthScore, 75);
    assert.equal(ctx.healthLevel, 'warning');
  });

  it('extracts annotation and candidate counts from ReportResult', () => {
    const ctx = mapDoctorToGuideContext({
      reportResult: stubReportResult({ annotations: 10, candidates: 5 }),
    });
    assert.equal(ctx.annotationCount, 10);
    assert.equal(ctx.candidateCount, 5);
  });

  it('detects expired annotations from ReportResult', () => {
    const ctx = mapDoctorToGuideContext({
      reportResult: stubReportResult({
        verifyByType: { expired: 3 },
      }),
    });
    assert.equal(ctx.hasExpiredAnnotations, true);
    assert.equal(ctx.hasExpiringSoonAnnotations, false);
  });

  it('detects expiring-soon annotations from ReportResult', () => {
    const ctx = mapDoctorToGuideContext({
      reportResult: stubReportResult({
        verifyByType: { 'expiring-soon': 2 },
      }),
    });
    assert.equal(ctx.hasExpiredAnnotations, false);
    assert.equal(ctx.hasExpiringSoonAnnotations, true);
  });

  it('merges both DoctorResult and ReportResult', () => {
    const ctx = mapDoctorToGuideContext({
      doctorResult: stubDoctorResult({
        maturityLevel: 3,
        pass: 6,
        warn: 1,
        fail: 0,
      }),
      reportResult: stubReportResult({
        score: 85,
        level: 'healthy',
        annotations: 20,
        candidates: 3,
      }),
    });
    assert.equal(ctx.maturity, 3);
    assert.equal(ctx.healthScore, 85);
    assert.equal(ctx.annotationCount, 20);
    assert.equal(ctx.candidateCount, 3);
    assert.deepEqual(ctx.diagnostics, { pass: 6, warn: 1, fail: 0 });
    assert.equal(ctx.hasDoctorFailures, false);
    assert.equal(ctx.hasDoctorWarnings, true);
  });
});

// ── formatWizardResult: diagnostics & errors (Phase 2) ──────

describe('wizard: formatWizardResult (Phase 2)', () => {
  it('shows doctor issues count in context when diagnostics have failures', () => {
    const ctx: GuideContext = {
      maturity: 2,
      diagnostics: { pass: 3, warn: 1, fail: 2 },
      hasDoctorFailures: true,
    };
    const result = rankUseCasesByContext(ctx);
    const output = formatWizardResult(result);
    assert.ok(output.includes('Doctor: 2 issue(s)'));
  });

  it('omits doctor issues when no failures', () => {
    const ctx: GuideContext = {
      maturity: 2,
      diagnostics: { pass: 5, warn: 0, fail: 0 },
      hasDoctorFailures: false,
    };
    const result = rankUseCasesByContext(ctx);
    const output = formatWizardResult(result);
    assert.ok(!output.includes('Doctor:'));
  });

  it('shows errors when present in context', () => {
    const ctx: GuideContext = {
      maturity: 0,
      errors: [{ stage: 'report', message: 'Registry not found' }],
    };
    const result = rankUseCasesByContext(ctx);
    const output = formatWizardResult(result);
    assert.ok(output.includes('! report: Registry not found'));
  });

  it('omits errors section when no errors', () => {
    const ctx: GuideContext = { maturity: 2 };
    const result = rankUseCasesByContext(ctx);
    const output = formatWizardResult(result);
    assert.ok(!output.includes('!'));
  });

  it('diagnose use case scores higher with hasDoctorFailures', () => {
    const ctxWithFailures: GuideContext = {
      maturity: 2,
      healthScore: 60,
      hasDoctorFailures: true,
    };
    const ctxWithoutFailures: GuideContext = {
      maturity: 2,
      healthScore: 60,
      hasDoctorFailures: false,
    };
    const resultWith = rankUseCasesByContext(ctxWithFailures, 25);
    const resultWithout = rankUseCasesByContext(ctxWithoutFailures, 25);

    const diagnoseWith = resultWith.recommendations.find(
      (r) => r.useCase.id === 'diagnose',
    );
    const diagnoseWithout = resultWithout.recommendations.find(
      (r) => r.useCase.id === 'diagnose',
    );
    assert.ok(diagnoseWith && diagnoseWithout);
    assert.ok(
      diagnoseWith.score > diagnoseWithout.score,
      `diagnose with failures (${diagnoseWith.score}) should score higher than without (${diagnoseWithout.score})`,
    );
  });
});
