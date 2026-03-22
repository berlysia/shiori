import {
  SUMMARY_FORMATS,
  type HealthResult,
  type DeltaResult,
  type TrendResult,
  type SummaryFormat,
  type ScanResult,
  type ReportResult,
} from '../core/types.ts';
import { healthEmoji, trendArrow } from '../core/emoji.ts';
import { report, type ReportOptions } from './report.ts';
import { buildHealthResult } from './health.ts';
import { computeDelta } from './delta.ts';
import { computeTrend } from './trend.ts';
import { triage, type TriageResult } from './triage.ts';

export { SUMMARY_FORMATS };
export type { SummaryFormat };

// ── Types ────────────────────────────────────────────────────

/**
 * Aggregated governance summary combining health, delta, trend, and triage.
 *
 * Designed for PR comment integration and multi-repo dashboard consumption.
 * Each section is optional — consumers can request partial summaries
 * (e.g. delta-only when no history is available).
 */
export interface SummaryResult {
  /** ISO timestamp when summary was generated */
  timestamp: string;
  /** Repository identifier for multi-repo aggregation (undefined for single-repo) */
  repository?: string;
  /** Health assessment (from report → health pipeline) */
  health: HealthResult;
  /** Delta between base and head scans (undefined when no base scan is available) */
  delta?: DeltaResult;
  /** Governance score trend (undefined when no history is available) */
  trend?: TrendResult;
  /** Prioritized triage list (undefined when no issues exist) */
  triage?: TriageResult;
  /**
   * Internal: the ReportResult generated during summary computation.
   * Exposed so CLI callers (e.g. --snapshot) can reuse it without
   * a redundant report() call. Excluded from JSON serialization.
   */
  _reportResult: ReportResult;
}

/** Options for the summary command */
export interface SummaryOptions extends ReportOptions {
  /** Base scan result for delta computation (undefined = skip delta) */
  baseScanResult?: ScanResult;
  /** Pre-loaded ReportResult snapshots for trend computation (undefined = skip trend) */
  trendReports?: ReportResult[];
  /** Repository identifier for multi-repo aggregation */
  repository?: string;
  /** Skip triage computation even when issues exist */
  skipTriage?: boolean;
}

// ── Main function ────────────────────────────────────────────

/**
 * Build an aggregated governance summary.
 *
 * Pure function — composes report, health, delta, trend, and triage
 * into a single SummaryResult. Each section is computed only when
 * the required inputs are available.
 */
export function summary(options: SummaryOptions): SummaryResult {
  const {
    baseScanResult,
    trendReports,
    repository,
    skipTriage,
    ...reportOpts
  } = options;

  // 1. Generate report (foundation for health + triage)
  const reportResult = report(reportOpts);

  // 2. Build health from report
  let trendResult: TrendResult | undefined;
  if (trendReports && trendReports.length > 0) {
    trendResult = computeTrend(trendReports);
  }
  const healthResult = buildHealthResult(reportResult, trendResult);

  // 3. Compute delta (when base scan is available)
  let deltaResult: DeltaResult | undefined;
  if (baseScanResult) {
    deltaResult = computeDelta({
      base: baseScanResult,
      head: options.scanResult,
    });
  }

  // 4. Compute triage (when issues exist and not skipped)
  //    Inject reportResult.verifyResult to avoid duplicate verify() call
  let triageResult: TriageResult | undefined;
  if (!skipTriage && reportResult.totals.issues > 0) {
    triageResult = triage({
      ...reportOpts,
      verifyResult: reportResult.verifyResult,
    });
  }

  return {
    timestamp: reportResult.timestamp,
    repository,
    health: healthResult,
    delta: deltaResult,
    trend: trendResult,
    triage: triageResult,
    _reportResult: reportResult,
  };
}

// ── Formatters ───────────────────────────────────────────────

/**
 * Format SummaryResult as Markdown (suitable for PR comments).
 */
