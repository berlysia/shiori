import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  HealthPrescription,
  HealthResult,
  PrescriptionActionType,
} from '../src/core/types.ts';
import {
  planFix,
  formatFixPreview,
  formatFixResult,
  buildCumulativePreview,
  formatCumulativeFixPreview,
  type FixPreview,
  type HealthFixApplyResult,
} from '../src/commands/health-fix.ts';

function makePrescription(
  overrides: Partial<HealthPrescription> = {},
): HealthPrescription {
  return {
    urgency: 'recommended',
    message: '1 missing-in-registry issue(s): Add to registry',
    command: 'shiori update',
    scoreImpact: 5,
    actionType: 'update',
    axis: 'hygiene' as const,
    ...overrides,
  };
}

describe('planFix', () => {
  it('returns null when no prescriptions', () => {
    assert.equal(planFix([]), null);
  });

  it('returns null when no automatable prescriptions', () => {
    const prescriptions: HealthPrescription[] = [
      makePrescription({ actionType: 'triage', command: 'shiori triage' }),
      makePrescription({ actionType: 'verify', command: 'shiori verify' }),
      makePrescription({ actionType: 'doctor', command: 'shiori doctor' }),
    ];
    assert.equal(planFix(prescriptions), null);
  });

  it('returns first automatable prescription (update)', () => {
    const prescriptions: HealthPrescription[] = [
      makePrescription({
        actionType: 'triage',
        command: 'shiori triage',
        scoreImpact: 10,
      }),
      makePrescription({
        actionType: 'update',
        command: 'shiori update',
        scoreImpact: 5,
      }),
    ];
    const preview = planFix(prescriptions);
    assert.ok(preview);
    assert.equal(preview.target.actionType, 'update');
    assert.equal(preview.target.command, 'shiori update');
    assert.equal(preview.automatable, true);
  });

  it('separates automatable from manual prescriptions', () => {
    const prescriptions: HealthPrescription[] = [
      makePrescription({ actionType: 'update', command: 'shiori update' }),
      makePrescription({ actionType: 'triage', command: 'shiori triage' }),
      makePrescription({
        actionType: 'candidates',
        command: 'shiori candidates',
      }),
    ];
    const preview = planFix(prescriptions);
    assert.ok(preview);
    assert.equal(preview.manualPrescriptions.length, 2);
    assert.deepEqual(
      preview.manualPrescriptions.map((p) => p.actionType),
      ['triage', 'candidates'],
    );
  });

  it('uses the first update prescription when multiple exist', () => {
    const prescriptions: HealthPrescription[] = [
      makePrescription({
        actionType: 'update',
        scoreImpact: 3,
        message: 'first',
      }),
      makePrescription({
        actionType: 'update',
        scoreImpact: 8,
        message: 'second',
      }),
    ];
    const preview = planFix(prescriptions);
    assert.ok(preview);
    assert.ok(preview.target.message.includes('first'));
  });
});

describe('formatFixPreview', () => {
  it('includes action, impact, and dry-run instructions', () => {
    const preview: FixPreview = {
      target: makePrescription({ scoreImpact: 10 }),
      automatable: true,
      description: 'Auto-fix: shiori update',
      manualPrescriptions: [],
    };
    const output = formatFixPreview(preview);
    assert.ok(output.includes('Fix Preview'));
    assert.ok(output.includes('shiori update'));
    assert.ok(output.includes('+10hyg'));
    assert.ok(output.includes('--fix --apply'));
  });

  it('includes manual prescriptions when present', () => {
    const preview: FixPreview = {
      target: makePrescription(),
      automatable: true,
      description: 'Auto-fix: shiori update',
      manualPrescriptions: [
        makePrescription({
          actionType: 'triage',
          command: 'shiori triage',
          message: '2 expired',
        }),
      ],
    };
    const output = formatFixPreview(preview);
    assert.ok(output.includes('Manual actions'));
    assert.ok(output.includes('shiori triage'));
  });
});

describe('formatFixResult', () => {
  it('formats successful fix with score delta', () => {
    const result: HealthFixApplyResult = {
      success: true,
      action: 'update',
      description: 'Added 3 ref(s) to registry',
      beforeScore: 60,
      afterScore: 75,
      scoreDelta: 15,
    };
    const output = formatFixResult(result);
    assert.ok(output.includes('Fix applied'));
    assert.ok(output.includes('60'));
    assert.ok(output.includes('75'));
    assert.ok(output.includes('+15'));
  });

  it('formats negative score delta correctly', () => {
    const result: HealthFixApplyResult = {
      success: true,
      action: 'update',
      description: 'Added 1 ref(s) to registry',
      beforeScore: 80,
      afterScore: 78,
      scoreDelta: -2,
    };
    const output = formatFixResult(result);
    assert.ok(output.includes('80'));
    assert.ok(output.includes('78'));
    assert.ok(output.includes('-2'));
  });

  it('formats failed fix', () => {
    const result: HealthFixApplyResult = {
      success: false,
      action: 'update',
      description: 'Registry save failed',
      beforeScore: 60,
      afterScore: 60,
      scoreDelta: 0,
    };
    const output = formatFixResult(result);
    assert.ok(output.includes('Fix failed'));
    assert.ok(output.includes('Registry save failed'));
  });
});

