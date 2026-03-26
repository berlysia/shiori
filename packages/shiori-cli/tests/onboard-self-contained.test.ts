/**
 * Tests for self-contained onboard (EP-0187), CTA (EP-0186),
 * summary formatting (EP-0182), and interactive wizard.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import type { RecommendedAction, ReportResult } from '../src/core/types.ts';
import {
  buildOnboardStepsFromActions,
  buildOnboardCTA,
  buildOnboardSummary,
  formatOnboardSummaryAsMarkdown,
  formatOnboardSummaryAsText,
  type OnboardStep,
  type OnboardSummary,
} from '../src/commands/onboard.ts';
import {
  wizardOnboardSession,
  type InteractiveOnboardContext,
  type OnboardSessionResult,
} from '../src/commands/onboard-interactive.ts';

// ── Helpers ──────────────────────────────────────────────────

function makeAction(
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

function makeSteps(count: number): OnboardStep[] {
  return Array.from({ length: count }, (_, i) => ({
    stepNumber: i + 1,
    action: 'health' as const,
    command: `shiori step-${i + 1}`,
    reason: `Reason for step ${i + 1}`,
  }));
}

function makeSummary(overrides: Partial<OnboardSummary> = {}): OnboardSummary {
  return {
    teamName: 'Test Team',
    beforeScore: 50,
    afterScore: 50,
    scoreDelta: 0,
    steps: makeSteps(2),
    cta: buildOnboardCTA(50),
    ...overrides,
  };
}

// ── buildOnboardStepsFromActions ─────────────────────────────

describe('buildOnboardStepsFromActions', () => {
  it('returns empty array for empty actions', () => {
    const steps = buildOnboardStepsFromActions([]);
    assert.deepEqual(steps, []);
  });

  it('generates steps from actions', () => {
    const actions = [
      makeAction({
        action: 'triage',
        command: 'shiori triage --expired-only',
        reason: 'Review expired',
        priority: 1,
      }),
      makeAction({
        action: 'update',
        command: 'shiori update',
        reason: 'Register untracked',
        priority: 2,
      }),
    ];

    const steps = buildOnboardStepsFromActions(actions);
    assert.equal(steps.length, 2);
    assert.equal(steps[0]!.stepNumber, 1);
    assert.equal(steps[0]!.action, 'triage');
    assert.equal(steps[1]!.stepNumber, 2);
    assert.equal(steps[1]!.action, 'update');
  });

  it('sorts by priority', () => {
    const actions = [
      makeAction({ priority: 3, action: 'adopt', command: 'shiori adopt' }),
      makeAction({
        priority: 1,
        action: 'triage',
        command: 'shiori triage',
      }),
      makeAction({ priority: 2, action: 'update', command: 'shiori update' }),
    ];

    const steps = buildOnboardStepsFromActions(actions);
    assert.equal(steps[0]!.action, 'triage');
    assert.equal(steps[1]!.action, 'update');
    assert.equal(steps[2]!.action, 'adopt');
  });
});

// ── buildOnboardCTA ─────────────────────────────────────────

describe('buildOnboardCTA', () => {
  it('returns critical CTA for score < 40', () => {
    const cta = buildOnboardCTA(20);
    assert.equal(cta.tier, 'critical');
    assert.ok(cta.command.includes('check'));
    assert.ok(cta.reason.includes('40'));
  });

  it('returns critical CTA for score 0', () => {
    const cta = buildOnboardCTA(0);
    assert.equal(cta.tier, 'critical');
  });

  it('returns growing CTA for score 40-70', () => {
    const cta = buildOnboardCTA(40);
    assert.equal(cta.tier, 'growing');
    assert.ok(cta.command.includes('snapshot'));
  });

  it('returns growing CTA for score 70', () => {
    const cta = buildOnboardCTA(70);
    assert.equal(cta.tier, 'growing');
  });

  it('returns healthy CTA for score > 70', () => {
    const cta = buildOnboardCTA(80);
    assert.equal(cta.tier, 'healthy');
    assert.ok(cta.command.includes('trend'));
  });

  it('returns healthy CTA for score 100', () => {
    const cta = buildOnboardCTA(100);
    assert.equal(cta.tier, 'healthy');
  });
});

// ── buildOnboardSummary ──────────────────────────────────────

describe('buildOnboardSummary', () => {
  it('builds summary with correct fields', () => {
    const steps = makeSteps(3);
    const summary = buildOnboardSummary({
      teamName: 'Frontend',
      beforeScore: 30,
      afterScore: 55,
      steps,
    });

    assert.equal(summary.teamName, 'Frontend');
    assert.equal(summary.beforeScore, 30);
    assert.equal(summary.afterScore, 55);
    assert.equal(summary.scoreDelta, 25);
    assert.equal(summary.steps.length, 3);
    assert.equal(summary.cta.tier, 'growing'); // afterScore = 55
  });

  it('computes negative scoreDelta', () => {
    const summary = buildOnboardSummary({
      teamName: 'Team',
      beforeScore: 80,
      afterScore: 60,
      steps: [],
    });

    assert.equal(summary.scoreDelta, -20);
  });

  it('CTA based on afterScore', () => {
    const summary = buildOnboardSummary({
      teamName: 'Team',
      beforeScore: 20,
      afterScore: 90,
      steps: [],
    });

    assert.equal(summary.cta.tier, 'healthy');
  });
});

// ── formatOnboardSummaryAsMarkdown ──────────────────────────

describe('formatOnboardSummaryAsMarkdown', () => {
  it('includes team name and score', () => {
    const md = formatOnboardSummaryAsMarkdown(makeSummary());
    assert.ok(md.includes('## Onboard Summary: Test Team'));
    assert.ok(md.includes('**Score:**'));
    assert.ok(md.includes('50 → 50'));
    assert.ok(md.includes('(+0)'));
  });

  it('includes steps', () => {
    const md = formatOnboardSummaryAsMarkdown(makeSummary());
    assert.ok(md.includes('### Recommended Steps'));
    assert.ok(md.includes('Reason for step 1'));
    assert.ok(md.includes('shiori step-1'));
  });

  it('includes CTA section', () => {
    const md = formatOnboardSummaryAsMarkdown(makeSummary());
    assert.ok(md.includes('### Next Step'));
    assert.ok(md.includes(makeSummary().cta.label));
  });

  it('formats negative delta with minus sign', () => {
    const md = formatOnboardSummaryAsMarkdown(
      makeSummary({ beforeScore: 80, afterScore: 60, scoreDelta: -20 }),
    );
    assert.ok(md.includes('80 → 60 (-20)'));
  });
});

// ── formatOnboardSummaryAsText ──────────────────────────────

describe('formatOnboardSummaryAsText', () => {
  it('shows score and step count', () => {
    const text = formatOnboardSummaryAsText(makeSummary());
    assert.ok(text.includes('Score: 50 → 50 (+0)'));
    assert.ok(text.includes('Steps: 2 recommended action(s)'));
  });

  it('shows CTA', () => {
    const text = formatOnboardSummaryAsText(makeSummary());
    assert.ok(text.includes('Next:'));
    assert.ok(text.includes('$'));
  });
});

// ── wizardOnboardSession ────────────────────────────────────

/**
 * Create a mock I/O context for onboard wizard tests.
 * Feeds responses when the prompt pattern `[r]un` is detected.
 */
