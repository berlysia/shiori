import {
  HEALTH_FORMATS,
  MATURITY_STAGE_LABELS,
  type HealthResult,
  type HealthFormat,
  type ReportResult,
  type TrendResult,
  type HealthQuadrant,
  type HealthNextSteps,
  type HealthMaturityStage,
  formatAxisSuffix,
} from '../core/types.ts';
import { healthEmoji, trendArrow } from '../core/emoji.ts';
import { buildSparkline } from '../core/sparkline.ts';
import { renderBox } from '../core/box-drawing.ts';
import { report, type ReportOptions } from './report.ts';
import { buildPrescriptions } from '../core/prescriptions.ts';

export { HEALTH_FORMATS, MATURITY_STAGE_LABELS };
export type { HealthResult, HealthFormat };

/**
 * Options for the health command.
 * Extends ReportOptions and adds optional trend data.
 */
export interface HealthOptions extends ReportOptions {
  /** Pre-computed trend result (when --history is supplied by CLI) */
  trendResult?: TrendResult;
}

/**
 * Compute a governance health summary.
 * Pure function — composes report() and merges optional trend data.
 *
 * Relationship to report: health is a focused summary view,
 * similar to how check composes verify.
 */
export function health(options: HealthOptions): HealthResult {
  const { trendResult, ...reportOpts } = options;

  const reportResult = report(reportOpts);

  return buildHealthResult(reportResult, trendResult);
}

/**
 * Build HealthResult from a ReportResult and optional TrendResult.
 * Exported for CLI use when report is already computed externally.
 */
export function buildHealthResult(
  reportResult: ReportResult,
  trendResult?: TrendResult,
): HealthResult {
  const insights = [...reportResult.insights];

  // Append triage suggestion when actionable issues exist
  if (reportResult.totals.issues > 0) {
    insights.push({
      level: 'info',
      label: 'triage',
      message: `Run "shiori triage" to see a prioritized action list, or "shiori health --triage" to combine both.`,
    });
  }

  const result: HealthResult = {
    timestamp: reportResult.timestamp,
    health: { ...reportResult.health },
    issues: {
      total: reportResult.totals.issues,
      errors: reportResult.totals.errors,
      warnings: reportResult.totals.warnings,
    },
    expiring: {
      expired: reportResult.byType['expired'],
      expiringSoon: reportResult.byType['expiring-soon'],
    },
    insights,
  };

  if (trendResult && trendResult.points.length > 0) {
    result.trend = trendResult.summary;
  }

  // Generate prescriptions when score is below 100
  const prescriptions = buildPrescriptions(reportResult);
  if (prescriptions.length > 0) {
    result.prescriptions = prescriptions;
  }

  // Dual-axis pattern diagnosis (EP-0198)
  result.diagnosis = interpretDualAxis(
    reportResult.health.coverage,
    reportResult.health.hygiene,
  );

  // Quadrant-based next steps (EP-0201)
  result.nextSteps = generateNextSteps(
    reportResult.health.coverage,
    reportResult.health.hygiene,
  );

  // Governance maturity stage classification (EP-0203)
  result.maturityStage = classifyMaturityStage(result);

  return result;
}

/**
 * Format HealthResult as a human-readable summary for stderr.
 * Uses a box-style layout with dynamic width for CI visibility.
 */
