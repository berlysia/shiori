import {
  HEALTH_FORMATS,
  type HealthResult,
  type HealthFormat,
  type ReportResult,
  type TrendResult,
} from '../core/types.ts';
import { healthEmoji, trendArrow } from '../core/emoji.ts';
import { buildSparkline } from '../core/sparkline.ts';
import { report, type ReportOptions } from './report.ts';
import { buildPrescriptions } from '../core/prescriptions.ts';

export { HEALTH_FORMATS };
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
 * Estimate the display width of a string, accounting for emoji characters.
 * Emoji (surrogate pairs / characters outside BMP) are treated as width 2.
 * ASCII and other BMP characters are treated as width 1.
 */
function displayWidth(str: string): number {
  let width = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0) ?? 0;
    // Emoji and other wide characters: surrogate-pair range, Variation Selectors,
    // Emoji Modifier, Regional Indicators, Miscellaneous Symbols, Dingbats, etc.
    if (
      cp > 0xffff ||
      (cp >= 0x2600 && cp <= 0x27bf) ||
      (cp >= 0x1f000 && cp <= 0x1faff)
    ) {
      width += 2;
    } else if (cp === 0xfe0f) {
      // Variation Selector-16 (emoji presentation) — already counted in base char
      // Skip adding width for this zero-width modifier
    } else {
      width += 1;
    }
  }
  return width;
}

/**
 * Pad a string to target display width with spaces on the right.
 * Unlike String.padEnd, this accounts for emoji display widths.
 */
function padEndDisplay(str: string, targetWidth: number): string {
  const currentWidth = displayWidth(str);
  if (currentWidth >= targetWidth) return str;
  return str + ' '.repeat(targetWidth - currentWidth);
}

/**
 * Format HealthResult as a human-readable summary for stderr.
 * Uses a box-style layout with dynamic width for CI visibility.
 */
export function formatHealthSummary(result: HealthResult): string {
  const emoji = healthEmoji(result.health.level);

  // Build content lines (without box decorations) as sections
  // Each section is an array of content strings; sections are separated by ├─┤
  type Section = string[];
  const sections: Section[] = [];

  // Header section
  sections.push([
    `${emoji} Health: ${result.health.score}/100 (${result.health.level})`,
  ]);

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
      rxLines.push(` ${urgencyMark} +${rx.scoreImpact}pt: ${rx.command}`);
    }
    sections.push(rxLines);
  }

  // Triage suggestion (when issues exist)
  if (result.issues.total > 0) {
    sections.push(['💡 Run: shiori health --triage']);
  }

  // Calculate box inner width from all content lines
  // Add 1 for left padding space inside box
  const allContentLines = sections.flat();
  const maxContentWidth = Math.max(
    ...allContentLines.map((line) => displayWidth(line)),
  );
  // Inner width = 1 (left pad) + content + 1 (right pad)
  const innerWidth = maxContentWidth + 2;

  // Build output
  const outputLines: string[] = [];
  const hBar = '─'.repeat(innerWidth);

  outputLines.push(`┌${hBar}┐`);

  for (let si = 0; si < sections.length; si++) {
    if (si > 0) {
      outputLines.push(`├${hBar}┤`);
    }
    for (const content of sections[si]!) {
      outputLines.push(`│${padEndDisplay(` ${content}`, innerWidth)}│`);
    }
  }

  outputLines.push(`└${hBar}┘`);

  return outputLines.join('\n');
}