describe('actionType coverage', () => {
  it('every PrescriptionActionType is recognized', () => {
    const types: PrescriptionActionType[] = [
      'update',
      'triage',
      'verify',
      'doctor',
      'candidates',
    ];
    for (const actionType of types) {
      const prescription = makePrescription({ actionType });
      // planFix should not throw for any valid actionType
      planFix([prescription]);
    }
  });

  it("only 'update' is automatable", () => {
    const automatableTypes: PrescriptionActionType[] = ['update'];
    const manualTypes: PrescriptionActionType[] = [
      'triage',
      'verify',
      'doctor',
      'candidates',
    ];

    for (const actionType of automatableTypes) {
      const preview = planFix([makePrescription({ actionType })]);
      assert.ok(preview, `${actionType} should be automatable`);
    }

    for (const actionType of manualTypes) {
      const preview = planFix([makePrescription({ actionType })]);
      assert.equal(preview, null, `${actionType} should not be automatable`);
    }
  });
});

// ── Cumulative Fix Preview (EP-0204) ────────────────────────

function makeHealthResult(overrides: Partial<HealthResult> = {}): HealthResult {
  return {
    timestamp: '2026-04-01T00:00:00.000Z',
    health: {
      level: 'warning',
      score: 50,
      coverage: 40,
      hygiene: 50,
      summary: 'test',
    },
    issues: { total: 3, errors: 2, warnings: 1 },
    expiring: { expired: 1, expiringSoon: 0 },
    insights: [],
    maturityStage: 'Foundation',
    nextSteps: {
      quadrant: 'low-coverage-low-hygiene',
      label: 'Needs foundation work',
      steps: [],
    },
    ...overrides,
  };
}

describe('buildCumulativePreview (EP-0204)', () => {
  it('returns null when no prescriptions', () => {
    const result = makeHealthResult({ prescriptions: undefined });
    assert.equal(buildCumulativePreview(result), null);
  });

  it('returns null when prescriptions array is empty', () => {
    const result = makeHealthResult({ prescriptions: [] });
    assert.equal(buildCumulativePreview(result), null);
  });

  it('aggregates coverage and hygiene impacts separately', () => {
    const result = makeHealthResult({
      prescriptions: [
        makePrescription({
          axis: 'hygiene',
          scoreImpact: 10,
          actionType: 'triage',
        }),
        makePrescription({
          axis: 'hygiene',
          scoreImpact: 5,
          actionType: 'update',
        }),
        makePrescription({
          axis: 'coverage',
          scoreImpact: 20,
          actionType: 'candidates',
        }),
      ],
    });

    const preview = buildCumulativePreview(result);
    assert.ok(preview);

    // Hygiene: 50 + 15 = 65
    assert.equal(preview.hygiene.before, 50);
    assert.equal(preview.hygiene.after, 65);
    assert.equal(preview.hygiene.delta, 15);

    // Coverage: 40 + 20 = 60
    assert.equal(preview.coverage.before, 40);
    assert.equal(preview.coverage.after, 60);
    assert.equal(preview.coverage.delta, 20);

    // Overall: min(60, 65) = 60
    assert.equal(preview.overall.before, 50);
    assert.equal(preview.overall.after, 60);
    assert.equal(preview.overall.delta, 10);
  });

  it('clamps after-scores to 100', () => {
    const result = makeHealthResult({
      health: {
        level: 'healthy',
        score: 80,
        coverage: 80,
        hygiene: 80,
        summary: 'test',
      },
      maturityStage: 'Maintained',
      nextSteps: {
        quadrant: 'high-coverage-high-hygiene',
        label: 'Well-governed',
        steps: [],
      },
      prescriptions: [
        makePrescription({
          axis: 'coverage',
          scoreImpact: 50,
          actionType: 'candidates',
        }),
        makePrescription({
          axis: 'hygiene',
          scoreImpact: 50,
          actionType: 'triage',
        }),
      ],
    });

    const preview = buildCumulativePreview(result);
    assert.ok(preview);
    assert.equal(preview.coverage.after, 100);
    assert.equal(preview.hygiene.after, 100);
    assert.equal(preview.overall.after, 100);
  });

  it('predicts maturity stage transition (Foundation → Autonomous)', () => {
    const result = makeHealthResult({
      health: {
        level: 'warning',
        score: 40,
        coverage: 40,
        hygiene: 50,
        summary: 'test',
      },
      maturityStage: 'Foundation',
      nextSteps: {
        quadrant: 'low-coverage-low-hygiene',
        label: 'Needs foundation work',
        steps: [],
      },
      prescriptions: [
        makePrescription({
          axis: 'coverage',
          scoreImpact: 60,
          actionType: 'candidates',
        }),
        makePrescription({
          axis: 'hygiene',
          scoreImpact: 50,
          actionType: 'triage',
        }),
      ],
    });

    const preview = buildCumulativePreview(result);
    assert.ok(preview);
    assert.equal(preview.maturityBefore, 'Foundation');
    // After: coverage=100, hygiene=100, no prescriptions → Autonomous
    assert.equal(preview.maturityAfter, 'Autonomous');
  });

  it('predicts same maturity stage when already Maintained', () => {
    const result = makeHealthResult({
      health: {
        level: 'healthy',
        score: 75,
        coverage: 80,
        hygiene: 75,
        summary: 'test',
      },
      maturityStage: 'Maintained',
      nextSteps: {
        quadrant: 'high-coverage-high-hygiene',
        label: 'Well-governed',
        steps: [],
      },
      prescriptions: [
        makePrescription({
          axis: 'hygiene',
          scoreImpact: 5,
          actionType: 'triage',
        }),
      ],
    });

    const preview = buildCumulativePreview(result);
    assert.ok(preview);
    assert.equal(preview.maturityBefore, 'Maintained');
    // After: all prescriptions resolved, both axes still high → Autonomous
    assert.equal(preview.maturityAfter, 'Autonomous');
  });

  it('includes all prescriptions in output', () => {
    const prescriptions = [
      makePrescription({ axis: 'hygiene', actionType: 'triage' }),
      makePrescription({ axis: 'coverage', actionType: 'candidates' }),
    ];
    const result = makeHealthResult({ prescriptions });

    const preview = buildCumulativePreview(result);
    assert.ok(preview);
    assert.equal(preview.prescriptions.length, 2);
  });
});