export function formatHealthSummary(result: HealthResult): string {
  const emoji = healthEmoji(result.health.level);

  // Build content lines (without box decorations) as sections
  const sections: string[][] = [];

  // Header section: dual-axis display (ADR 024 Phase 2) + maturity stage (EP-0203)
  const headerLines = [
    `${emoji} Health: ${result.health.score}/100 (${result.health.level})`,
    `  Coverage: ${result.health.coverage}/100  Hygiene: ${result.health.hygiene}/100`,
  ];
  if (result.maturityStage) {
    headerLines.push(`  Stage: ${result.maturityStage}`);
  }
  sections.push(headerLines);

  // Info section
  const infoLines: string[] = [];
  infoLines.push(
    `Issues: ${result.issues.total} (${result.issues.errors} errors, ${result.issues.warnings} warnings)`,
  );

  if (result.expiring.expired > 0 || result.expiring.expiringSoon > 0) {
    infoLines.push(
      `Expired: ${result.expiring.expired}, Expiring soon: ${result.expiring.expiringSoon}`,
    );
  }

  if (result.trend) {
    const arrow = trendArrow(result.trend.direction);
    const sign = result.trend.scoreChange >= 0 ? '+' : '';
    const spark = buildSparkline([
      result.trend.minScore,
      result.trend.latestScore,
    ]);
    infoLines.push(
      `Trend: ${spark} ${arrow} ${result.trend.direction} (${sign}${result.trend.scoreChange}, ${result.trend.count} pts)`,
    );
  }
  sections.push(infoLines);

  // Dual-axis diagnosis (EP-0198)
  if (result.diagnosis) {
    sections.push([`📊 ${result.diagnosis}`]);
  }

  // Prescriptions section (when present)
  if (result.prescriptions && result.prescriptions.length > 0) {
    const rxLines: string[] = [];
    rxLines.push('💊 Prescriptions:');
    for (const rx of result.prescriptions.slice(0, 3)) {
      const urgencyMark =
        rx.urgency === 'critical'
          ? '🔴'
          : rx.urgency === 'recommended'
            ? '🟡'
            : '⚪';
      rxLines.push(
        ` ${urgencyMark} +${rx.scoreImpact}${formatAxisSuffix(rx.axis)}: ${rx.command}`,
      );
    }
    sections.push(rxLines);
  }

  // Next Steps section (EP-0201)
  if (result.nextSteps && result.nextSteps.steps.length > 0) {
    const nsLines: string[] = [];
    nsLines.push(`🎯 Next Steps (${result.nextSteps.label}):`);
    for (const step of result.nextSteps.steps) {
      nsLines.push(`  → ${step.command}`);
      nsLines.push(`    ${step.message}`);
    }
    sections.push(nsLines);
  }

  // Triage suggestion (when issues exist)
  if (result.issues.total > 0) {
    sections.push(['💡 Run: shiori health --triage']);
  }

  return renderBox(sections);
}

// ── Dual-axis pattern interpretation (EP-0198) ──────────────

/** Threshold for "high" axis value */
const AXIS_HIGH_THRESHOLD = 70;

/**
 * Interpret the Coverage/Hygiene ratio and return a diagnostic message.
 * Four patterns based on whether each axis is above/below the threshold.
 */
export function interpretDualAxis(coverage: number, hygiene: number): string {
  const covHigh = coverage >= AXIS_HIGH_THRESHOLD;
  const hygHigh = hygiene >= AXIS_HIGH_THRESHOLD;

  if (covHigh && hygHigh) {
    return 'Governance is well-tracked and maintained.';
  }
  if (covHigh && !hygHigh) {
    return 'Most annotations are tracked, but some lack expires or reason. Run "shiori triage" to address hygiene gaps.';
  }
  if (!covHigh && hygHigh) {
    return 'Not all lint disables are tracked yet, but maintained ones are in good shape. Run "shiori adopt" to improve coverage.';
  }
  // Both low
  return 'Governance coverage and maintenance both need improvement. Start with "shiori adopt" then "shiori triage".';
}

// ── Quadrant-based next steps (EP-0201) ──────────────────────

/**
 * Classify Coverage/Hygiene scores into a quadrant identifier.
 */
export function classifyQuadrant(
  coverage: number,
  hygiene: number,
): HealthQuadrant {
  const covHigh = coverage >= AXIS_HIGH_THRESHOLD;
  const hygHigh = hygiene >= AXIS_HIGH_THRESHOLD;

  if (covHigh && hygHigh) return 'high-coverage-high-hygiene';
  if (covHigh && !hygHigh) return 'high-coverage-low-hygiene';
  if (!covHigh && hygHigh) return 'low-coverage-high-hygiene';
  return 'low-coverage-low-hygiene';
}

