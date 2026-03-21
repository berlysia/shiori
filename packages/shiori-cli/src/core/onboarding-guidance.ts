/**
 * Onboarding guidance for fix/verify commands (EP-0127).
 *
 * Detects "initial setup" state (≥50% unregistered annotation rate) and
 * returns step-by-step guidance lines for stderr output.
 * Pure function module — no I/O.
 */

/** Threshold: show guidance when ≥50% of unique refs are missing from registry */
const ONBOARDING_THRESHOLD = 0.5;

/** Machine-readable formats suppress onboarding guidance */
const MACHINE_READABLE_FORMATS = new Set(['json', 'sarif', 'jsonl', 'summary']);

export interface OnboardingContext {
  /** Total unique refs found in source annotations */
  totalUniqueRefs: number;
  /** Number of refs missing from registry */
  missingInRegistryCount: number;
}

export interface OnboardingGuidanceOptions {
  context: OnboardingContext;
  /** Output format — machine-readable formats suppress guidance */
  format: string;
  /** Whether stderr is a TTY */
  isTTY: boolean;
}

/**
 * Determine whether onboarding guidance should be shown.
 *
 * Suppressed when:
 * - No annotations exist (nothing to guide)
 * - Unregistered rate < 50% (project is already tracking)
 * - Format is machine-readable (json, sarif, jsonl, summary)
 * - stderr is not a TTY (piped/redirected)
 */
export function shouldShowOnboardingGuidance(
  options: OnboardingGuidanceOptions,
): boolean {
  const { context, format, isTTY } = options;

  if (context.totalUniqueRefs === 0) return false;
  if (
    context.missingInRegistryCount / context.totalUniqueRefs <
    ONBOARDING_THRESHOLD
  )
    return false;
  if (MACHINE_READABLE_FORMATS.has(format)) return false;
  if (!isTTY) return false;

  return true;
}

/**
 * Returns guidance lines for stderr, or empty array if suppressed.
 *
 * Guidance directs users through adopt → health → triage workflow.
 */
export function formatOnboardingGuidance(
  options: OnboardingGuidanceOptions,
): string[] {
  if (!shouldShowOnboardingGuidance(options)) return [];

  return [
    '',
    '\u{1F4D6} Getting Started with shiori',
    '',
    "You have many untracked annotations. Here's a recommended workflow:",
    '',
    '  Step 1: Run "shiori adopt --wizard" to convert existing lint disables into tracked annotations',
    '  Step 2: Run "shiori health" to see your governance score and improvement areas',
    '  Step 3: Run "shiori triage" to prioritize which annotations to address first',
    '',
    'Run "shiori guide" for interactive command guidance.',
  ];
}
