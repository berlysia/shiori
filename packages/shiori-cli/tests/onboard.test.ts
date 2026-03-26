import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PitchResult, RecommendedAction } from '../src/core/types.ts';
import {
  buildOnboardSteps,
  formatOnboardAsText,
  isPitchEnvelope,
} from '../src/commands/onboard.ts';
import { wrapOutput } from '../src/core/schema-envelope.ts';

function makePitchResult(overrides: Partial<PitchResult> = {}): PitchResult {
  return {
    timestamp: '2026-03-26T00:00:00.000Z',
    teamName: 'Test Team',
    headline: 'Test Team: Governance score 80/100 -- ready to enforce in CI',
    health: { score: 80, level: 'healthy' },
    highlights: [],
    nextSteps: ['shiori health --trend  # Monitor governance trend'],
    ...overrides,
  };
}

function makeRecommendedAction(
  overrides: Partial<RecommendedAction> = {},
): RecommendedAction {
  return {
    action: 'health',
    command: 'shiori health --trend',
    args: ['--trend'],
    reason: 'Monitor governance trend',
    priority: 1,
    ...overrides,
  };
}

describe('buildOnboardSteps', () => {
  it('returns empty array when recommendedActions is undefined', () => {
    const result = makePitchResult({ recommendedActions: undefined });
    const steps = buildOnboardSteps(result);
    assert.deepEqual(steps, []);
  });

  it('returns empty array when recommendedActions is empty', () => {
    const result = makePitchResult({ recommendedActions: [] });
    const steps = buildOnboardSteps(result);
    assert.deepEqual(steps, []);
  });

  it('generates steps from recommendedActions', () => {
    const result = makePitchResult({
      recommendedActions: [
        makeRecommendedAction({
          action: 'triage',
          command: 'shiori triage --expired-only',
          args: ['--expired-only'],
          reason: 'Review and resolve expired annotations',
          priority: 1,
        }),
        makeRecommendedAction({
          action: 'update',
          command: 'shiori update',
          args: [],
          reason: 'Register untracked annotations',
          priority: 2,
        }),
      ],
    });

    const steps = buildOnboardSteps(result);

    assert.equal(steps.length, 2);
    assert.equal(steps[0]!.stepNumber, 1);
    assert.equal(steps[0]!.action, 'triage');
    assert.equal(steps[0]!.command, 'shiori triage --expired-only');
    assert.equal(steps[0]!.reason, 'Review and resolve expired annotations');
    assert.equal(steps[1]!.stepNumber, 2);
    assert.equal(steps[1]!.action, 'update');
  });

  it('sorts steps by priority', () => {
    const result = makePitchResult({
      recommendedActions: [
        makeRecommendedAction({
          action: 'adopt',
          command: 'shiori adopt',
          reason: 'Convert lint disables',
          priority: 3,
        }),
        makeRecommendedAction({
          action: 'triage',
          command: 'shiori triage --expired-only',
          reason: 'Review expired',
          priority: 1,
        }),
        makeRecommendedAction({
          action: 'update',
          command: 'shiori update',
          reason: 'Register untracked',
          priority: 2,
        }),
      ],
    });

    const steps = buildOnboardSteps(result);

    assert.equal(steps.length, 3);
    assert.equal(steps[0]!.action, 'triage');
    assert.equal(steps[0]!.stepNumber, 1);
    assert.equal(steps[1]!.action, 'update');
    assert.equal(steps[1]!.stepNumber, 2);
    assert.equal(steps[2]!.action, 'adopt');
    assert.equal(steps[2]!.stepNumber, 3);
  });
});

