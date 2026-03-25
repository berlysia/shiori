import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatAdoptCompletionSummary,
  buildNextStepCTA,
  type AdoptResult,
} from '../src/commands/adopt.ts';
import type { ShioriCandidate } from '../src/core/types.ts';

function makeCandidate(
  overrides: Partial<ShioriCandidate> = {},
): ShioriCandidate {
  return {
    pattern: 'eslint',
    location: { file: 'src/test.ts', line: 10 },
    ...overrides,
  };
}

function makeAdoptResult(overrides: Partial<AdoptResult> = {}): AdoptResult {
  return {
    migrate: {
      actions: [
        {
          file: 'src/test.ts',
          line: 10,
          ref: 'ADOPT-001',
          candidate: makeCandidate({ rule: 'no-console' }),
          rules: ['no-console'],
        },
      ],
      registry: {
        'ADOPT-001': {
          reason: 'adopted',
          target: 'src/test.ts',
          expires: undefined,
          ticket: undefined,
          owner: undefined,
          notes: undefined,
          kind: 'adoption',
        },
      },
    },
    groups: [{ pattern: 'eslint', directive: 'disable-next-line', count: 1 }],
    filesAffected: 1,
    ...overrides,
  };
}

describe('buildNextStepCTA', () => {
  it('recommends triage for score < 60', () => {
    const cta = buildNextStepCTA(30);
    assert.equal(cta.command, 'shiori triage');
    assert.ok(cta.message.includes('shiori triage'));
  });

  it('recommends triage for score = 0', () => {
    const cta = buildNextStepCTA(0);
    assert.equal(cta.command, 'shiori triage');
  });

  it('recommends triage for score = 59', () => {
    const cta = buildNextStepCTA(59);
    assert.equal(cta.command, 'shiori triage');
  });

  it('recommends health --triage for score = 60', () => {
    const cta = buildNextStepCTA(60);
    assert.equal(cta.command, 'shiori health --triage');
    assert.ok(cta.message.includes('shiori health --triage'));
  });

  it('recommends health --triage for score = 89', () => {
    const cta = buildNextStepCTA(89);
    assert.equal(cta.command, 'shiori health --triage');
  });

  it('recommends health for score = 90', () => {
    const cta = buildNextStepCTA(90);
    assert.equal(cta.command, 'shiori health');
    assert.ok(cta.message.includes('shiori health'));
    // Should not contain --triage
    assert.ok(!cta.message.includes('--triage'));
  });

  it('recommends health for score = 100', () => {
    const cta = buildNextStepCTA(100);
    assert.equal(cta.command, 'shiori health');
  });
});

describe('formatAdoptCompletionSummary', () => {
  it('shows before/after score with positive delta', () => {
    const result = makeAdoptResult();
    const summary = formatAdoptCompletionSummary({
      result,
      beforeScore: 40,
      afterScore: 75,
    });

    assert.ok(summary.includes('75/100'));
    assert.ok(summary.includes('+35'));
    assert.ok(summary.includes('from adoption'));
  });

  it('shows zero delta', () => {
    const result = makeAdoptResult();
    const summary = formatAdoptCompletionSummary({
      result,
      beforeScore: 80,
      afterScore: 80,
    });

    assert.ok(summary.includes('80/100'));
    assert.ok(summary.includes('+0'));
  });

  it('shows negative delta', () => {
    const result = makeAdoptResult();
    const summary = formatAdoptCompletionSummary({
      result,
      beforeScore: 90,
      afterScore: 85,
    });

    assert.ok(summary.includes('85/100'));
    assert.ok(summary.includes('-5'));
  });

  it('includes adoption count', () => {
    const result = makeAdoptResult({
      migrate: {
        actions: [
          {
            file: 'a.ts',
            line: 1,
            ref: 'ADOPT-001',
            candidate: makeCandidate({
              rule: 'no-console',
              location: { file: 'a.ts', line: 1 },
            }),
            rules: ['no-console'],
          },
          {
            file: 'b.ts',
            line: 2,
            ref: 'ADOPT-002',
            candidate: makeCandidate({
              rule: 'no-debugger',
              location: { file: 'b.ts', line: 2 },
            }),
            rules: ['no-debugger'],
          },
          {
            file: 'c.ts',
            line: 3,
            ref: 'ADOPT-003',
            candidate: makeCandidate({
              rule: 'no-var',
              location: { file: 'c.ts', line: 3 },
            }),
            rules: ['no-var'],
          },
        ],
        registry: {},
      },
      filesAffected: 3,
    });
    const summary = formatAdoptCompletionSummary({
      result,
      beforeScore: 50,
      afterScore: 70,
    });

    assert.ok(summary.includes('3 annotation(s)'));
    assert.ok(summary.includes('3 file(s)'));
  });

  it('includes dynamic CTA for low score', () => {
    const result = makeAdoptResult();
    const summary = formatAdoptCompletionSummary({
      result,
      beforeScore: 20,
      afterScore: 45,
    });

    assert.ok(summary.includes('shiori triage'));
    assert.ok(summary.includes('Next step'));
  });

  it('includes dynamic CTA for medium score', () => {
    const result = makeAdoptResult();
    const summary = formatAdoptCompletionSummary({
      result,
      beforeScore: 50,
      afterScore: 75,
    });

    assert.ok(summary.includes('shiori health --triage'));
  });

  it('includes dynamic CTA for high score', () => {
    const result = makeAdoptResult();
    const summary = formatAdoptCompletionSummary({
      result,
      beforeScore: 85,
      afterScore: 95,
    });

    assert.ok(summary.includes('shiori health'));
    // Should not include --triage for high scores
    assert.ok(!summary.includes('--triage'));
  });

  it('uses correct emoji for each health level', () => {
    const result = makeAdoptResult();

    // Critical (< 50)
    const critical = formatAdoptCompletionSummary({
      result,
      beforeScore: 10,
      afterScore: 30,
    });
    assert.ok(critical.includes('🔴'));

    // Warning (50-79)
    const warning = formatAdoptCompletionSummary({
      result,
      beforeScore: 40,
      afterScore: 65,
    });
    assert.ok(warning.includes('🟡'));

    // Healthy (>= 80)
    const healthy = formatAdoptCompletionSummary({
      result,
      beforeScore: 75,
      afterScore: 90,
    });
    assert.ok(healthy.includes('🟢'));
  });
});
