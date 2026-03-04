/**
 * Compute state-adaptive "Next Steps" guidance after init.
 *
 * Pure function — no IO. Takes the init outcome and returns
 * prioritized guidance lines that adapt to what was found/created.
 */

export interface NextStepsInput {
  /** Number of annotations found in scan */
  annotationCount: number;
  /** Number of candidates (untracked lint disables) found */
  candidateCount: number;
  /** Number of registry entries created/existing */
  registryEntryCount: number;
  /** Whether --ci was used */
  hasCi: boolean;
  /** Whether --ci-only was used (skip project init) */
  ciOnly: boolean;
  /** CI template path (for display) */
  ciPath?: string;
  /** Whether --starter was used */
  hasStarter: boolean;
}

export interface NextStep {
  /** Step number (for display) */
  step: number;
  /** Human-readable instruction */
  message: string;
  /** Optional command to run */
  command?: string;
}

export interface NextStepsResult {
  steps: NextStep[];
}

/**
 * Compute next steps based on init outcome.
 *
 * Priority order adapts to what the init found:
 * 1. If candidates exist → suggest `shiori adopt` first (biggest quick win)
 * 2. If annotations exist but registry is sparse → suggest filling registry
 * 3. Always suggest `shiori check` to verify
 * 4. If no CI → suggest adding CI
 */
export function computeNextSteps(input: NextStepsInput): NextStepsResult {
  const steps: NextStep[] = [];
  let stepNum = 1;

  if (input.ciOnly) {
    // CI-only mode: minimal guidance
    if (input.ciPath) {
      steps.push({
        step: stepNum++,
        message: `Review the generated workflow: ${input.ciPath}`,
      });
    }
    steps.push({
      step: stepNum++,
      message: 'Commit and push to enable CI',
    });
    return { steps };
  }

  // State-adaptive guidance for full init

  // High-priority: candidates detected → adopt flow
  if (input.candidateCount > 0) {
    steps.push({
      step: stepNum++,
      message: `${input.candidateCount} untracked lint disable(s) detected. Adopt them into shiori tracking:`,
      command: 'shiori adopt',
    });
  }

  // Registry entries need review
  if (input.registryEntryCount > 0) {
    steps.push({
      step: stepNum++,
      message: 'Review and fill in registry entries (reason, owner, expires):',
      command: 'cat .config/shiori/registry.json',
    });
  }

  // Always: verify
  steps.push({
    step: stepNum++,
    message: 'Verify annotations match the registry:',
    command: 'shiori check',
  });

  // Annotations exist but some may be missing from registry
  if (input.annotationCount > 0 && input.registryEntryCount === 0) {
    steps.push({
      step: stepNum++,
      message: 'Add missing refs to the registry:',
      command: 'shiori update',
    });
  }

  // CI guidance
  if (input.hasCi && input.ciPath) {
    steps.push({
      step: stepNum++,
      message: `Review the generated workflow: ${input.ciPath}`,
    });
    steps.push({
      step: stepNum++,
      message: 'Commit and push to enable CI',
    });
  } else {
    steps.push({
      step: stepNum++,
      message: 'Add governance check to CI:',
      command: 'shiori init --ci basic',
    });
  }

  // Starter hint: suggest exploring docs if they used starter
  if (input.hasStarter && input.candidateCount === 0) {
    steps.push({
      step: stepNum++,
      message: 'Explore full documentation:',
      command: 'shiori docs',
    });
  }

  return { steps };
}

/**
 * Format NextStepsResult into human-readable lines for stderr output.
 */
export function formatNextSteps(result: NextStepsResult): string[] {
  const lines: string[] = [];
  lines.push('Next steps:');
  for (const step of result.steps) {
    lines.push(`  ${step.step}. ${step.message}`);
    if (step.command) {
      lines.push(`     ${step.command}`);
    }
  }
  return lines;
}
