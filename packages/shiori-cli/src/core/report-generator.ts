/**
 * Weekly/health/custom report generation pipeline.
 *
 * Three-layer architecture:
 *   1. collectReportData()  — gather journal, registry, and governance data
 *   2. analyzeReportData()  — compute activity summary, health, and velocity metrics
 *   3. formatWeeklyReport() — render as Markdown, HTML, or JSON
 *
 * Pure functions (except collectReportData which performs I/O for data loading).
 *
 * @see EP-0084 for design rationale
 */

import type {
  CollectedReportData,
  AnalyzedReportMetrics,
  ActivitySummary,
  WeeklyReportPreset,
  WeeklyReportFormat,
  CliJournalEntry,
  Registry,
  ReportResult,
  JournalVelocityResult,
  ReportInsight,
} from './types.ts';
import { healthEmoji, insightIcon } from './emoji.ts';

// ── Layer 1: Data Collector ─────────────────────────────────

/**
 * Resolve the time range for a report preset.
 *
 * - weekly: past 7 days
 * - health: current point-in-time (no time filtering)
 * - custom: uses explicit since/until (defaults to past 30 days)
 */
export function resolvePresetPeriod(
  preset: WeeklyReportPreset,
  since?: string,
  until?: string,
): { since: string; until: string } {
  const now = new Date();
  const untilDate = until ?? now.toISOString().slice(0, 10);

  switch (preset) {
    case 'weekly': {
      const sinceDate =
        since ??
        (() => {
          const d = new Date(now);
          d.setDate(d.getDate() - 7);
          return d.toISOString().slice(0, 10);
        })();
      return { since: sinceDate, until: untilDate };
    }
    case 'health': {
      // Health is point-in-time; use wide range to include all journal data
      const sinceDate = since ?? '1970-01-01';
      return { since: sinceDate, until: untilDate };
    }
    case 'custom': {
      const sinceDate =
        since ??
        (() => {
          const d = new Date(now);
          d.setDate(d.getDate() - 30);
          return d.toISOString().slice(0, 10);
        })();
      return { since: sinceDate, until: untilDate };
    }
  }
}

/**
 * Filter journal entries by time range.
 * Uses ISO string lexicographic comparison (YYYY-MM-DD).
 */
export function filterJournalByPeriod(
  entries: CliJournalEntry[],
  since: string,
  until: string,
): CliJournalEntry[] {
  return entries.filter((entry) => {
    const date = entry.timestamp.slice(0, 10);
    return date >= since && date <= until;
  });
}

/**
 * Assemble collected report data from pre-loaded sources.
 *
 * This function does NOT perform I/O — it filters and assembles data
 * that has already been loaded by the CLI layer.
 */
export function collectReportData(options: {
  journalEntries: CliJournalEntry[];
  registry: Registry;
  reportResult: ReportResult;
  velocity: JournalVelocityResult;
  preset: WeeklyReportPreset;
  since?: string;
  until?: string;
}): CollectedReportData {
  const period = resolvePresetPeriod(
    options.preset,
    options.since,
    options.until,
  );

  const filteredEntries = filterJournalByPeriod(
    options.journalEntries,
    period.since,
    period.until,
  );

  return {
    journalEntries: filteredEntries,
    registry: options.registry,
    reportResult: options.reportResult,
    velocity: options.velocity,
    period,
  };
}

// ── Layer 2: Analyzer ───────────────────────────────────────

/**
 * Compute activity summary from journal entries.
 */
export function computeActivitySummary(
  entries: CliJournalEntry[],
): ActivitySummary {
  const totalOperations = entries.length;
  const successfulOperations = entries.filter((e) => e.success).length;
  const failedOperations = totalOperations - successfulOperations;
  const successRate =
    totalOperations > 0
      ? Math.round((successfulOperations / totalOperations) * 100)
      : 0;

  let entriesAdded = 0;
  let entriesRemoved = 0;
  const refsSet = new Set<string>();
  const byEventType: Record<string, number> = {};

  for (const entry of entries) {
    entriesAdded += entry.entries_added ?? 0;
    entriesRemoved += entry.entries_removed ?? 0;
    for (const ref of entry.refs) {
      refsSet.add(ref);
    }
    byEventType[entry.event_type] = (byEventType[entry.event_type] ?? 0) + 1;
  }

  return {
    totalOperations,
    successfulOperations,
    failedOperations,
    successRate,
    netChange: entriesAdded - entriesRemoved,
    uniqueRefs: [...refsSet].sort(),
    byEventType,
  };
}

/**
 * Analyze collected report data into structured metrics.
 * Pure function — no I/O.
 */