describe('formatCumulativeFixPreview (EP-0204)', () => {
  it('displays axis-level before/after scores', () => {
    const result = makeHealthResult({
      prescriptions: [
        makePrescription({
          axis: 'hygiene',
          scoreImpact: 15,
          actionType: 'triage',
        }),
        makePrescription({
          axis: 'coverage',
          scoreImpact: 20,
          actionType: 'candidates',
        }),
      ],
    });

    const preview = buildCumulativePreview(result)!;
    const output = formatCumulativeFixPreview(preview);

    assert.ok(output.includes('Cumulative Fix Preview'));
    assert.ok(output.includes('Coverage'));
    assert.ok(output.includes('Hygiene'));
    assert.ok(output.includes('Overall'));
  });

  it('shows maturity stage transition when changed', () => {
    const result = makeHealthResult({
      health: {
        level: 'warning',
        score: 40,
        coverage: 40,
        hygiene: 50,
        summary: 'test',
      },
      maturityStage: 'Foundation',
      nextSteps: {
        quadrant: 'low-coverage-low-hygiene',
        label: 'Needs foundation work',
        steps: [],
      },
      prescriptions: [
        makePrescription({
          axis: 'coverage',
          scoreImpact: 60,
          actionType: 'candidates',
        }),
        makePrescription({
          axis: 'hygiene',
          scoreImpact: 50,
          actionType: 'triage',
        }),
      ],
    });

    const preview = buildCumulativePreview(result)!;
    const output = formatCumulativeFixPreview(preview);

    assert.ok(output.includes('Foundation'));
    assert.ok(output.includes('Autonomous'));
    assert.ok(output.includes('→'));
  });

  it('shows no-change for maturity stage when unchanged', () => {
    const result = makeHealthResult({
      health: {
        level: 'warning',
        score: 40,
        coverage: 40,
        hygiene: 50,
        summary: 'test',
      },
      maturityStage: 'Foundation',
      nextSteps: {
        quadrant: 'low-coverage-low-hygiene',
        label: 'Needs foundation work',
        steps: [],
      },
      prescriptions: [
        makePrescription({
          axis: 'hygiene',
          scoreImpact: 5,
          actionType: 'triage',
        }),
      ],
    });

    const preview = buildCumulativePreview(result)!;
    const output = formatCumulativeFixPreview(preview);

    assert.ok(output.includes('no change'));
  });

  it('marks automatable vs manual prescriptions', () => {
    const result = makeHealthResult({
      prescriptions: [
        makePrescription({
          axis: 'hygiene',
          scoreImpact: 5,
          actionType: 'update',
        }),
        makePrescription({
          axis: 'hygiene',
          scoreImpact: 10,
          actionType: 'triage',
        }),
      ],
    });

    const preview = buildCumulativePreview(result)!;
    const output = formatCumulativeFixPreview(preview);

    assert.ok(output.includes('[auto]'));
    assert.ok(output.includes('[manual]'));
  });
});
