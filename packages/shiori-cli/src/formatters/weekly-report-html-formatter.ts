/**
 * Weekly report formatters (HTML, Markdown, JSON orchestration).
 *
 * HTML formatter extracted from core/report-generator.ts to maintain the
 * commands → formatters → core dependency direction.
 */

import { assertNever } from '../core/types.ts';
import type {
  AnalyzedReportMetrics,
  WeeklyReportPreset,
  WeeklyReportFormat,
  ReportInsight,
} from '../core/types.ts';
import { wrapOutputJson } from '../core/schema-envelope.ts';
import { formatWeeklyReportAsMarkdown } from './weekly-report-formatter.ts';
import { escapeHtml, healthColorCss } from '../core/html-utils.ts';

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
      return wrapOutputJson(metrics, {
        command: 'weekly-report',
        schemaVersion: 1,
      });
    default:
      return assertNever(format);
  }
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
