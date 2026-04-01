import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getStageRecommendations,
  formatGuidedEscalation,
} from '../src/core/guided-escalation.ts';
import type { HealthMaturityStage } from '../src/core/types.ts';

// ── getStageRecommendations ──────────────────────────────────

describe('getStageRecommendations', () => {
  const stages: HealthMaturityStage[] = [
    'Foundation',
    'Tracking',
    'Maintained',
    'Autonomous',
  ];

  for (const stage of stages) {
    it(`returns non-empty recommendations for ${stage}`, () => {
      const steps = getStageRecommendations(stage);
      assert.ok(steps.length >= 2, `Expected ≥2 steps for ${stage}`);
      assert.ok(steps.length <= 3, `Expected ≤3 steps for ${stage}`);
    });
  }

  for (const stage of stages) {
    it(`each step has message and command for ${stage}`, () => {
      const steps = getStageRecommendations(stage);
      for (const step of steps) {
        assert.ok(
          step.message.length > 0,
          `Empty message in ${stage} recommendation`,
        );
        assert.ok(
          step.command.startsWith('shiori '),
          `Command should start with "shiori " in ${stage}: ${step.command}`,
        );
      }
    });
  }

  it('Foundation recommends adopt as first step', () => {
    const steps = getStageRecommendations('Foundation');
    assert.ok(
      steps[0]!.command.includes('adopt'),
      `Foundation first step should include adopt: ${steps[0]!.command}`,
    );
  });

  it('Tracking recommends triage as first step', () => {
    const steps = getStageRecommendations('Tracking');
    assert.ok(
      steps[0]!.command.includes('triage'),
      `Tracking first step should include triage: ${steps[0]!.command}`,
    );
  });

  it('Maintained recommends health --fix as first step', () => {
    const steps = getStageRecommendations('Maintained');
    assert.ok(
      steps[0]!.command.includes('health'),
      `Maintained first step should include health: ${steps[0]!.command}`,
    );
  });

  it('Autonomous recommends check as first step', () => {
    const steps = getStageRecommendations('Autonomous');
    assert.ok(
      steps[0]!.command.includes('check'),
      `Autonomous first step should include check: ${steps[0]!.command}`,
    );
  });
});

// ── formatGuidedEscalation ───────────────────────────────────

describe('formatGuidedEscalation', () => {
  it('returns empty string for undefined stage', () => {
    assert.equal(formatGuidedEscalation(undefined), '');
  });

  it('starts with 💡 Next steps header', () => {
    const output = formatGuidedEscalation('Foundation');
    assert.ok(output.startsWith('💡 Next steps:'));
  });

  it('contains numbered steps', () => {
    const output = formatGuidedEscalation('Foundation');
    assert.ok(output.includes('  1.'), 'Should contain step 1');
    assert.ok(output.includes('  2.'), 'Should contain step 2');
  });

  it('contains → command prefix', () => {
    const output = formatGuidedEscalation('Tracking');
    assert.ok(output.includes('→ shiori'), 'Should contain → command prefix');
  });

  it('includes all steps for the stage', () => {
    const stages: HealthMaturityStage[] = [
      'Foundation',
      'Tracking',
      'Maintained',
      'Autonomous',
    ];

    for (const stage of stages) {
      const output = formatGuidedEscalation(stage);
      const steps = getStageRecommendations(stage);
      for (const step of steps) {
        assert.ok(
          output.includes(step.command),
          `Output for ${stage} should include command: ${step.command}`,
        );
        assert.ok(
          output.includes(step.message),
          `Output for ${stage} should include message: ${step.message}`,
        );
      }
    }
  });

  it('Foundation output includes adopt command', () => {
    const output = formatGuidedEscalation('Foundation');
    assert.ok(output.includes('shiori adopt'));
  });

  it('Autonomous output includes check command', () => {
    const output = formatGuidedEscalation('Autonomous');
    assert.ok(output.includes('shiori check'));
  });
});
