/**
 * Onboard command logic (EP-0179, EP-0187, EP-0182, EP-0186).
 *
 * Transforms recommendedActions into displayable onboard steps.
 * Supports both self-contained mode (scan → report → actions)
 * and legacy --from-pitch mode.
 *
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

/** CTA maturity tier based on health score */
export type OnboardMaturityTier = 'critical' | 'growing' | 'healthy';

/** Call-to-action after onboard completion (EP-0186) */
export interface OnboardCTA {
  /** Maturity tier */
  tier: OnboardMaturityTier;
  /** Human-readable label */
  label: string;
  /** Suggested command to run next */
  command: string;
  /** Explanation of why this is recommended */
  reason: string;
}

/** Before/after onboard session result (EP-0182) */
export interface OnboardSummary {
  /** Team/project name */
  teamName: string;
  /** Health score before onboard */
  beforeScore: number;
  /** Health score after onboard (same as beforeScore if no interactive changes) */
  afterScore: number;
  /** Score difference */
  scoreDelta: number;
  /** Steps generated */
  steps: OnboardStep[];
  /** CTA for next steps */
  cta: OnboardCTA;
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

/**
 * Build onboard steps directly from recommended actions array.
 * Used in self-contained mode (EP-0187) where pitch is bypassed.
 */
export function buildOnboardStepsFromActions(
  actions: RecommendedAction[],
): OnboardStep[] {
  if (actions.length === 0) return [];

  const sorted = [...actions].sort((a, b) => a.priority - b.priority);

  return sorted.map((action, index) => ({
    stepNumber: index + 1,
    action: action.action,
    command: action.command,
    reason: action.reason,
  }));
}

/**
 * Determine CTA based on health score (EP-0186).
 *
 * Score-based tier:
 * - < 40: critical — CI check を導入して品質ゲートを確立
 * - 40-70: growing — snapshot cron で定期観測を開始
 * - > 70: healthy — watch dashboard で継続モニタリング
 */
export function buildOnboardCTA(score: number): OnboardCTA {
  if (score < 40) {
    return {
      tier: 'critical',
      label: 'Establish CI quality gate',
      command: 'shiori check --fail-on expired,missing-in-registry',
      reason:
        'Score is below 40. Adding CI enforcement prevents further degradation.',
    };
  }
  if (score <= 70) {
    return {
      tier: 'growing',
      label: 'Start periodic health snapshots',
      command: 'shiori health --snapshot',
      reason:
        'Score is improving. Regular snapshots track progress and enable trend analysis.',
    };
  }
  return {
    tier: 'healthy',
    label: 'Enable continuous monitoring',
    command: 'shiori health --trend',
    reason:
      'Score is healthy. Trend monitoring helps maintain governance quality.',
  };
}

/**
 * Build a complete onboard summary (EP-0182).
 */
export function buildOnboardSummary(options: {
  teamName: string;
  beforeScore: number;
  afterScore: number;
  steps: OnboardStep[];
}): OnboardSummary {
  const { teamName, beforeScore, afterScore, steps } = options;
  return {
    teamName,
    beforeScore,
    afterScore,
    scoreDelta: afterScore - beforeScore,
    steps,
    cta: buildOnboardCTA(afterScore),
  };
}

// ── Formatters ──────────────────────────────────────────────

/**
 * Format onboard steps as human-readable text.
 */
export function formatOnboardAsText(
  steps: OnboardStep[],
  teamName?: string,
): string {
  if (steps.length === 0) {
    return 'No recommended actions found. Your project governance looks clean!';
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

/**
 * Format onboard summary as Markdown (EP-0182).
 * Designed for Slack/GitHub Issue copy-paste.
 */
export function formatOnboardSummaryAsMarkdown(
  summary: OnboardSummary,
): string {
  const lines: string[] = [];

  lines.push(`## Onboard Summary: ${summary.teamName}`);
  lines.push('');

  // Before/After score
  const sign = summary.scoreDelta >= 0 ? '+' : '';
  lines.push(
    `**Score:** ${summary.beforeScore} → ${summary.afterScore} (${sign}${summary.scoreDelta})`,
  );
  lines.push('');

  // Steps
  if (summary.steps.length > 0) {
    lines.push('### Recommended Steps');
    lines.push('');
    for (const step of summary.steps) {
      lines.push(`${step.stepNumber}. **${step.reason}**`);
      lines.push(`   \`\`\`sh`);
      lines.push(`   ${step.command}`);
      lines.push(`   \`\`\``);
    }
    lines.push('');
  }

  // CTA
  lines.push('### Next Step');
  lines.push('');
  lines.push(`> ${summary.cta.label}`);
  lines.push(`> \`${summary.cta.command}\``);
  lines.push(`>`);
  lines.push(`> ${summary.cta.reason}`);

  return lines.join('\n');
}

/**
 * Format onboard summary as plain text for stderr display.
 */
export function formatOnboardSummaryAsText(summary: OnboardSummary): string {
  const lines: string[] = [];

  const sign = summary.scoreDelta >= 0 ? '+' : '';
  lines.push(
    `Score: ${summary.beforeScore} → ${summary.afterScore} (${sign}${summary.scoreDelta})`,
  );
  lines.push(`Steps: ${summary.steps.length} recommended action(s)`);
  lines.push('');
  lines.push(`Next: ${summary.cta.label}`);
  lines.push(`  $ ${summary.cta.command}`);

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
