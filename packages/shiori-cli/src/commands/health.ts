import type {
  HealthResult,
  HealthFormat,
  ReportResult,
  TrendResult,
} from '../core/types.ts';
import { healthEmoji, trendArrow } from '../core/emoji.ts';
import { report, type ReportOptions } from './report.ts';
import { buildPrescriptions } from './prescriptions.ts';

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

  return result;
}

/**
 * Format HealthResult as a human-readable summary for stderr.
 * Uses a box-style layout for CI visibility.
 */
export function formatHealthSummary(result: HealthResult): string {
  const lines: string[] = [];
  const emoji = healthEmoji(result.health.level);

  lines.push('┌─────────────────────────────────────┐');
  lines.push(
    `│ ${emoji} Health: ${result.health.score}/100 (${result.health.level})`.padEnd(
      38,
    ) + '│',
  );
  lines.push('├─────────────────────────────────────┤');

  // Issue counts
  lines.push(
    `│ Issues: ${result.issues.total} (${result.issues.errors} errors, ${result.issues.warnings} warnings)`.padEnd(
      38,
    ) + '│',
  );

  // Expiration counts
  if (result.expiring.expired > 0 || result.expiring.expiringSoon > 0) {
    lines.push(
      `│ Expired: ${result.expiring.expired}, Expiring soon: ${result.expiring.expiringSoon}`.padEnd(
        38,
      ) + '│',
    );
  }

  // Trend direction (if present)
  if (result.trend) {
    const arrow = trendArrow(result.trend.direction);
    lines.push(
      `│ Trend: ${arrow} ${result.trend.direction} (${result.trend.scoreChange >= 0 ? '+' : ''}${result.trend.scoreChange})`.padEnd(
        38,
      ) + '│',
    );
  }

  // Prescriptions (when present)
  if (result.prescriptions && result.prescriptions.length > 0) {
    lines.push('├─────────────────────────────────────┤');
    lines.push('│ 💊 Prescriptions:'.padEnd(38) + '│');
    for (const rx of result.prescriptions.slice(0, 3)) {
      const urgencyMark =
        rx.urgency === 'critical'
          ? '🔴'
          : rx.urgency === 'recommended'
            ? '🟡'
            : '⚪';
      lines.push(
        `│  ${urgencyMark} +${rx.scoreImpact}pt: ${rx.command}`.padEnd(38) +
          '│',
      );
    }
  }

  // Triage suggestion (when issues exist)
  if (result.issues.total > 0) {
    lines.push('├─────────────────────────────────────┤');
    lines.push('│ 💡 Run: shiori health --triage'.padEnd(38) + '│');
  }

  lines.push('└─────────────────────────────────────┘');

  return lines.join('\n');
}

/**
 * Format HealthResult for output.
 */
export function formatHealth(
  result: HealthResult,
  format: HealthFormat,
): string {
  switch (format) {
    case 'summary':
      return formatHealthSummary(result);
    default:
      return JSON.stringify(result, null, 2);
  }
}
