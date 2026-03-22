import type {
  ReportResult,
  ReportInsight,
  BreakdownEntry,
  VerifyIssueType,
  DeltaResult,
  DeltaKind,
  AnnotationDelta,
  ShioriAnnotation,
  ChronicleResult,
  ChronicleEntry,
  ChronicleEvent,
  ChronicleEventType,
  FileBreakdownEntry,
  DirectoryBreakdownEntry,
} from '../core/types.ts';
import {
  escapeHtml,
  healthColorCss as healthColor,
  healthIndicator,
} from '../core/html-utils.ts';

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
  .delta-summary {
    display: flex;
    gap: 1rem;
    margin-bottom: 1rem;
  }
  .delta-badge {
    padding: 0.25rem 0.75rem;
    border-radius: 999px;
    font-size: 0.85rem;
    font-weight: 600;
  }
  .delta-badge.added { background: rgba(34,197,94,0.15); color: #22c55e; }
  .delta-badge.removed { background: rgba(239,68,68,0.15); color: #ef4444; }
  .delta-badge.unchanged { background: rgba(148,163,184,0.15); color: #94a3b8; }
  .delta-badge.net { background: rgba(59,130,246,0.15); color: #3b82f6; }
  .delta-table tr.delta-added td { border-left: 3px solid #22c55e; }
  .delta-table tr.delta-removed td { border-left: 3px solid #ef4444; }
  .delta-table tr.delta-unchanged td { border-left: 3px solid var(--border); }
  .delta-kind {
    display: inline-block;
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
  }
  .delta-kind.added { background: rgba(34,197,94,0.15); color: #22c55e; }
  .delta-kind.removed { background: rgba(239,68,68,0.15); color: #ef4444; }
  .delta-kind.unchanged { background: rgba(148,163,184,0.15); color: #94a3b8; }
  .provenance-table td.provenance-hash { font-family: monospace; font-size: 0.85rem; }
  .provenance-table td.provenance-date { white-space: nowrap; }
  .chronicle-entry {
    background: var(--surface);
    border-radius: 8px;
    padding: 1rem 1.25rem;
    margin-bottom: 1rem;
  }
  .chronicle-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
    flex-wrap: wrap;
  }
  .chronicle-ref {
    font-weight: 700;
    font-size: 1rem;
    font-family: monospace;
  }
  .chronicle-meta {
    font-size: 0.8rem;
    color: var(--text-muted);
  }
  .chronicle-status {
    display: inline-block;
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
  }
  .chronicle-status.open { background: rgba(34,197,94,0.15); color: #22c55e; }
  .chronicle-status.closed { background: rgba(239,68,68,0.15); color: #ef4444; }
  .chronicle-status.unknown { background: rgba(148,163,184,0.15); color: #94a3b8; }
  .chronicle-timeline {
    position: relative;
    padding-left: 1.5rem;
    border-left: 2px solid var(--border);
  }
  .chronicle-event {
    position: relative;
    padding: 0.25rem 0 0.5rem 0.75rem;
    font-size: 0.85rem;
  }
  .chronicle-event::before {
    content: '';
    position: absolute;
    left: -1.85rem;
    top: 0.45rem;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--border);
  }
  .chronicle-event.introduced::before { background: #22c55e; }
  .chronicle-event.expires::before { background: #3b82f6; }
  .chronicle-event.expired::before { background: #ef4444; }
  .chronicle-event.status-closed::before { background: #f59e0b; }
  .chronicle-event-date {
    font-family: monospace;
    font-size: 0.8rem;
    color: var(--text-muted);
    margin-right: 0.5rem;
  }
  .chronicle-locations {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin-top: 0.25rem;
  }
  .chronicle-summary {
    display: flex;
    gap: 1rem;
    margin-bottom: 1rem;
    flex-wrap: wrap;
  }
  .chronicle-stat {
    padding: 0.25rem 0.75rem;
    border-radius: 999px;
    font-size: 0.85rem;
    font-weight: 600;
    background: rgba(148,163,184,0.15);
    color: var(--text-muted);
  }
  .heatmap-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 0.75rem;
    margin-bottom: 1rem;
  }
  .heatmap-card {
    background: var(--surface);
    border-radius: 8px;
    padding: 0.75rem 1rem;
    border-left: 4px solid var(--border);
  }
  .heatmap-card.status-expired { border-left-color: #ef4444; }
  .heatmap-card.status-expiring { border-left-color: #eab308; }
  .heatmap-card.status-healthy { border-left-color: #22c55e; }
  .heatmap-path {
    font-family: monospace;
    font-size: 0.85rem;
    word-break: break-all;
    margin-bottom: 0.35rem;
  }
  .heatmap-bar-container {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
  }
  .heatmap-bar {
    flex: 1;
    height: 8px;
    border-radius: 4px;
    background: var(--surface-alt);
    overflow: hidden;
    display: flex;
  }
  .heatmap-bar-expired { background: #ef4444; }
  .heatmap-bar-expiring { background: #eab308; }
  .heatmap-bar-healthy { background: #22c55e; }
  .heatmap-count {
    font-size: 0.85rem;
    font-weight: 600;
    min-width: 2ch;
    text-align: right;
  }
  .heatmap-status {
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .heatmap-dir-table {
    width: 100%;
    border-collapse: collapse;
    background: var(--surface);
    border-radius: 8px;
    overflow: hidden;
    margin-top: 1rem;
  }
  .heatmap-dir-table th, .heatmap-dir-table td {
    padding: 0.5rem 0.75rem;
    text-align: left;
    border-bottom: 1px solid var(--border);
    font-size: 0.85rem;
  }
  .heatmap-dir-table th {
    background: var(--surface-alt);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }
  .heatmap-dir-table tr:last-child td { border-bottom: none; }
  .heatmap-dir-table td.dir-path { font-family: monospace; }
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
 * Map delta kind to display icon.
 */
function deltaKindIcon(kind: DeltaKind): string {
  switch (kind) {
    case 'added':
      return '+';
    case 'removed':
      return '\u2212'; // minus sign
    case 'unchanged':
      return '=';
  }
}

/**
 * Get the display location from a delta entry (file:line).
 */
function deltaLocation(delta: AnnotationDelta): string {
  const annotation = delta.head ?? delta.base;
  if (!annotation) return '';
  return `${annotation.location.file}:${annotation.location.line}`;
}

/**
 * Render the governance diff overlay section.
 * Shows summary badges and a table of changed annotations.
 */
function renderDeltaOverlay(delta: DeltaResult): string {
  const { summary, deltas } = delta;

  // Summary badges
  const netSign = summary.net > 0 ? '+' : '';
  const summaryHtml = `<div class="delta-summary">
    <span class="delta-badge added">+${summary.added} added</span>
    <span class="delta-badge removed">\u2212${summary.removed} removed</span>
    <span class="delta-badge unchanged">${summary.unchanged} unchanged</span>
    <span class="delta-badge net">net ${netSign}${summary.net}</span>
  </div>`;

  // Only show the table if there are changes (added or removed)
  const changedDeltas = deltas.filter((d) => d.kind !== 'unchanged');
  if (changedDeltas.length === 0) {
    return `<div class="section">
  <h2>Changes</h2>
  ${summaryHtml}
  <p class="empty">No changes since last scan.</p>
</div>`;
  }

  const rows = changedDeltas
    .map((d) => {
      const icon = deltaKindIcon(d.kind);
      const location = escapeHtml(deltaLocation(d));
      return `    <tr class="delta-${d.kind}"><td><span class="delta-kind ${d.kind}">${icon} ${d.kind}</span></td><td>${escapeHtml(d.ref)}</td><td>${location}</td></tr>`;
    })
    .join('\n');

  return `<div class="section">
  <h2>Changes</h2>
  ${summaryHtml}
  <table class="delta-table">
    <thead><tr><th>Change</th><th>Ref</th><th>Location</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
</div>`;
}

/**
 * Render the provenance section showing git blame info per annotation.
 * Only annotations with provenance data are shown.
 */
function renderProvenanceSection(annotations: ShioriAnnotation[]): string {
  const withProvenance = annotations.filter((a) => a.provenance);
  if (withProvenance.length === 0) return '';

  const rows = withProvenance
    .map((a) => {
      const p = a.provenance!;
      const location = `${a.location.file}:${a.location.line}`;
      return `    <tr><td>${escapeHtml(a.ref || '(draft)')}</td><td>${escapeHtml(location)}</td><td class="provenance-hash">${escapeHtml(p.commitHash)}</td><td>${escapeHtml(p.author)}</td><td class="provenance-date">${escapeHtml(p.date.slice(0, 10))}</td><td>${escapeHtml(p.commitSummary)}</td></tr>`;
    })
    .join('\n');

  return `<div class="section">
  <h2>Provenance</h2>
  <table class="provenance-table">
    <thead><tr><th>Ref</th><th>Location</th><th>Commit</th><th>Author</th><th>Date</th><th>Summary</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
</div>`;
}

/**
 * Map chronicle event type to display icon.
 */
function chronicleEventIcon(type: ChronicleEventType): string {
  switch (type) {
    case 'introduced':
      return '\u{1F7E2}'; // green circle
    case 'expires':
      return '\u{1F535}'; // blue circle
    case 'expired':
      return '\u{1F534}'; // red circle
    case 'status-closed':
      return '\u{1F7E0}'; // orange circle
  }
}

/**
 * Render a single chronicle event as HTML.
 */
function renderChronicleEvent(event: ChronicleEvent): string {
  const icon = chronicleEventIcon(event.type);
  return `<div class="chronicle-event ${event.type}">
      <span class="chronicle-event-date">${escapeHtml(event.date)}</span>
      ${icon} ${escapeHtml(event.label)}
    </div>`;
}

/**
 * Render a single chronicle entry (ref card with timeline).
 */
function renderChronicleEntry(entry: ChronicleEntry): string {
  const statusBadge = entry.currentStatus
    ? `<span class="chronicle-status ${entry.currentStatus}">${entry.currentStatus}</span>`
    : '';
  const metaParts: string[] = [];
  if (entry.owner) metaParts.push(`owner: ${escapeHtml(entry.owner)}`);
  if (entry.kind) metaParts.push(`kind: ${escapeHtml(entry.kind)}`);
  const metaHtml =
    metaParts.length > 0
      ? `<span class="chronicle-meta">${metaParts.join(' · ')}</span>`
      : '';

  const eventsHtml =
    entry.events.length > 0
      ? `<div class="chronicle-timeline">\n${entry.events.map(renderChronicleEvent).join('\n')}\n    </div>`
      : '<p class="empty">No timeline events available.</p>';

  const locations = entry.locations
    .map((l) => `${escapeHtml(l.file)}:${l.line}`)
    .join(', ');

  return `<div class="chronicle-entry">
    <div class="chronicle-header">
      <span class="chronicle-ref">${escapeHtml(entry.ref)}</span>
      ${statusBadge}
      ${metaHtml}
    </div>
    ${eventsHtml}
    <div class="chronicle-locations">${locations}</div>
  </div>`;
}

/**
 * Render the chronicle timeline section.
 * Shows per-ref timeline cards with events sorted chronologically.
 */
function renderChronicleSection(chronicle: ChronicleResult): string {
  if (chronicle.entries.length === 0) return '';

  const { summary } = chronicle;
  const summaryHtml = `<div class="chronicle-summary">
    <span class="chronicle-stat">${summary.totalRefs} refs</span>
    <span class="chronicle-stat">${summary.withProvenance} with provenance</span>
    <span class="chronicle-stat">${summary.withRefStatus} with status</span>
    <span class="chronicle-stat">${summary.withExpires} with expiry</span>
  </div>`;

  const entriesHtml = chronicle.entries.map(renderChronicleEntry).join('\n');

  return `<div class="section">
  <h2>Annotation Chronicle</h2>
  ${summaryHtml}
  ${entriesHtml}
</div>`;
}

/**
 * Determine heatmap card status class based on expiry counts.
 * Priority: expired > expiring > healthy.
 */
function fileStatusClass(entry: FileBreakdownEntry): string {
  if (entry.expiredCount > 0) return 'status-expired';
  if (entry.expiringCount > 0) return 'status-expiring';
  return 'status-healthy';
}

/**
 * Render a single file card for the heatmap grid.
 */
function renderHeatmapCard(entry: FileBreakdownEntry): string {
  const statusClass = fileStatusClass(entry);
  const total = entry.annotationCount;

  // Bar segments as percentage of total for this file
  const expiredPct = total > 0 ? (entry.expiredCount / total) * 100 : 0;
  const expiringPct = total > 0 ? (entry.expiringCount / total) * 100 : 0;
  const healthyPct = total > 0 ? (entry.healthyCount / total) * 100 : 0;

  // Build bar segments
  const barSegments: string[] = [];
  if (expiredPct > 0)
    barSegments.push(
      `<div class="heatmap-bar-expired" style="width:${expiredPct.toFixed(1)}%"></div>`,
    );
  if (expiringPct > 0)
    barSegments.push(
      `<div class="heatmap-bar-expiring" style="width:${expiringPct.toFixed(1)}%"></div>`,
    );
  if (healthyPct > 0)
    barSegments.push(
      `<div class="heatmap-bar-healthy" style="width:${healthyPct.toFixed(1)}%"></div>`,
    );

  // Status line (only if there are expired or expiring)
  const statusParts: string[] = [];
  if (entry.expiredCount > 0) statusParts.push(`${entry.expiredCount} expired`);
  if (entry.expiringCount > 0)
    statusParts.push(`${entry.expiringCount} expiring`);
  const statusLine =
    statusParts.length > 0
      ? `\n    <div class="heatmap-status">${statusParts.join(' \u00B7 ')}</div>`
      : '';

  return `  <div class="heatmap-card ${statusClass}">
    <div class="heatmap-path">${escapeHtml(entry.path)}</div>
    <div class="heatmap-bar-container">
      <div class="heatmap-bar">${barSegments.join('')}</div>
      <span class="heatmap-count">${total}</span>
    </div>${statusLine}
  </div>`;
}

/**
 * Render the heatmap section with file cards and directory summary table.
 */
function renderHeatmapSection(
  byFile: FileBreakdownEntry[],
  byDirectory: DirectoryBreakdownEntry[],
): string {
  if (byFile.length === 0) return '';

  const cards = byFile.map((entry) => renderHeatmapCard(entry)).join('\n');

  // Directory summary table
  let dirTable = '';
  if (byDirectory.length > 0) {
    const dirRows = byDirectory
      .map(
        (d) =>
          `    <tr><td class="dir-path">${escapeHtml(d.directory)}</td><td>${d.fileCount}</td><td>${d.annotationCount}</td><td>${d.expiredCount}</td><td>${d.expiringCount}</td></tr>`,
      )
      .join('\n');
    dirTable = `
  <table class="heatmap-dir-table">
    <thead><tr><th>Directory</th><th>Files</th><th>Annotations</th><th>Expired</th><th>Expiring</th></tr></thead>
    <tbody>
${dirRows}
    </tbody>
  </table>`;
  }

  return `<div class="section">
  <h2>Annotation Heatmap</h2>
  <div class="heatmap-grid">
${cards}
  </div>${dirTable}
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
      var content = section.querySelectorAll('table, ul, .heatmap-grid');
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
  /** Delta result for governance diff overlay (computed from previous and current scan) */
  delta?: DeltaResult;
  /** Annotations enriched with provenance info (for provenance section) */
  annotations?: ShioriAnnotation[];
  /** Chronicle result for annotation timeline visualization (EP-0048) */
  chronicle?: ChronicleResult;
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

  const deltaSection = options?.delta ? renderDeltaOverlay(options.delta) : '';
  const provenanceSection = options?.annotations
    ? renderProvenanceSection(options.annotations)
    : '';
  const chronicleSection = options?.chronicle
    ? renderChronicleSection(options.chronicle)
    : '';
  const heatmapSection =
    result.byFile && result.byDirectory
      ? renderHeatmapSection(result.byFile, result.byDirectory)
      : '';

  const sections = [
    renderHealthSection(result),
    deltaSection,
    renderOverviewTable(result),
    heatmapSection,
    renderInsights(result.insights),
    renderIssueBreakdown(result.byType),
    renderBreakdownTable('Annotations by Rule', 'Rule', result.byRule),
    renderBreakdownTable('Ownership', 'Owner', result.byOwner),
    renderBreakdownTable('Annotation Kinds', 'Kind', result.byKind),
    provenanceSection,
    chronicleSection,
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