function createMockOnboardContext(responses: string[]): {
  ctx: InteractiveOnboardContext;
  getOutput: () => string;
} {
  const input = new PassThrough();
  const output = new PassThrough();
  let outputBuf = '';

  output.on('data', (chunk: Buffer) => {
    outputBuf += chunk.toString();
  });

  let responseIndex = 0;
  const feedNextResponse = (): void => {
    if (responseIndex < responses.length) {
      const response = responses[responseIndex]!;
      responseIndex++;
      setImmediate(() => {
        input.write(response + '\n');
      });
    }
  };

  // Feed a response when output contains the prompt
  output.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    if (text.includes('[r]un')) {
      feedNextResponse();
    }
  });

  return {
    ctx: { input, output },
    getOutput: () => outputBuf,
  };
}

describe('wizardOnboardSession', () => {
  it('processes all steps with run choices', async () => {
    const { ctx, getOutput } = createMockOnboardContext(['r', 'r']);
    const steps = makeSteps(2);

    const result = await wizardOnboardSession(steps, ctx, {
      beforeScore: 50,
      teamName: 'Test',
    });

    assert.equal(result.processed.length, 2);
    assert.equal(result.remaining, 0);
    assert.equal(result.total, 2);
    assert.equal(result.processed[0]!.choice, 'run');
    assert.equal(result.processed[1]!.choice, 'run');
  });

  it('handles quit early', async () => {
    const { ctx } = createMockOnboardContext(['q']);
    const steps = makeSteps(3);

    const result = await wizardOnboardSession(steps, ctx, { beforeScore: 50 });

    assert.equal(result.processed.length, 1);
    assert.equal(result.processed[0]!.choice, 'quit');
    assert.equal(result.remaining, 2);
    assert.equal(result.total, 3);
  });

  it('handles skip choice', async () => {
    const { ctx } = createMockOnboardContext(['s']);
    const steps = makeSteps(1);

    const result = await wizardOnboardSession(steps, ctx, {
      beforeScore: 80,
      teamName: 'MyTeam',
    });

    assert.equal(result.processed.length, 1);
    assert.equal(result.processed[0]!.choice, 'skip');
    assert.equal(result.remaining, 0);
  });

  it('handles invalid input then valid input', async () => {
    const { ctx } = createMockOnboardContext(['invalid', 'r']);
    const steps = makeSteps(1);

    const result = await wizardOnboardSession(steps, ctx, { beforeScore: 50 });

    assert.equal(result.processed.length, 1);
    assert.equal(result.processed[0]!.choice, 'run');
  });

  it('displays team name in header', async () => {
    const { ctx, getOutput } = createMockOnboardContext(['s']);
    const steps = makeSteps(1);

    await wizardOnboardSession(steps, ctx, {
      beforeScore: 50,
      teamName: 'Frontend',
    });

    assert.ok(getOutput().includes('Frontend'));
  });

  it('returns empty result for empty steps', async () => {
    const { ctx } = createMockOnboardContext([]);

    const result = await wizardOnboardSession([], ctx, { beforeScore: 100 });

    assert.equal(result.processed.length, 0);
    assert.equal(result.remaining, 0);
    assert.equal(result.total, 0);
  });
});
