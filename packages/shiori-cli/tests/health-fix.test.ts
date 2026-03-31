import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  HealthPrescription,
  PrescriptionActionType,
} from '../src/core/types.ts';
import {
  planFix,
  formatFixPreview,
  formatFixResult,
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
