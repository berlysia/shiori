import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeNextSteps,
  formatNextSteps,
  type NextStepsInput,
} from '../src/commands/next-steps.ts';

const baseInput: NextStepsInput = {
  annotationCount: 0,
  candidateCount: 0,
  registryEntryCount: 0,
  hasCi: false,
  ciOnly: false,
  hasStarter: false,
  hasVscode: false,
  vscodeOnly: false,
};

describe('computeNextSteps', () => {
  it('returns basic steps for empty project', () => {
    const result = computeNextSteps(baseInput);

    assert.ok(result.steps.length > 0);
    // Should include check and CI guidance
    assert.ok(
      result.steps.some((s) => s.command === 'shiori check'),
      'Expected shiori check step',
    );
    assert.ok(
      result.steps.some((s) => s.command === 'shiori init --ci basic'),
      'Expected CI suggestion',
    );
  });

  it('prioritizes adopt when candidates exist', () => {
    const result = computeNextSteps({
      ...baseInput,
      candidateCount: 5,
    });

    // First step should be adopt
    assert.equal(result.steps[0]?.step, 1);
    assert.equal(result.steps[0]?.command, 'shiori adopt');
    assert.ok(result.steps[0]?.message.includes('5 untracked'));
  });

  it('includes registry review when entries exist', () => {
    const result = computeNextSteps({
      ...baseInput,
      registryEntryCount: 3,
    });

    assert.ok(
      result.steps.some((s) =>
        s.message.includes('Review and fill in registry entries'),
      ),
    );
  });

  it('suggests update when annotations exist but registry is empty', () => {
    const result = computeNextSteps({
      ...baseInput,
      annotationCount: 5,
      registryEntryCount: 0,
    });

    assert.ok(
      result.steps.some((s) => s.command === 'shiori update'),
      'Expected shiori update step',
    );
  });

  it('does not suggest update when registry has entries', () => {
    const result = computeNextSteps({
      ...baseInput,
      annotationCount: 5,
      registryEntryCount: 5,
    });

    assert.ok(
      !result.steps.some((s) => s.command === 'shiori update'),
      'Should not suggest update when registry has entries',
    );
  });

  it('shows CI workflow path when --ci was used', () => {
    const result = computeNextSteps({
      ...baseInput,
      hasCi: true,
      ciPath: '.github/workflows/shiori.yml',
    });

    assert.ok(
      result.steps.some((s) =>
        s.message.includes('.github/workflows/shiori.yml'),
      ),
    );
    assert.ok(result.steps.some((s) => s.message.includes('Commit and push')));
    // Should NOT suggest init --ci basic
    assert.ok(
      !result.steps.some((s) => s.command === 'shiori init --ci basic'),
    );
  });

  it('returns minimal steps for ci-only mode', () => {
    const result = computeNextSteps({
      ...baseInput,
      ciOnly: true,
      hasCi: true,
      ciPath: '.github/workflows/shiori.yml',
    });

    assert.equal(result.steps.length, 2);
    assert.ok(
      result.steps[0]?.message.includes('.github/workflows/shiori.yml'),
    );
    assert.ok(result.steps[1]?.message.includes('Commit and push'));
  });

  it('returns minimal steps for vscode-only mode', () => {
    const result = computeNextSteps({
      ...baseInput,
      vscodeOnly: true,
      hasVscode: true,
    });

    assert.equal(result.steps.length, 1);
    assert.ok(result.steps[0]?.message.includes('Tasks: Run Task'));
    assert.ok(result.steps[0]?.message.includes('Problems panel'));
    // Should NOT include project-init guidance
    assert.ok(!result.steps.some((s) => s.command === 'shiori check'));
    assert.ok(
      !result.steps.some((s) => s.command === 'shiori init --ci basic'),
    );
  });

  it('shows VS Code guidance when hasVscode is true in full init', () => {
    const result = computeNextSteps({
      ...baseInput,
      hasVscode: true,
    });

    assert.ok(
      result.steps.some((s) => s.message.includes('Tasks: Run Task')),
      'Expected VS Code usage guidance',
    );
    // Should NOT suggest init --vscode
    assert.ok(
      !result.steps.some((s) => s.command === 'shiori init --vscode'),
      'Should not suggest --vscode when already used',
    );
  });

  it('suggests --vscode when hasVscode is false', () => {
    const result = computeNextSteps(baseInput);

    assert.ok(
      result.steps.some((s) => s.command === 'shiori init --vscode'),
      'Expected --vscode suggestion',
    );
  });

  it('includes VS Code guidance in ci-only mode when hasVscode is true', () => {
    const result = computeNextSteps({
      ...baseInput,
      ciOnly: true,
      hasCi: true,
      ciPath: '.github/workflows/shiori.yml',
      hasVscode: true,
    });

    assert.equal(result.steps.length, 3);
    assert.ok(
      result.steps[0]?.message.includes('.github/workflows/shiori.yml'),
    );
    assert.ok(result.steps[1]?.message.includes('Commit and push'));
    assert.ok(result.steps[2]?.message.includes('Tasks: Run Task'));
  });

  it('includes docs hint for starter with no candidates', () => {
    const result = computeNextSteps({
      ...baseInput,
      hasStarter: true,
      candidateCount: 0,
    });

    assert.ok(
      result.steps.some((s) => s.command === 'shiori docs'),
      'Expected docs hint for starter',
    );
  });

  it('does not include docs hint for starter with candidates', () => {
    const result = computeNextSteps({
      ...baseInput,
      hasStarter: true,
      candidateCount: 3,
    });

    assert.ok(
      !result.steps.some((s) => s.command === 'shiori docs'),
      'Should not show docs when candidates need attention',
    );
  });

  it('suggests --starter when 0 annotations and 0 candidates without starter', () => {
    const result = computeNextSteps(baseInput);

    assert.ok(
      result.steps.some((s) => s.command === 'shiori init --starter eslint'),
      'Expected --starter suggestion for empty project',
    );
    assert.ok(
      result.steps.some((s) => s.message.includes('No annotations found')),
      'Expected message about no annotations',
    );
  });

  it('does not suggest --starter when annotations exist', () => {
    const result = computeNextSteps({
      ...baseInput,
      annotationCount: 3,
    });

    assert.ok(
      !result.steps.some((s) => s.command === 'shiori init --starter eslint'),
      'Should not suggest --starter when annotations exist',
    );
  });

  it('does not suggest --starter when candidates exist', () => {
    const result = computeNextSteps({
      ...baseInput,
      candidateCount: 2,
    });

    assert.ok(
      !result.steps.some((s) => s.command === 'shiori init --starter eslint'),
      'Should not suggest --starter when candidates exist',
    );
  });

  it('does not suggest --starter when starter was already used', () => {
    const result = computeNextSteps({
      ...baseInput,
      hasStarter: true,
    });

    assert.ok(
      !result.steps.some((s) => s.command === 'shiori init --starter eslint'),
      'Should not suggest --starter when starter was already used',
    );
  });

  it('uses custom registryPath in registry review command', () => {
    const result = computeNextSteps({
      ...baseInput,
      registryEntryCount: 3,
      registryPath: 'custom/registry.yaml',
    });

    const registryStep = result.steps.find((s) =>
      s.message.includes('Review and fill in registry entries'),
    );
    assert.ok(registryStep);
    assert.equal(registryStep.command, 'cat custom/registry.yaml');
  });

  it('uses default registry path when registryPath is not provided', () => {
    const result = computeNextSteps({
      ...baseInput,
      registryEntryCount: 3,
    });

    const registryStep = result.steps.find((s) =>
      s.message.includes('Review and fill in registry entries'),
    );
    assert.ok(registryStep);
    assert.equal(registryStep.command, 'cat .config/shiori/registry.json');
  });

  it('step numbers are sequential', () => {
    const result = computeNextSteps({
      ...baseInput,
      candidateCount: 5,
      registryEntryCount: 3,
      hasCi: true,
      ciPath: '.github/workflows/shiori.yml',
    });

    for (let i = 0; i < result.steps.length; i++) {
      assert.equal(result.steps[i]?.step, i + 1);
    }
  });
});

describe('formatNextSteps', () => {
  it('formats steps with header', () => {
    const result = computeNextSteps({
      ...baseInput,
      candidateCount: 2,
    });
    const lines = formatNextSteps(result);

    assert.equal(lines[0], 'Next steps:');
    assert.ok(lines[1]?.startsWith('  1.'));
  });

  it('includes command indented under step', () => {
    const result = computeNextSteps({
      ...baseInput,
      candidateCount: 2,
    });
    const lines = formatNextSteps(result);

    // Find the adopt step and its command
    const adoptStepIdx = lines.findIndex((l) => l.includes('untracked'));
    assert.ok(adoptStepIdx >= 0);
    assert.equal(lines[adoptStepIdx + 1], '     shiori adopt');
  });
});