/** Human-readable labels for each quadrant */
const QUADRANT_LABELS: Record<HealthQuadrant, string> = {
  'high-coverage-high-hygiene': 'Well-governed',
  'high-coverage-low-hygiene': 'Tracked but needs maintenance',
  'low-coverage-high-hygiene': 'Clean but needs tracking',
  'low-coverage-low-hygiene': 'Needs foundation work',
};

/**
 * Generate structured next-step recommendations based on the Coverage/Hygiene quadrant.
 * Each quadrant produces a distinct set of ordered CLI commands.
 *
 * Pure function — no I/O.
 */
export function generateNextSteps(
  coverage: number,
  hygiene: number,
): HealthNextSteps {
  const quadrant = classifyQuadrant(coverage, hygiene);

  return {
    quadrant,
    label: QUADRANT_LABELS[quadrant],
    steps: QUADRANT_STEPS[quadrant],
  };
}

/** Ordered next-step recommendations for each quadrant */
const QUADRANT_STEPS: Record<HealthQuadrant, HealthNextSteps['steps']> = {
  'high-coverage-high-hygiene': [
    {
      message: 'Enforce governance in CI to prevent regressions.',
      command: 'shiori check --fail-on expired,missing-in-registry',
    },
    {
      message: 'Monitor score trends over time.',
      command: 'shiori health --trend',
    },
  ],
  'high-coverage-low-hygiene': [
    {
      message: 'Review and resolve expired or unmaintained annotations.',
      command: 'shiori triage --expired-only',
    },
    {
      message: 'Run diagnostics to fix missing metadata.',
      command: 'shiori doctor',
    },
    {
      message: 'Re-check health after cleanup.',
      command: 'shiori health',
    },
  ],
  'low-coverage-high-hygiene': [
    {
      message: 'Track unmanaged lint disable comments.',
      command: 'shiori adopt',
    },
    {
      message: 'Register newly adopted annotations.',
      command: 'shiori update',
    },
    {
      message: 'Verify coverage improvement.',
      command: 'shiori health',
    },
  ],
  'low-coverage-low-hygiene': [
    {
      message: 'Start by tracking unmanaged lint disable comments.',
      command: 'shiori adopt',
    },
    {
      message: 'Register adopted annotations in the registry.',
      command: 'shiori update',
    },
    {
      message: 'Review and prioritize hygiene issues.',
      command: 'shiori triage',
    },
    {
      message: 'Verify overall improvement.',
      command: 'shiori health',
    },
  ],
};

// ── Maturity stage classification (EP-0203) ──────────────────

/**
 * Classify the governance maturity stage from a HealthResult.
 *
 * Uses the dual-axis quadrant and prescription count to determine
 * which of the four stages best describes the project's current state:
 *
 * - Foundation: Both axes below threshold (low-coverage-low-hygiene)
 * - Tracking: One axis is strong but the other needs work (mixed quadrants)
 * - Maintained: Both axes high but active prescriptions remain
 * - Autonomous: Both axes high with zero prescriptions
 *
 * Pure function — no I/O, depends only on already-computed HealthResult fields.
 */
export function classifyMaturityStage(
  result: HealthResult,
): HealthMaturityStage {
  const quadrant =
    result.nextSteps?.quadrant ??
    classifyQuadrant(result.health.coverage, result.health.hygiene);
  const prescriptionCount = result.prescriptions?.length ?? 0;

  // Both axes below threshold → Foundation
  if (quadrant === 'low-coverage-low-hygiene') {
    return 'Foundation';
  }

  // One axis high, other low → Tracking
  if (
    quadrant === 'high-coverage-low-hygiene' ||
    quadrant === 'low-coverage-high-hygiene'
  ) {
    return 'Tracking';
  }

  // Both axes high — distinguish by prescription count
  // Active prescriptions mean there's still room to improve
  if (prescriptionCount > 0) {
    return 'Maintained';
  }

  return 'Autonomous';
}
