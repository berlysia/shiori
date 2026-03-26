/**
 * Onboard command logic (EP-0179).
 *
 * Transforms pitch recommendedActions into displayable onboard steps.
 * Pure function module -- no I/O.
 */

import type {
  PitchResult,
  RecommendedAction,
  OnboardActionType,
} from '../core/types.ts';
import { ONBOARD_FORMATS, type OnboardFormat } from '../core/types.ts';
import type { CommandOutput } from '../core/schema-envelope.ts';

export { ONBOARD_FORMATS };
export type { OnboardFormat };

// ── Types ───────────────────────────────────────────────────

/** A single onboard step derived from a recommended action */
export interface OnboardStep {
  /** 1-based step number */
  stepNumber: number;
  /** Action type (shiori subcommand) */
  action: OnboardActionType;
  /** Full command string to execute */
  command: string;
  /** Human-readable reason for this step */
  reason: string;
}

// ── Core logic ──────────────────────────────────────────────

/**
 * Build onboard steps from a PitchResult's recommendedActions.
 * Steps are sorted by priority (ascending). Returns empty array
 * when recommendedActions is undefined or empty.
 */
export function buildOnboardSteps(pitchResult: PitchResult): OnboardStep[] {
  const actions = pitchResult.recommendedActions;
  if (!actions || actions.length === 0) return [];

  const sorted = [...actions].sort((a, b) => a.priority - b.priority);

  return sorted.map((action, index) => ({
    stepNumber: index + 1,
    action: action.action,
    command: action.command,
    reason: action.reason,
  }));
}

// ── Formatter ───────────────────────────────────────────────

/**
 * Format onboard steps as human-readable text.
 */
export function formatOnboardAsText(
  steps: OnboardStep[],
  teamName?: string,
): string {
  if (steps.length === 0) {
    return 'No recommended actions found. Run "shiori pitch -f json" to generate a pitch report first.';
  }

  const lines: string[] = [];

  const header = teamName
    ? `Onboard steps for "${teamName}":`
    : 'Onboard steps:';
  lines.push(header);
  lines.push('');

  for (const step of steps) {
    lines.push(`  Step ${step.stepNumber}: ${step.reason}`);
    lines.push(`    $ ${step.command}`);
    lines.push('');
  }

  lines.push(`${steps.length} step(s) total.`);

  return lines.join('\n');
}

// ── Input Validation ────────────────────────────────────────

/**
 * Type guard for a pitch command JSON envelope.
 * Validates structure without runtime type-checking every field exhaustively.
 */
export function isPitchEnvelope(
  data: unknown,
): data is CommandOutput<PitchResult> {
  if (data === null || typeof data !== 'object') return false;

  const obj = data as Record<string, unknown>;

  // Check meta envelope
  if (obj.meta === null || typeof obj.meta !== 'object') return false;
  const meta = obj.meta as Record<string, unknown>;
  if (meta.command !== 'pitch') return false;

  // Check data payload shape (minimal PitchResult fields)
  if (obj.data === null || typeof obj.data !== 'object') return false;
  const payload = obj.data as Record<string, unknown>;

  if (typeof payload.timestamp !== 'string') return false;
  if (typeof payload.teamName !== 'string') return false;
  if (typeof payload.headline !== 'string') return false;
  if (payload.health === null || typeof payload.health !== 'object')
    return false;
  if (!Array.isArray(payload.highlights)) return false;
  if (!Array.isArray(payload.nextSteps)) return false;

  // Validate recommendedActions shape when present
  if (payload.recommendedActions !== undefined) {
    if (!Array.isArray(payload.recommendedActions)) return false;
    for (const item of payload.recommendedActions) {
      if (!isRecommendedActionShape(item)) return false;
    }
  }

  return true;
}

/** Validate a single RecommendedAction shape */
function isRecommendedActionShape(item: unknown): item is RecommendedAction {
  if (item === null || typeof item !== 'object') return false;
  const obj = item as Record<string, unknown>;
  return (
    typeof obj.action === 'string' &&
    typeof obj.command === 'string' &&
    Array.isArray(obj.args) &&
    typeof obj.reason === 'string' &&
    typeof obj.priority === 'number'
  );
}