export function analyzeReportData(
  data: CollectedReportData,
): AnalyzedReportMetrics {
  const activity = computeActivitySummary(data.journalEntries);

  return {
    timestamp: new Date().toISOString(),
    period: data.period,
    activity,
    health: { ...data.reportResult.health },
    registryOverview: {
      totalEntries: data.reportResult.totals.registryEntries,
      totalAnnotations: data.reportResult.totals.annotations,
      totalCandidates: data.reportResult.totals.candidates,
      totalIssues: data.reportResult.totals.issues,
    },
    insights: data.reportResult.insights,
    velocity: data.velocity.summary,
  };
}

// ── Layer 3: Formatter ──────────────────────────────────────

/**
 * Format analyzed metrics as Markdown.
 */
export function formatWeeklyReportAsMarkdown(
  metrics: AnalyzedReportMetrics,
  preset: WeeklyReportPreset,
): string {
  const lines: string[] = [];

  // Title
  const presetLabel =
    preset === 'weekly' ? 'Weekly' : preset === 'health' ? 'Health' : 'Custom';
  lines.push(`# Shiori ${presetLabel} Report`);
  lines.push('');
  lines.push(`**Generated:** ${metrics.timestamp}`);
  lines.push(`**Period:** ${metrics.period.since} → ${metrics.period.until}`);
  lines.push('');

  // Health
  const emoji = healthEmoji(metrics.health.level);
  lines.push(`## ${emoji} Governance Health: ${metrics.health.score}/100`);
  lines.push('');
  lines.push(metrics.health.summary);
  lines.push('');

  // Registry overview
  lines.push('## Registry Overview');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('|--------|-------|');
  lines.push(
    `| Tracked annotations | ${metrics.registryOverview.totalAnnotations} |`,
  );
  lines.push(
    `| Untracked candidates | ${metrics.registryOverview.totalCandidates} |`,
  );
  lines.push(`| Registry entries | ${metrics.registryOverview.totalEntries} |`);
  lines.push(`| Open issues | ${metrics.registryOverview.totalIssues} |`);
  lines.push('');

  // Activity summary (skip for health preset when no activity)
  if (preset !== 'health' || metrics.activity.totalOperations > 0) {
    lines.push('## Activity Summary');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Total operations | ${metrics.activity.totalOperations} |`);
    lines.push(`| Successful | ${metrics.activity.successfulOperations} |`);
    lines.push(`| Failed | ${metrics.activity.failedOperations} |`);
    lines.push(`| Success rate | ${metrics.activity.successRate}% |`);
    lines.push(
      `| Net registry change | ${metrics.activity.netChange >= 0 ? '+' : ''}${metrics.activity.netChange} |`,
    );
    lines.push(
      `| Unique refs touched | ${metrics.activity.uniqueRefs.length} |`,
    );
    lines.push('');

    // Operations by type
    const eventTypes = Object.entries(metrics.activity.byEventType).sort(
      ([, a], [, b]) => b - a,
    );
    if (eventTypes.length > 0) {
      lines.push('### Operations by Type');
      lines.push('');
      lines.push('| Event Type | Count |');
      lines.push('|------------|-------|');
      for (const [type, count] of eventTypes) {
        lines.push(`| ${type} | ${count} |`);
      }
      lines.push('');
    }
  }

  // Velocity (skip if no data)
  if (metrics.velocity.count > 0) {
    lines.push('## Velocity');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Buckets | ${metrics.velocity.count} |`);
    lines.push(
      `| Period | ${metrics.velocity.oldest} → ${metrics.velocity.newest} |`,
    );
    lines.push(`| Total operations | ${metrics.velocity.totalOperations} |`);
    lines.push(`| Success rate | ${metrics.velocity.successRate}% |`);
    lines.push(`| Direction | ${metrics.velocity.direction} |`);
    lines.push('');
  }

  // Insights
  if (metrics.insights.length > 0) {
    lines.push('## Insights');
    lines.push('');
    for (const insight of metrics.insights) {
      const icon = insightIcon(insight.level);
      lines.push(`- ${icon} **${insight.label}**: ${insight.message}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Escape HTML entities for safe embedding.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Format analyzed metrics as self-contained HTML.
 */
export function formatWeeklyReportAsHtml(
  metrics: AnalyzedReportMetrics,
  preset: WeeklyReportPreset,
): string {
  const presetLabel =
    preset === 'weekly' ? 'Weekly' : preset === 'health' ? 'Health' : 'Custom';

  const healthColor =
    metrics.health.level === 'healthy'
      ? '#22c55e'
      : metrics.health.level === 'warning'
        ? '#eab308'
        : '#ef4444';

  const insightsHtml = metrics.insights
    .map(
      (i: ReportInsight) =>
        `<li class="insight insight-${i.level}"><strong>${escapeHtml(i.label)}</strong>: ${escapeHtml(i.message)}</li>`,
    )
    .join('\n      ');

  const eventTypeRows = Object.entries(metrics.activity.byEventType)
    .sort(([, a], [, b]) => b - a)
    .map(
      ([type, count]) =>
        `<tr><td>${escapeHtml(type)}</td><td>${count}</td></tr>`,
    )
    .join('\n        ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Shiori ${presetLabel} Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; color: #1a1a2e; background: #f8f9fa; }
    h1 { font-size: 1.8rem; margin-bottom: 0.5rem; }
    h2 { font-size: 1.3rem; margin: 1.5rem 0 0.75rem; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.25rem; }
    .meta { color: #64748b; font-size: 0.9rem; margin-bottom: 1.5rem; }
    .health-badge { display: inline-block; padding: 0.5rem 1rem; border-radius: 0.5rem; color: white; font-weight: bold; font-size: 1.1rem; background: ${healthColor}; }
    table { width: 100%; border-collapse: collapse; margin: 0.5rem 0 1rem; }
    th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #e2e8f0; }
    th { background: #f1f5f9; font-weight: 600; }
    .insights { list-style: none; }
    .insights li { padding: 0.5rem 0; border-bottom: 1px solid #f1f5f9; }
    .insight-error { border-left: 3px solid #ef4444; padding-left: 0.75rem; }
    .insight-warning { border-left: 3px solid #eab308; padding-left: 0.75rem; }
    .insight-info { border-left: 3px solid #3b82f6; padding-left: 0.75rem; }
    footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 0.8rem; }
  </style>
</head>
<body>
  <h1>Shiori ${presetLabel} Report</h1>
  <div class="meta">
    <div>Generated: ${escapeHtml(metrics.timestamp)}</div>
    <div>Period: ${escapeHtml(metrics.period.since)} → ${escapeHtml(metrics.period.until)}</div>
  </div>

  <h2>Governance Health</h2>
  <div class="health-badge">${metrics.health.score}/100 (${escapeHtml(metrics.health.level)})</div>
  <p style="margin-top: 0.5rem">${escapeHtml(metrics.health.summary)}</p>

  <h2>Registry Overview</h2>
  <table>
    <tr><th>Metric</th><th>Count</th></tr>
    <tr><td>Tracked annotations</td><td>${metrics.registryOverview.totalAnnotations}</td></tr>
    <tr><td>Untracked candidates</td><td>${metrics.registryOverview.totalCandidates}</td></tr>
    <tr><td>Registry entries</td><td>${metrics.registryOverview.totalEntries}</td></tr>
    <tr><td>Open issues</td><td>${metrics.registryOverview.totalIssues}</td></tr>
  </table>

  <h2>Activity Summary</h2>
  <table>
    <tr><th>Metric</th><th>Value</th></tr>
    <tr><td>Total operations</td><td>${metrics.activity.totalOperations}</td></tr>
    <tr><td>Successful</td><td>${metrics.activity.successfulOperations}</td></tr>
    <tr><td>Failed</td><td>${metrics.activity.failedOperations}</td></tr>
    <tr><td>Success rate</td><td>${metrics.activity.successRate}%</td></tr>
    <tr><td>Net registry change</td><td>${metrics.activity.netChange >= 0 ? '+' : ''}${metrics.activity.netChange}</td></tr>
    <tr><td>Unique refs touched</td><td>${metrics.activity.uniqueRefs.length}</td></tr>
  </table>

  ${
    eventTypeRows
      ? `<h2>Operations by Type</h2>
  <table>
    <tr><th>Event Type</th><th>Count</th></tr>
    ${eventTypeRows}
  </table>`
      : ''
  }

  ${
    metrics.insights.length > 0
      ? `<h2>Insights</h2>
  <ul class="insights">
    ${insightsHtml}
  </ul>`
      : ''
  }

  <footer>
    Generated by shiori — Annotation tracking and governance tool
  </footer>
</body>
</html>`;
}

/**
 * Format analyzed metrics for output.
 */
export function formatWeeklyReport(
  metrics: AnalyzedReportMetrics,
  format: WeeklyReportFormat,
  preset: WeeklyReportPreset,
): string {
  switch (format) {
    case 'markdown':
      return formatWeeklyReportAsMarkdown(metrics, preset);
    case 'html':
      return formatWeeklyReportAsHtml(metrics, preset);
    default:
      return JSON.stringify(metrics, null, 2);
  }
}
