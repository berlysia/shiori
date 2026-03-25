import {
  assertNever,
  SUMMARY_FORMATS,
  type HealthResult,
  type DeltaResult,
  type TrendResult,
  type SummaryFormat,
  type ScanResult,
  type ReportResult,
} from '../core/types.ts';
import { wrapOutputJson } from '../core/schema-envelope.ts';
import { healthEmoji, trendArrow } from '../core/emoji.ts';
import { buildSparkline } from '../core/sparkline.ts';
import { renderBox, type BoxSection } from '../core/box-drawing.ts';
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
 * Format SummaryResult as a compact TTY pulse dashboard (EP-0158).
 * Uses box-drawing for a single-viewport governance overview.
 */
export function formatSummaryAsPulse(result: SummaryResult): string {
  const sections: BoxSection[] = [];

  // ── Header ──────────────────────────────────────────────
  const pulseEmoji = healthEmoji(result.health.health.level);
  sections.push([
    `${pulseEmoji} Health: ${result.health.health.score}/100 (${result.health.health.level})`,
  ]);

  // ── Info section ────────────────────────────────────────
  const infoLines: string[] = [];

  infoLines.push(
    `Issues: ${result.health.issues.total} (${result.health.issues.errors} errors, ${result.health.issues.warnings} warnings)`,
  );

  if (
    result.health.expiring.expired > 0 ||
    result.health.expiring.expiringSoon > 0
  ) {
    infoLines.push(
      `Expired: ${result.health.expiring.expired}, Expiring soon: ${result.health.expiring.expiringSoon}`,
    );
  }

  if (result.delta) {
    const { added, removed, net } = result.delta.summary;
    const netSign = net >= 0 ? '+' : '';
    infoLines.push(`Delta: +${added}/-${removed} (net ${netSign}${net})`);
  }

  if (result.trend && result.trend.points.length > 0) {
    const { summary: trendSummary } = result.trend;
    const scores = result.trend.points.map((p) => p.score);
    const spark = buildSparkline(scores);
    const pulseArrow = trendArrow(trendSummary.direction);
    const sign = trendSummary.scoreChange >= 0 ? '+' : '';
    infoLines.push(
      `Trend: ${spark} ${pulseArrow} ${trendSummary.direction} (${sign}${trendSummary.scoreChange}, ${trendSummary.count} pts)`,
    );
  }

  sections.push(infoLines);

  // ── Triage section ──────────────────────────────────────
  if (result.triage && result.triage.items.length > 0) {
    const { byPriority, total } = result.triage.summary;
    sections.push([
      `Triage: ${total} items \u2014 \u{1F534} ${byPriority.critical} \u{1F7E1} ${byPriority.high} \u{1F535} ${byPriority.medium} \u26AA ${byPriority.low}`,
    ]);
  }

  // ── Prescriptions section ───────────────────────────────
  if (result.health.prescriptions && result.health.prescriptions.length > 0) {
    const rxLines: string[] = [];
    rxLines.push('\u{1F48A} Prescriptions:');
    for (const rx of result.health.prescriptions.slice(0, 3)) {
      const urgencyMark =
        rx.urgency === 'critical'
          ? '\u{1F534}'
          : rx.urgency === 'recommended'
            ? '\u{1F7E1}'
            : '\u26AA';
      rxLines.push(` ${urgencyMark} +${rx.scoreImpact}pt: ${rx.command}`);
    }
    sections.push(rxLines);
  }

  // ── CTA footer ──────────────────────────────────────────
  if (result.health.issues.total > 0) {
    sections.push(['\u{1F4A1} Run: shiori triage']);
  }

  return renderBox(sections);
}

// ── Slack Block Kit types (EP-0161) ──────────────────────────

/**
 * Slack Block Kit block type subset used by the formatter.
 * Only the types shiori actually emits are defined here.
 */
interface SlackTextObject {
  type: 'plain_text' | 'mrkdwn';
  text: string;
  emoji?: boolean;
}

interface SlackHeaderBlock {
  type: 'header';
  text: SlackTextObject;
}

interface SlackSectionBlock {
  type: 'section';
  text?: SlackTextObject;
  fields?: SlackTextObject[];
}

interface SlackDividerBlock {
  type: 'divider';
}

interface SlackContextBlock {
  type: 'context';
  elements: SlackTextObject[];
}

type SlackBlock =
  | SlackHeaderBlock
  | SlackSectionBlock
  | SlackDividerBlock
  | SlackContextBlock;

