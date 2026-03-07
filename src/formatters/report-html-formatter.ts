import type {
  ReportResult,
  HealthLevel,
  ReportInsight,
  BreakdownEntry,
  VerifyIssueType,
} from '../core/types.ts';

/**
 * Map health level to CSS color variable value.
 */
function healthColor(level: HealthLevel): string {
  switch (level) {
    case 'healthy':
      return '#22c55e';
    case 'warning':
      return '#eab308';
    case 'critical':
      return '#ef4444';
  }
}

/**
 * Map health level to emoji indicator.
 */
function healthIndicator(level: HealthLevel): string {
  switch (level) {
    case 'healthy':
      return '\u{1F7E2}'; // green circle
    case 'warning':
      return '\u{1F7E1}'; // yellow circle
    case 'critical':
      return '\u{1F534}'; // red circle
  }
}

/**
 * Map insight level to icon.
 */
function insightLevelIcon(level: ReportInsight['level']): string {
  switch (level) {
    case 'error':
      return '\u274C'; // cross mark
    case 'warning':
      return '\u26A0\uFE0F'; // warning
    case 'info':
      return '\u2139\uFE0F'; // info
  }
}

/**
 * Escape HTML special characters to prevent XSS.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Render the <style> block for the HTML report.
 */
function renderStyles(healthColorValue: string): string {
  return `<style>
  :root {
    --health-color: ${healthColorValue};
    --bg: #0f172a;
    --surface: #1e293b;
    --surface-alt: #334155;
    --text: #f1f5f9;
    --text-muted: #94a3b8;
    --border: #475569;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.6;
    padding: 2rem;
    max-width: 960px;
    margin: 0 auto;
  }
  h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1.125rem; margin: 1.5rem 0 0.75rem; color: var(--text-muted); }
  .meta { color: var(--text-muted); font-size: 0.85rem; margin-bottom: 1.5rem; }
  .health-card {
    background: var(--surface);
    border-left: 4px solid var(--health-color);
    border-radius: 8px;
    padding: 1.25rem;
    margin-bottom: 1.5rem;
  }
  .health-score {
    font-size: 2rem;
    font-weight: 700;
    color: var(--health-color);
  }
  .health-label { color: var(--text-muted); font-size: 0.85rem; }
  .health-summary { margin-top: 0.5rem; }
  table {
    width: 100%;
    border-collapse: collapse;
    background: var(--surface);
    border-radius: 8px;
    overflow: hidden;
    margin-bottom: 1rem;
  }
  th, td {
    padding: 0.6rem 1rem;
    text-align: left;
    border-bottom: 1px solid var(--border);
  }
  th { background: var(--surface-alt); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
  td { font-size: 0.9rem; }
  tr:last-child td { border-bottom: none; }
  .insight-list { list-style: none; }
  .insight-item {
    background: var(--surface);
    border-radius: 6px;
    padding: 0.75rem 1rem;
    margin-bottom: 0.5rem;
    font-size: 0.9rem;
  }
  .insight-label { font-weight: 600; }
  .section { margin-bottom: 1.5rem; }
  .empty { color: var(--text-muted); font-style: italic; font-size: 0.9rem; }
  footer {
    margin-top: 2rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 0.8rem;
    text-align: center;
  }
</style>`;
}

/**
 * Render the health score card section.
 */
function renderHealthSection(result: ReportResult): string {
  const indicator = healthIndicator(result.health.level);
  return `<div class="health-card">
  <div class="health-score">${indicator} ${result.health.score}/100</div>
  <div class="health-label">${escapeHtml(result.health.level)}</div>
  <div class="health-summary">${escapeHtml(result.health.summary)}</div>
</div>`;
}

/**
 * Render the overview metrics table.
 */
function renderOverviewTable(result: ReportResult): string {
  const rows = [
    ['Tracked annotations', result.totals.annotations],
    ['Untracked candidates', result.totals.candidates],
    ['Registry entries', result.totals.registryEntries],
    ['Issues (errors)', result.totals.errors],
    ['Issues (warnings)', result.totals.warnings],
  ] as const;

  const rowsHtml = rows
    .map(([label, count]) => `    <tr><td>${label}</td><td>${count}</td></tr>`)
    .join('\n');

  return `<div class="section">
  <h2>Overview</h2>
  <table>
    <thead><tr><th>Metric</th><th>Count</th></tr></thead>
    <tbody>
${rowsHtml}
    </tbody>
  </table>
</div>`;
}

