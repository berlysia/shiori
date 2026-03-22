import type {
  AggregateResult,
  AggregateRepositoryEntry,
  HealthLevel,
} from '../core/types.ts';
import {
  escapeHtml,
  healthColorCss as healthColor,
  healthIndicator,
} from '../core/html-utils.ts';

/**
 * Map overall score to a health level for color coding.
 */
function scoreToLevel(score: number): HealthLevel {
  if (score >= 80) return 'healthy';
  if (score >= 50) return 'warning';
  return 'critical';
}

/**
 * Render the <style> block for the aggregate HTML dashboard.
 * Follows the same dark theme as report-html-formatter.ts.
 */
function renderStyles(overallColorValue: string): string {
  return `<style>
  :root {
    --overall-color: ${overallColorValue};
    --bg: #0f172a;
    --surface: #1e293b;
    --surface-alt: #334155;
    --text: #f1f5f9;
    --text-muted: #94a3b8;
    --border: #475569;
    --healthy: #22c55e;
    --warning: #eab308;
    --critical: #ef4444;
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
  .overall-card {
    background: var(--surface);
    border-left: 4px solid var(--overall-color);
    border-radius: 8px;
    padding: 1.25rem;
    margin-bottom: 1.5rem;
  }
  .overall-score {
    font-size: 2rem;
    font-weight: 700;
    color: var(--overall-color);
  }
  .overall-label { color: var(--text-muted); font-size: 0.85rem; }
  .overall-metrics {
    display: flex;
    gap: 1.5rem;
    margin-top: 0.75rem;
    flex-wrap: wrap;
  }
  .metric {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .metric-value { font-size: 1.25rem; font-weight: 600; }
  .metric-label { font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
  .worst-highlight {
    background: var(--surface);
    border-left: 4px solid var(--critical);
    border-radius: 8px;
    padding: 1rem 1.25rem;
    margin-bottom: 1.5rem;
    font-size: 0.9rem;
  }
  .worst-highlight .worst-label {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.25rem;
  }
  .worst-highlight .worst-name { font-weight: 600; }
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
  .score-bar-cell { display: flex; align-items: center; gap: 0.5rem; }
  .score-bar-track {
    flex: 1;
    height: 8px;
    border-radius: 4px;
    background: var(--surface-alt);
    overflow: hidden;
    min-width: 60px;
  }
  .score-bar-fill { height: 100%; border-radius: 4px; }
  .score-value { min-width: 3ch; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
  .level-badge {
    display: inline-block;
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
  }
  .level-badge.healthy { background: rgba(34,197,94,0.15); color: var(--healthy); }
  .level-badge.warning { background: rgba(234,179,8,0.15); color: var(--warning); }
  .level-badge.critical { background: rgba(239,68,68,0.15); color: var(--critical); }
  .section { margin-bottom: 1.5rem; }
  .sparkline { display: flex; align-items: flex-end; gap: 2px; height: 32px; }
  .sparkline-bar {
    flex: 1;
    min-width: 8px;
    max-width: 24px;
    border-radius: 2px 2px 0 0;
  }
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
 * Render the overall summary card showing average score and key metrics.
 */
function renderOverallCard(result: AggregateResult): string {
  const level = scoreToLevel(result.overall.averageScore);
  const indicator = healthIndicator(level);

  return `<div class="overall-card">
  <div class="overall-score">${indicator} ${result.overall.averageScore}/100</div>
  <div class="overall-label">Average governance score across ${result.overall.repositoryCount} repositories</div>
  <div class="overall-metrics">
    <div class="metric"><span class="metric-value">${result.overall.repositoryCount}</span><span class="metric-label">Repositories</span></div>
    <div class="metric"><span class="metric-value">${result.overall.totalIssues}</span><span class="metric-label">Total Issues</span></div>
    <div class="metric"><span class="metric-value">${result.overall.totalErrors}</span><span class="metric-label">Errors</span></div>
    <div class="metric"><span class="metric-value">${result.overall.totalWarnings}</span><span class="metric-label">Warnings</span></div>
  </div>
</div>`;
}

/**
 * Render the worst repository highlight card.
 */
function renderWorstHighlight(result: AggregateResult): string {
  const worst = result.repositories[0];
  if (!worst) return '';

  const indicator = healthIndicator(worst.level);
  return `<div class="worst-highlight">
  <div class="worst-label">Needs Attention</div>
  <div>${indicator} <span class="worst-name">${escapeHtml(worst.repository)}</span> &mdash; ${worst.score}/100 (${worst.level})</div>
</div>`;
}

/**
 * Render a single repository table row.
 */
function renderRepositoryRow(repo: AggregateRepositoryEntry): string {
  const color = healthColor(repo.level);
  const indicator = healthIndicator(repo.level);
  const widthPct = Math.max(repo.score, 0);

  return `    <tr>
      <td>${indicator} ${escapeHtml(repo.repository)}</td>
      <td><div class="score-bar-cell"><div class="score-bar-track"><div class="score-bar-fill" style="width:${widthPct}%;background:${color}"></div></div><span class="score-value">${repo.score}</span></div></td>
      <td><span class="level-badge ${repo.level}">${repo.level}</span></td>
      <td>${repo.issues.total}</td>
      <td>${repo.issues.errors}</td>
      <td>${repo.issues.warnings}</td>
      <td>${repo.expired}</td>
      <td>${repo.expiringSoon}</td>
    </tr>`;
}

/**
 * Render the repository comparison table.
 */
function renderRepositoryTable(result: AggregateResult): string {
  if (result.repositories.length === 0) return '';

  const rows = result.repositories.map(renderRepositoryRow).join('\n');

  return `<div class="section">
  <h2>Repositories</h2>
  <table>
    <thead>
      <tr><th>Repository</th><th>Score</th><th>Level</th><th>Issues</th><th>Errors</th><th>Warnings</th><th>Expired</th><th>Expiring</th></tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>
</div>`;
}

/**
 * Render an SVG sparkline showing score distribution across repositories.
 * Bars are ordered by score ascending (worst first), matching the table sort order.
 */
function renderScoreSparkline(result: AggregateResult): string {
  if (result.repositories.length === 0) return '';

  const bars = result.repositories
    .map((repo) => {
      const color = healthColor(repo.level);
      const heightPct = Math.max(repo.score, 2); // minimum 2% for visibility
      return `    <div class="sparkline-bar" style="height:${heightPct}%;background:${color}" title="${escapeHtml(repo.repository)}: ${repo.score}/100"></div>`;
    })
    .join('\n');

  return `<div class="section">
  <h2>Score Distribution</h2>
  <div class="sparkline">
${bars}
  </div>
</div>`;
}

/**
 * Render collapsible sections script.
 */
function renderScript(): string {
  return `<script>
  document.querySelectorAll('h2').forEach(function(h2) {
    h2.style.cursor = 'pointer';
    h2.addEventListener('click', function() {
      var section = h2.parentElement;
      var content = section.querySelectorAll('table, .sparkline');
      content.forEach(function(el) {
        el.style.display = el.style.display === 'none' ? '' : 'none';
      });
    });
  });
</script>`;
}

/**
 * Format AggregateResult as a self-contained HTML dashboard.
 * No external dependencies -- all styles and scripts are inline.
 *
 * Design follows the same dark theme as report-html-formatter.ts:
 * - Dark slate background (#0f172a)
 * - Health-colored cards and indicators
 * - Responsive layout (max-width 960px)
 * - Collapsible sections
 */
export function formatAggregateAsHtml(result: AggregateResult): string {
  const overallLevel = scoreToLevel(result.overall.averageScore);
  const colorValue = healthColor(overallLevel);

  const sections = [
    renderOverallCard(result),
    renderWorstHighlight(result),
    renderScoreSparkline(result),
    renderRepositoryTable(result),
  ]
    .filter((s) => s !== '')
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Shiori Organization Governance Dashboard</title>
${renderStyles(colorValue)}
</head>
<body>
  <h1>Shiori Organization Governance Dashboard</h1>
  <div class="meta">Generated: ${escapeHtml(result.timestamp)}</div>
${sections}
  <footer>Generated by shiori &mdash; annotation tracking &amp; governance</footer>
${renderScript()}
</body>
</html>`;
}
