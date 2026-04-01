/**
 * Health fix bridge — plan and execute automatable prescription actions (EP-0112).
 *
 * Pure functions for fix planning and formatting.
 * The actual execution (registry update) lives in the CLI layer (health-cli.ts)
 * to keep this module I/O-free.
 */

import type {
  HealthPrescription,
  HealthResult,
  HealthMaturityStage,
  PrescriptionActionType,
} from '../core/types.ts';
import { formatAxisSuffix } from '../core/types.ts';
import { classifyMaturityStage, MATURITY_STAGE_LABELS } from './health.ts';

// ── Types ────────────────────────────────────────────────────

/** Preview of what a fix will do (dry-run output) */
export interface FixPreview {
  /** The prescription being fixed */
  target: HealthPrescription;
  /** Whether this action can be executed automatically */
  automatable: boolean;
  /** Human-readable description of what will happen */
  description: string;
  /** Non-automatable prescriptions shown as suggestions */
  manualPrescriptions: HealthPrescription[];
}

/** Result of applying a fix */
export interface HealthFixApplyResult {
  /** Whether the fix succeeded */
  success: boolean;
  /** Which action type was executed */
  action: PrescriptionActionType;
  /** Human-readable description of what happened */
  description: string;
  /** Health score before fix */
  beforeScore: number;
  /** Health score after fix */
  afterScore: number;
  /** Score change (afterScore - beforeScore) */
  scoreDelta: number;
}

// ── Plan ─────────────────────────────────────────────────────

/**
 * Action types that can be executed without human judgment.
 *
 * Related: fix.ts defines AUTOMATABLE_ISSUE_TYPES (VerifyIssueType level).
 * Both express "what can be auto-fixed" at different abstraction layers.
 * EP-0118 Phase 2 should unify these into a single automatability definition.
 */
const AUTOMATABLE_ACTIONS: ReadonlySet<PrescriptionActionType> = new Set([
  'update',
]);

/**
 * Find the first automatable prescription and build a fix preview.
 * Returns null when no automatable action exists.
 */
export function planFix(
  prescriptions: HealthPrescription[],
): FixPreview | null {
  const automatable = prescriptions.find((p) =>
    AUTOMATABLE_ACTIONS.has(p.actionType),
  );

  if (!automatable) return null;

  const manualPrescriptions = prescriptions.filter(
    (p) => !AUTOMATABLE_ACTIONS.has(p.actionType),
  );

  return {
    target: automatable,
    automatable: true,
    description: `Auto-fix: ${automatable.command} (${automatable.message})`,
    manualPrescriptions,
  };
}

// ── Format ───────────────────────────────────────────────────

/**
 * Format a fix preview for human-readable dry-run output.
 */