describe('formatOnboardAsText', () => {
  it('shows empty message when no steps', () => {
    const output = formatOnboardAsText([]);
    assert.ok(output.includes('No recommended actions'));
    assert.ok(output.includes('shiori pitch -f json'));
  });

  it('formats steps with team name', () => {
    const steps = buildOnboardSteps(
      makePitchResult({
        recommendedActions: [
          makeRecommendedAction({
            action: 'triage',
            command: 'shiori triage --expired-only',
            reason: 'Review expired annotations',
            priority: 1,
          }),
        ],
      }),
    );

    const output = formatOnboardAsText(steps, 'My Team');
    assert.ok(output.includes('Onboard steps for "My Team":'));
    assert.ok(output.includes('Step 1: Review expired annotations'));
    assert.ok(output.includes('$ shiori triage --expired-only'));
    assert.ok(output.includes('1 step(s) total.'));
  });

  it('formats steps without team name', () => {
    const steps = buildOnboardSteps(
      makePitchResult({
        recommendedActions: [makeRecommendedAction({ priority: 1 })],
      }),
    );

    const output = formatOnboardAsText(steps);
    assert.ok(output.startsWith('Onboard steps:'));
  });

  it('formats multiple steps', () => {
    const steps = buildOnboardSteps(
      makePitchResult({
        recommendedActions: [
          makeRecommendedAction({
            action: 'triage',
            command: 'shiori triage --expired-only',
            reason: 'Review expired',
            priority: 1,
          }),
          makeRecommendedAction({
            action: 'update',
            command: 'shiori update',
            reason: 'Register untracked',
            priority: 2,
          }),
        ],
      }),
    );

    const output = formatOnboardAsText(steps, 'T');
    assert.ok(output.includes('Step 1:'));
    assert.ok(output.includes('Step 2:'));
    assert.ok(output.includes('2 step(s) total.'));
  });
});

describe('isPitchEnvelope', () => {
  it('accepts valid pitch envelope', () => {
    const envelope = wrapOutput(makePitchResult(), {
      command: 'pitch',
      schemaVersion: 1,
    });
    assert.equal(isPitchEnvelope(envelope), true);
  });

  it('accepts pitch envelope with recommendedActions', () => {
    const result = makePitchResult({
      recommendedActions: [makeRecommendedAction({ priority: 1 })],
    });
    const envelope = wrapOutput(result, {
      command: 'pitch',
      schemaVersion: 1,
    });
    assert.equal(isPitchEnvelope(envelope), true);
  });

  it('accepts pitch envelope without recommendedActions (backward compat)', () => {
    const result = makePitchResult({ recommendedActions: undefined });
    const envelope = wrapOutput(result, {
      command: 'pitch',
      schemaVersion: 1,
    });
    assert.equal(isPitchEnvelope(envelope), true);
  });

  it('rejects non-object input', () => {
    assert.equal(isPitchEnvelope(null), false);
    assert.equal(isPitchEnvelope(undefined), false);
    assert.equal(isPitchEnvelope('string'), false);
    assert.equal(isPitchEnvelope(42), false);
  });

  it('rejects envelope with wrong command', () => {
    const envelope = wrapOutput(makePitchResult(), {
      command: 'report',
      schemaVersion: 1,
    });
    assert.equal(isPitchEnvelope(envelope), false);
  });

  it('rejects envelope with missing meta', () => {
    assert.equal(isPitchEnvelope({ data: makePitchResult() }), false);
  });

  it('rejects envelope with non-PitchResult data', () => {
    const envelope = wrapOutput(
      { invalid: true },
      {
        command: 'pitch',
        schemaVersion: 1,
      },
    );
    assert.equal(isPitchEnvelope(envelope), false);
  });

  it('rejects envelope with invalid recommendedActions (not array)', () => {
    const result = makePitchResult();
    const envelope = wrapOutput(result, {
      command: 'pitch',
      schemaVersion: 1,
    });
    // Manually inject invalid recommendedActions
    (envelope.data as unknown as Record<string, unknown>).recommendedActions =
      'not-array';
    assert.equal(isPitchEnvelope(envelope), false);
  });

  it('rejects envelope with malformed recommendedAction item', () => {
    const result = makePitchResult();
    const envelope = wrapOutput(result, {
      command: 'pitch',
      schemaVersion: 1,
    });
    // Manually inject invalid action item (missing required fields)
    (envelope.data as unknown as Record<string, unknown>).recommendedActions = [
      { action: 'triage' }, // missing command, args, reason, priority
    ];
    assert.equal(isPitchEnvelope(envelope), false);
  });
});