/**
 * Format SummaryResult as Slack Block Kit JSON (EP-0161).
 *
 * Produces a Slack-compatible `{ blocks: [...] }` payload that can be
 * POSTed directly to a Slack incoming webhook URL.
 *
 * Sections:
 *  1. Header with health score and emoji
 *  2. Health + issues overview
 *  3. Top-3 triage items (when available)
 *  4. Trend sparkline summary (when available)
 *  5. CTA footer
 */
export function formatSummaryAsSlack(result: SummaryResult): string {
  const blocks: SlackBlock[] = [];

  // ── Header ──────────────────────────────────────────────
  const emoji =
    result.health.health.level === 'healthy'
      ? ':large_green_circle:'
      : result.health.health.level === 'warning'
        ? ':large_yellow_circle:'
        : ':red_circle:';

  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: `${emoji} Shiori Governance: ${result.health.health.score}/100 (${result.health.health.level})`,
      emoji: true,
    },
  });

  // ── Health + Issues overview ────────────────────────────
  const fields: SlackTextObject[] = [
    {
      type: 'mrkdwn',
      text: `*Health Score*\n${result.health.health.score}/100`,
    },
    {
      type: 'mrkdwn',
      text: `*Issues*\n${result.health.issues.total} (${result.health.issues.errors} errors, ${result.health.issues.warnings} warnings)`,
    },
  ];

  if (
    result.health.expiring.expired > 0 ||
    result.health.expiring.expiringSoon > 0
  ) {
    fields.push({
      type: 'mrkdwn',
      text: `*Expired*\n${result.health.expiring.expired}`,
    });
    fields.push({
      type: 'mrkdwn',
      text: `*Expiring Soon*\n${result.health.expiring.expiringSoon}`,
    });
  }

  if (result.delta) {
    const { added, removed, net } = result.delta.summary;
    const netSign = net >= 0 ? '+' : '';
    fields.push({
      type: 'mrkdwn',
      text: `*Delta*\n+${added} / -${removed} (net ${netSign}${net})`,
    });
  }

  blocks.push({ type: 'section', fields });

  // ── Trend section ──────────────────────────────────────
  if (result.trend && result.trend.points.length > 0) {
    const { summary: ts } = result.trend;
    const sign = ts.scoreChange >= 0 ? '+' : '';
    const arrow =
      ts.direction === 'improving'
        ? ':chart_with_upwards_trend:'
        : ts.direction === 'declining'
          ? ':chart_with_downwards_trend:'
          : ':left_right_arrow:';

    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${arrow} *Trend:* ${ts.direction} (${sign}${ts.scoreChange}) — ${ts.latestScore}/100 over ${ts.count} data points`,
      },
    });
  }

  // ── Top-3 triage items ─────────────────────────────────
  if (result.triage && result.triage.items.length > 0) {
    blocks.push({ type: 'divider' });

    const { byPriority, total } = result.triage.summary;
    const prioritySummary = [
      byPriority.critical > 0 ? `:red_circle: ${byPriority.critical}` : null,
      byPriority.high > 0 ? `:large_yellow_circle: ${byPriority.high}` : null,
      byPriority.medium > 0 ? `:large_blue_circle: ${byPriority.medium}` : null,
      byPriority.low > 0 ? `:white_circle: ${byPriority.low}` : null,
    ]
      .filter(Boolean)
      .join('  ');

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Triage:* ${total} items — ${prioritySummary}`,
      },
    });

    const top3 = result.triage.items.slice(0, 3);
    const triageLines = top3
      .map((item) => `• \`${item.ref}\` [${item.priority}] → ${item.action}`)
      .join('\n');

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: triageLines,
      },
    });

    if (result.triage.items.length > 3) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `_...and ${result.triage.items.length - 3} more. Run \`shiori triage\` for the full list._`,
          },
        ],
      });
    }
  }

  // ── CTA footer ─────────────────────────────────────────
  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `_Generated by shiori at ${result.timestamp}_`,
      },
    ],
  });

  return JSON.stringify({ blocks }, null, 2);
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
    case 'json': {
      // Exclude internal _reportResult from JSON serialization
      const { _reportResult: _, ...serializable } = result;
      return wrapOutputJson(serializable, {
        command: 'summary',
        schemaVersion: 1,
      });
    }
    case 'pulse':
      return formatSummaryAsPulse(result);
    case 'slack':
      return formatSummaryAsSlack(result);
    default:
      return assertNever(format);
  }
}