export function formatFixPreview(preview: FixPreview): string {
  const lines: string[] = [];
  lines.push('🔧 Fix Preview (dry-run):');
  lines.push(`  Action: ${preview.target.command}`);
  lines.push(
    `  Impact: +${preview.target.scoreImpact}${formatAxisSuffix(preview.target.axis)} estimated`,
  );
  lines.push(`  Detail: ${preview.target.message}`);
  lines.push('');
  lines.push('  Run with --fix --apply to execute.');

  if (preview.manualPrescriptions.length > 0) {
    lines.push('');
    lines.push('📋 Manual actions (not automatable):');
    for (const rx of preview.manualPrescriptions) {
      lines.push(`  - ${rx.command}: ${rx.message}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format a fix result for human-readable output after apply.
 */
export function formatFixResult(result: HealthFixApplyResult): string {
  const lines: string[] = [];

  if (result.success) {
    const sign = result.scoreDelta >= 0 ? '+' : '';
    lines.push('✅ Fix applied:');
    lines.push(`  ${result.description}`);
    lines.push(
      `  Score: ${result.beforeScore} → ${result.afterScore} (${sign}${result.scoreDelta})`,
    );
  } else {
    lines.push('❌ Fix failed:');
    lines.push(`  ${result.description}`);
  }

  return lines.join('\n');
}

// ── Cumulative Fix Preview (EP-0204) ────────────────────────

/** Axis-level before/after score pair */
export interface AxisScorePreview {
  before: number;
  after: number;
  delta: number;
}

/** Cumulative preview showing predicted effect of all prescriptions (EP-0204) */
export interface CumulativeFixPreview {
  /** Coverage axis before/after */
  coverage: AxisScorePreview;
  /** Hygiene axis before/after */
  hygiene: AxisScorePreview;
  /** Overall score before/after (min of coverage, hygiene) */
  overall: AxisScorePreview;
  /** Maturity stage before/after prediction (AC-5) */
  maturityBefore: HealthMaturityStage;
  maturityAfter: HealthMaturityStage;
  /** All prescriptions grouped by axis */
  prescriptions: HealthPrescription[];
}

/**
 * Build a cumulative fix preview from a HealthResult.
 * Aggregates scoreImpact by axis across ALL prescriptions (automatable + manual)
 * and predicts the resulting maturity stage change.
 *
 * Uses static calculation only — no actual command execution.
 * Returns null when no prescriptions exist.
 */
export function buildCumulativePreview(
  result: HealthResult,
): CumulativeFixPreview | null {
  const prescriptions = result.prescriptions ?? [];
  if (prescriptions.length === 0) return null;

  const covImpact = prescriptions
    .filter((p) => p.axis === 'coverage')
    .reduce((sum, p) => sum + p.scoreImpact, 0);
  const hygImpact = prescriptions
    .filter((p) => p.axis === 'hygiene')
    .reduce((sum, p) => sum + p.scoreImpact, 0);

  const covBefore = result.health.coverage;
  const hygBefore = result.health.hygiene;
  // Clamp to 100 — scoreImpact estimates may exceed actual ceiling
  const covAfter = Math.min(100, covBefore + covImpact);
  const hygAfter = Math.min(100, hygBefore + hygImpact);

  const overallBefore = result.health.score;
  const overallAfter = Math.min(covAfter, hygAfter);

  // Predict maturity stage after all prescriptions are addressed
  const maturityBefore = result.maturityStage ?? classifyMaturityStage(result);

  // Build a synthetic HealthResult for maturity prediction.
  // Clear nextSteps so classifyMaturityStage recalculates quadrant
  // from the predicted coverage/hygiene values.
  const syntheticResult: HealthResult = {
    ...result,
    health: {
      ...result.health,
      coverage: covAfter,
      hygiene: hygAfter,
      score: overallAfter,
    },
    // All prescriptions addressed → empty prescriptions
    prescriptions: [],
    // Force quadrant recalculation from predicted axis values
    nextSteps: undefined,
  };
  const maturityAfter = classifyMaturityStage(syntheticResult);

  return {
    coverage: {
      before: covBefore,
      after: covAfter,
      delta: covAfter - covBefore,
    },
    hygiene: {
      before: hygBefore,
      after: hygAfter,
      delta: hygAfter - hygBefore,
    },
    overall: {
      before: overallBefore,
      after: overallAfter,
      delta: overallAfter - overallBefore,
    },
    maturityBefore,
    maturityAfter,
    prescriptions,
  };
}

/**
 * Format a cumulative fix preview for human-readable output.
 * Shows before/after for each axis + maturity stage transition.
 */
export function formatCumulativeFixPreview(
  preview: CumulativeFixPreview,
): string {
  const lines: string[] = [];

  lines.push('🔮 Cumulative Fix Preview:');
  lines.push('');

  // Axis-level before/after
  const fmtAxis = (label: string, axis: AxisScorePreview): string => {
    const sign = axis.delta >= 0 ? '+' : '';
    return `  ${label}: ${axis.before} → ${axis.after} (${sign}${axis.delta})`;
  };

  lines.push(fmtAxis('Coverage', preview.coverage));
  lines.push(fmtAxis('Hygiene ', preview.hygiene));
  lines.push(fmtAxis('Overall ', preview.overall));

  // Maturity stage transition
  if (preview.maturityBefore !== preview.maturityAfter) {
    lines.push('');
    lines.push(`  Stage: ${preview.maturityBefore} → ${preview.maturityAfter}`);
    lines.push(
      `         (${MATURITY_STAGE_LABELS[preview.maturityBefore]} → ${MATURITY_STAGE_LABELS[preview.maturityAfter]})`,
    );
  } else {
    lines.push('');
    lines.push(`  Stage: ${preview.maturityBefore} (no change)`);
  }

  // Prescription breakdown
  lines.push('');
  lines.push('💊 Prescriptions:');
  for (const rx of preview.prescriptions) {
    const urgencyMark =
      rx.urgency === 'critical'
        ? '🔴'
        : rx.urgency === 'recommended'
          ? '🟡'
          : '⚪';
    const auto = AUTOMATABLE_ACTIONS.has(rx.actionType)
      ? ' [auto]'
      : ' [manual]';
    lines.push(
      `  ${urgencyMark} +${rx.scoreImpact}${formatAxisSuffix(rx.axis)}: ${rx.command}${auto}`,
    );
  }

  return lines.join('\n');
}
