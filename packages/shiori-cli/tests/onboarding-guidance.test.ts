import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatOnboardingGuidance,
  shouldShowOnboardingGuidance,
  type OnboardingGuidanceOptions,
} from '../src/core/onboarding-guidance.ts';

/** Base options: high unregistered rate, text format, TTY — should trigger guidance */
const baseOptions: OnboardingGuidanceOptions = {
  context: {
    totalUniqueRefs: 10,
    missingInRegistryCount: 8,
  },
  format: 'text',
  isTTY: true,
};

describe('shouldShowOnboardingGuidance', () => {
  it('returns true when unregistered rate >= 50%, TTY, human-readable format', () => {
    assert.equal(shouldShowOnboardingGuidance(baseOptions), true);
  });

  it('returns false when totalUniqueRefs is 0 (no annotations)', () => {
    assert.equal(
      shouldShowOnboardingGuidance({
        ...baseOptions,
        context: { totalUniqueRefs: 0, missingInRegistryCount: 0 },
      }),
      false,
    );
  });

  it('returns false when unregistered rate < 50%', () => {
    assert.equal(
      shouldShowOnboardingGuidance({
        ...baseOptions,
        context: { totalUniqueRefs: 10, missingInRegistryCount: 4 },
      }),
      false,
    );
  });

  it('returns false for json format', () => {
    assert.equal(
      shouldShowOnboardingGuidance({ ...baseOptions, format: 'json' }),
      false,
    );
  });

  it('returns false for sarif format', () => {
    assert.equal(
      shouldShowOnboardingGuidance({ ...baseOptions, format: 'sarif' }),
      false,
    );
  });

  it('returns false for jsonl format', () => {
    assert.equal(
      shouldShowOnboardingGuidance({ ...baseOptions, format: 'jsonl' }),
      false,
    );
  });

  it('returns false for summary format', () => {
    assert.equal(
      shouldShowOnboardingGuidance({ ...baseOptions, format: 'summary' }),
      false,
    );
  });

  it('returns true for markdown format (human-readable)', () => {
    assert.equal(
      shouldShowOnboardingGuidance({ ...baseOptions, format: 'markdown' }),
      true,
    );
  });

  it('returns true for diagnostic format (human-readable)', () => {
    assert.equal(
      shouldShowOnboardingGuidance({ ...baseOptions, format: 'diagnostic' }),
      true,
    );
  });

  it('returns false when stderr is not a TTY', () => {
    assert.equal(
      shouldShowOnboardingGuidance({ ...baseOptions, isTTY: false }),
      false,
    );
  });

  it('returns true at exactly 50% threshold', () => {
    assert.equal(
      shouldShowOnboardingGuidance({
        ...baseOptions,
        context: { totalUniqueRefs: 10, missingInRegistryCount: 5 },
      }),
      true,
    );
  });

  it('returns false just below 50% threshold', () => {
    assert.equal(
      shouldShowOnboardingGuidance({
        ...baseOptions,
        context: { totalUniqueRefs: 100, missingInRegistryCount: 49 },
      }),
      false,
    );
  });
});

describe('formatOnboardingGuidance', () => {
  it('returns guidance lines when conditions are met', () => {
    const lines = formatOnboardingGuidance(baseOptions);

    assert.ok(lines.length > 0, 'Expected non-empty guidance lines');
  });

  it('returns empty array when suppressed', () => {
    const lines = formatOnboardingGuidance({
      ...baseOptions,
      context: { totalUniqueRefs: 10, missingInRegistryCount: 2 },
    });

    assert.deepEqual(lines, []);
  });

  it('includes adopt, health, and triage in guidance content', () => {
    const lines = formatOnboardingGuidance(baseOptions);
    const text = lines.join('\n');

    assert.ok(text.includes('adopt'), 'Expected guidance to mention adopt');
    assert.ok(text.includes('health'), 'Expected guidance to mention health');
    assert.ok(text.includes('triage'), 'Expected guidance to mention triage');
  });

  it('includes step numbers for progressive workflow', () => {
    const lines = formatOnboardingGuidance(baseOptions);
    const text = lines.join('\n');

    assert.ok(text.includes('Step 1'), 'Expected Step 1');
    assert.ok(text.includes('Step 2'), 'Expected Step 2');
    assert.ok(text.includes('Step 3'), 'Expected Step 3');
  });

  it('includes guide command reference', () => {
    const lines = formatOnboardingGuidance(baseOptions);
    const text = lines.join('\n');

    assert.ok(text.includes('shiori guide'), 'Expected shiori guide reference');
  });
});