/**
 * Render governance insights section.
 */
function renderInsights(insights: ReportInsight[]): string {
  if (insights.length === 0) return '';

  const items = insights
    .map((insight) => {
      const icon = insightLevelIcon(insight.level);
      return `    <li class="insight-item">${icon} <span class="insight-label">${escapeHtml(insight.label)}</span>: ${escapeHtml(insight.message)}</li>`;
    })
    .join('\n');

  return `<div class="section">
  <h2>Insights</h2>
  <ul class="insight-list">
${items}
  </ul>
</div>`;
}

/**
 * Render issue breakdown by type.
 */
function renderIssueBreakdown(byType: Record<VerifyIssueType, number>): string {
  const entries = Object.entries(byType).filter(([, count]) => count > 0);
  if (entries.length === 0) return '';

  const rows = entries
    .map(
      ([type, count]) =>
        `    <tr><td>${escapeHtml(type)}</td><td>${count}</td></tr>`,
    )
    .join('\n');

  return `<div class="section">
  <h2>Issues by Type</h2>
  <table>
    <thead><tr><th>Type</th><th>Count</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
</div>`;
}

/**
 * Render a generic breakdown table (byRule, byOwner, byKind).
 */
function renderBreakdownTable(
  title: string,
  headerKey: string,
  entries: BreakdownEntry[],
): string {
  if (entries.length === 0) return '';

  const rows = entries
    .map(
      ({ key, count }) =>
        `    <tr><td>${escapeHtml(key)}</td><td>${count}</td></tr>`,
    )
    .join('\n');

  return `<div class="section">
  <h2>${escapeHtml(title)}</h2>
  <table>
    <thead><tr><th>${escapeHtml(headerKey)}</th><th>Count</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
</div>`;
}

/**
 * Render the interactive script (collapsible sections toggle).
 */
function renderScript(): string {
  return `<script>
  document.querySelectorAll('h2').forEach(function(h2) {
    h2.style.cursor = 'pointer';
    h2.addEventListener('click', function() {
      var section = h2.parentElement;
      var content = section.querySelectorAll('table, ul');
      content.forEach(function(el) {
        el.style.display = el.style.display === 'none' ? '' : 'none';
      });
    });
  });
</script>`;
}

/** Options for HTML report rendering */
export interface HtmlReportOptions {
  /** Auto-refresh interval in seconds (0 or undefined = no auto-refresh) */
  autoRefreshSeconds?: number;
}

/**
 * Format a ReportResult as a self-contained HTML dashboard.
 * No external dependencies — all styles and scripts are inline.
 *
 * When `options.autoRefreshSeconds` is set, adds a `<meta http-equiv="refresh">`
 * tag so the browser reloads automatically (used by `watch --dashboard`).
 */
export function formatReportAsHtml(
  result: ReportResult,
  options?: HtmlReportOptions,
): string {
  const colorValue = healthColor(result.health.level);
  const autoRefresh = options?.autoRefreshSeconds;
  const refreshMeta =
    autoRefresh && autoRefresh > 0
      ? `\n  <meta http-equiv="refresh" content="${autoRefresh}">`
      : '';

  const sections = [
    renderHealthSection(result),
    renderOverviewTable(result),
    renderInsights(result.insights),
    renderIssueBreakdown(result.byType),
    renderBreakdownTable('Annotations by Rule', 'Rule', result.byRule),
    renderBreakdownTable('Ownership', 'Owner', result.byOwner),
    renderBreakdownTable('Annotation Kinds', 'Kind', result.byKind),
  ]
    .filter((s) => s !== '')
    .join('\n');

  const isLive = Boolean(autoRefresh);
  const title = isLive
    ? 'Shiori Governance Dashboard'
    : 'Shiori Governance Report';
  const liveIndicator = isLive
    ? '  <div class="meta live-indicator">\u{1F7E2} Live &mdash; auto-refreshing every ' +
      autoRefresh +
      's</div>\n'
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">${refreshMeta}
  <title>${title}</title>
${renderStyles(colorValue)}
</head>
<body>
  <h1>${title}</h1>
  <div class="meta">Generated: ${escapeHtml(result.timestamp)}</div>
${liveIndicator}${sections}
  <footer>Generated by shiori &mdash; annotation tracking &amp; governance</footer>
${renderScript()}
</body>
</html>`;
}
