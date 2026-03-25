/**
 * Weekly report formatters (Markdown, HTML, JSON).
 *
 * Consolidates all weekly-report formatting in the formatters/ layer,
 * maintaining the commands -> formatters -> core dependency direction.
 *
 * Extracted from core/report-generator.ts (Markdown) and
 * weekly-report-html-formatter.ts (HTML + dispatcher).
 */

import { assertNever } from '../core/types.ts';
import type {
  AnalyzedReportMetrics,
  WeeklyReportPreset,
  WeeklyReportFormat,
  ReportInsight,
} from '../core/types.ts';
import { healthEmoji, insightIcon, trendEmoji } from '../core/emoji.ts';
import { escapeHtml, healthColorCss } from '../core/html-utils.ts';
import { buildSparkline } from '../core/sparkline.ts';

/**
 * Format analyzed metrics for output (orchestrator).
 * Delegates to format-specific renderers.
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
    case 'json':
      return JSON.stringify(metrics, null, 2);
    default:
      return assertNever(format);
  }
}

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

  // Trend sparkline (EP-0144: auto-displayed when 2+ snapshots exist)
  if (metrics.trend && metrics.trend.count >= 2) {
    const spark = buildSparkline([
      metrics.trend.minScore,
      metrics.trend.latestScore,
    ]);
    const dirEmoji = trendEmoji(metrics.trend.direction);
    const sign = metrics.trend.scoreChange >= 0 ? '+' : '';
    lines.push('## Score Trend');
    lines.push('');
    lines.push(
      `${spark}  ${metrics.trend.latestScore}/100 ${dirEmoji} ${metrics.trend.direction} (${sign}${metrics.trend.scoreChange}, ${metrics.trend.count} snapshots)`,
    );
    lines.push('');
  }

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
 * Format analyzed metrics as self-contained HTML.
 */
export function formatWeeklyReportAsHtml(
  metrics: AnalyzedReportMetrics,
  preset: WeeklyReportPreset,
): string {
  const presetLabel =
    preset === 'weekly' ? 'Weekly' : preset === 'health' ? 'Health' : 'Custom';

  const healthColor = healthColorCss(metrics.health.level);

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

  // Pre-compute trend HTML block (EP-0144)
  let trendHtmlBlock = '';
  if (metrics.trend && metrics.trend.count >= 2) {
    const spark = buildSparkline([
      metrics.trend.minScore,
      metrics.trend.latestScore,
    ]);
    const sign = metrics.trend.scoreChange >= 0 ? '+' : '';
    trendHtmlBlock = `<h2>Score Trend</h2>
  <p style="font-size: 1.5rem; letter-spacing: 0.1em">${escapeHtml(spark)}</p>
  <p>${metrics.trend.latestScore}/100 ${escapeHtml(metrics.trend.direction)} (${sign}${metrics.trend.scoreChange}, ${metrics.trend.count} snapshots)</p>`;
  }

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

  ${trendHtmlBlock}

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