export function formatSummaryAsMarkdown(result: SummaryResult): string {
  const lines: string[] = [];

  // Header
  lines.push('## Shiori Governance Summary');
  if (result.repository) {
    lines.push(`**Repository:** ${result.repository}`);
  }
  lines.push('');

  // Health section
  const emoji = healthEmoji(result.health.health.level);
  lines.push(
    `### ${emoji} Health: ${result.health.health.score}/100 (${result.health.health.level})`,
  );
  lines.push('');
  lines.push(`> ${result.health.health.summary}`);
  lines.push('');

  // Issues
  if (result.health.issues.total > 0) {
    lines.push(
      `**Issues:** ${result.health.issues.total} (${result.health.issues.errors} errors, ${result.health.issues.warnings} warnings)`,
    );
    lines.push('');
  }

  // Expiring
  if (
    result.health.expiring.expired > 0 ||
    result.health.expiring.expiringSoon > 0
  ) {
    lines.push(
      `**Expired:** ${result.health.expiring.expired} | **Expiring soon:** ${result.health.expiring.expiringSoon}`,
    );
    lines.push('');
  }

  // Delta section
  if (result.delta) {
    lines.push('### Delta');
    lines.push('');
    lines.push(`| Added | Removed | Unchanged | Net |`);
    lines.push(`|-------|---------|-----------|-----|`);
    lines.push(
      `| +${result.delta.summary.added} | -${result.delta.summary.removed} | ${result.delta.summary.unchanged} | ${result.delta.summary.net >= 0 ? '+' : ''}${result.delta.summary.net} |`,
    );
    lines.push('');
  }

  // Trend section
  if (result.trend && result.trend.points.length > 0) {
    const arrow = trendArrow(result.trend.summary.direction);
    const sign = result.trend.summary.scoreChange >= 0 ? '+' : '';
    lines.push(
      `### ${arrow} Trend: ${result.trend.summary.direction} (${sign}${result.trend.summary.scoreChange})`,
    );
    lines.push('');
    lines.push(
      `Score: ${result.trend.summary.latestScore}/100 (${result.trend.summary.count} data points)`,
    );
    lines.push('');
  }

  // Triage section
  if (result.triage && result.triage.items.length > 0) {
    lines.push('### Triage');
    lines.push('');
    const { byPriority } = result.triage.summary;
    const parts: string[] = [];
    if (byPriority.critical > 0) parts.push(`🔴 ${byPriority.critical}`);
    if (byPriority.high > 0) parts.push(`🟡 ${byPriority.high}`);
    if (byPriority.medium > 0) parts.push(`🔵 ${byPriority.medium}`);
    if (byPriority.low > 0) parts.push(`⚪ ${byPriority.low}`);
    lines.push(`**${result.triage.summary.total} items:** ${parts.join(' ')}`);
    lines.push('');

    // Top 5 items
    const top = result.triage.items.slice(0, 5);
    if (top.length > 0) {
      lines.push('| Ref | Priority | Action |');
      lines.push('|-----|----------|--------|');
      for (const item of top) {
        lines.push(`| ${item.ref} | ${item.priority} | ${item.action} |`);
      }
      if (result.triage.items.length > 5) {
        lines.push('');
        lines.push(
          `*...and ${result.triage.items.length - 5} more. Run \`shiori triage\` for the full list.*`,
        );
      }
      lines.push('');
    }
  }

  // Insights
  if (result.health.insights.length > 0) {
    lines.push('### Insights');
    lines.push('');
    for (const insight of result.health.insights) {
      const icon =
        insight.level === 'error'
          ? '🔴'
          : insight.level === 'warning'
            ? '🟡'
            : 'ℹ️';
      lines.push(`- ${icon} **${insight.label}:** ${insight.message}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format SummaryResult based on output format.
 */
export function formatSummary(
  result: SummaryResult,
  format: SummaryFormat,
): string {
  switch (format) {
    case 'markdown':
      return formatSummaryAsMarkdown(result);
    default: {
      // Exclude internal _reportResult from JSON serialization
      const { _reportResult: _, ...serializable } = result;
      return JSON.stringify(serializable, null, 2);
    }
  }
}
