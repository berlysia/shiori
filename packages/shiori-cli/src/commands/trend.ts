import { assertNever } from '../core/types.ts';
import { wrapOutputJson } from '../core/schema-envelope.ts';
import type {
  TrendPoint,
  TrendDirection,
  TrendResult,
  TrendFormat,
  TrendAxis,
  ReportResult,
} from '../core/types.ts';
import { healthEmoji, trendEmoji } from '../core/emoji.ts';
import { valueToBlock, buildSparkline } from '../core/sparkline.ts';

export { valueToBlock, buildSparkline };

/**
 * Extract a TrendPoint from a ReportResult.
 * Uses the timestamp field as the canonical key (no filename dependency).
 */
export function extractTrendPoint(report: ReportResult): TrendPoint {
  const point: TrendPoint = {
    timestamp: report.timestamp,
    score: report.health.score,
    level: report.health.level,
    issues: report.totals.issues,
    annotations: report.totals.annotations,
    candidates: report.totals.candidates,
    registryEntries: report.totals.registryEntries,
  };
  // ADR 024 Phase 2: extract dual-axis scores when available
  if (report.health.coverage !== undefined) {
    point.coverage = report.health.coverage;
  }
  if (report.health.hygiene !== undefined) {
    point.hygiene = report.health.hygiene;
  }
  return point;
}

/**
 * Compute TrendResult from pre-extracted TrendPoints.
 *
 * - Sorts by timestamp (oldest first)
 * - Deduplicates by timestamp (keeps first occurrence)
 * - Applies --last N limit after sorting
 *
 * Shared computation core for both report-based and journal-based trend paths.
 * Pure function — no I/O.
 */
export function computeTrendFromPoints(
  rawPoints: TrendPoint[],
  options?: { last?: number },
): TrendResult {
  if (rawPoints.length === 0) {
    return {
      points: [],
      summary: {
        count: 0,
        oldest: '',
        newest: '',
        latestScore: 0,
        scoreChange: 0,
        direction: 'stable',
        minScore: 0,
        maxScore: 0,
      },
    };
  }

  // Sort by timestamp ascending (oldest first)
  let points = [...rawPoints].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  );

  // Deduplicate by timestamp (keep first occurrence)
  const seen = new Set<string>();
  points = points.filter((p) => {
    if (seen.has(p.timestamp)) return false;
    seen.add(p.timestamp);
    return true;
  });

  // Apply --last N limit (keep most recent N points)
  const last = options?.last;
  if (last !== undefined && last > 0 && points.length > last) {
    points = points.slice(points.length - last);
  }

  const first = points[0]!;
  const latest = points[points.length - 1]!;
  const scoreChange = latest.score - first.score;
  const direction: TrendDirection =
    scoreChange > 0 ? 'improving' : scoreChange < 0 ? 'declining' : 'stable';

  const scores = points.map((p) => p.score);

  return {
    points,
    summary: {
      count: points.length,
      oldest: first.timestamp,
      newest: latest.timestamp,
      latestScore: latest.score,
      scoreChange,
      direction,
      minScore: Math.min(...scores),
      maxScore: Math.max(...scores),
    },
  };
}

/**
 * Compute a governance score trend from an array of ReportResult JSON objects.
 *
 * Extracts TrendPoints from reports, then delegates to computeTrendFromPoints().
 * Pure function — no I/O.
 */
export function computeTrend(
  reports: ReportResult[],
  options?: { last?: number },
): TrendResult {
  const points = reports.map(extractTrendPoint);
  return computeTrendFromPoints(points, options);
}

/** Options for trend formatters (ADR 024 Phase 2) */
export interface TrendFormatOptions {
  /** Filter to show only a specific metric axis */
  axis?: TrendAxis;
}

/**
 * Determine which metric columns to show based on data availability and axis filter.
 */
function resolveVisibleAxes(
  points: TrendPoint[],
  axis?: TrendAxis,
): { showScore: boolean; showCoverage: boolean; showHygiene: boolean } {
  const hasDualAxis = points.some(
    (p) => p.coverage !== undefined || p.hygiene !== undefined,
  );
  if (axis === 'score') {
    return { showScore: true, showCoverage: false, showHygiene: false };
  }
  if (axis === 'coverage') {
    return { showScore: false, showCoverage: hasDualAxis, showHygiene: false };
  }
  if (axis === 'hygiene') {
    return { showScore: false, showCoverage: false, showHygiene: hasDualAxis };
  }
  // No filter: show all available axes
  return {
    showScore: true,
    showCoverage: hasDualAxis,
    showHygiene: hasDualAxis,
  };
}

/**
 * Format TrendResult as Markdown.
 */
export function formatTrendAsMarkdown(
  result: TrendResult,
  options?: TrendFormatOptions,
): string {
  const lines: string[] = [];

  lines.push('# Shiori Governance Trend');
  lines.push('');

  if (result.points.length === 0) {
    lines.push('No data points available.');
    return lines.join('\n');
  }

  // Direction emoji
  const dirEmoji = trendEmoji(result.summary.direction);

  lines.push(`## Summary: ${dirEmoji} ${result.summary.direction}`);
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Data points | ${result.summary.count} |`);
  lines.push(
    `| Period | ${result.summary.oldest} → ${result.summary.newest} |`,
  );
  lines.push(`| Latest score | ${result.summary.latestScore}/100 |`);
  lines.push(
    `| Score change | ${result.summary.scoreChange >= 0 ? '+' : ''}${result.summary.scoreChange} |`,
  );
  lines.push(`| Min score | ${result.summary.minScore} |`);
  lines.push(`| Max score | ${result.summary.maxScore} |`);
  lines.push('');

  // Timeline table — columns controlled by axis filter
  const { showScore, showCoverage, showHygiene } = resolveVisibleAxes(
    result.points,
    options?.axis,
  );
  const showDualAxis = showCoverage || showHygiene;

  lines.push('## Timeline');
  lines.push('');
  if (showDualAxis) {
    const headers = ['Timestamp'];
    if (showScore) headers.push('Score');
    if (showCoverage) headers.push('Coverage');
    if (showHygiene) headers.push('Hygiene');
    headers.push('Level', 'Issues', 'Annotations', 'Candidates');
    lines.push(`| ${headers.join(' | ')} |`);
    lines.push(`|${headers.map(() => '---').join('|')}|`);
    for (const p of result.points) {
      const levelEmoji = healthEmoji(p.level);
      const cols = [p.timestamp];
      if (showScore) cols.push(`${p.score}/100`);
      if (showCoverage) cols.push(`${p.coverage ?? '-'}`);
      if (showHygiene) cols.push(`${p.hygiene ?? '-'}`);
      cols.push(
        `${levelEmoji} ${p.level}`,
        `${p.issues}`,
        `${p.annotations}`,
        `${p.candidates}`,
      );
      lines.push(`| ${cols.join(' | ')} |`);
    }
  } else {
    lines.push(
      '| Timestamp | Score | Level | Issues | Annotations | Candidates |',
    );
    lines.push(
      '|-----------|-------|-------|--------|-------------|------------|',
    );
    for (const p of result.points) {
      const levelEmoji = healthEmoji(p.level);
      lines.push(
        `| ${p.timestamp} | ${p.score}/100 | ${levelEmoji} ${p.level} | ${p.issues} | ${p.annotations} | ${p.candidates} |`,
      );
    }
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Format TrendResult as a multi-series Unicode sparkline for terminal display.
 *
 * Renders series based on axis filter (or all when no filter):
 *   Score:   ▁▃▅▇█▆▄  85/100 📈 improving (+15, 7 pts)
 *   Issues:  █▆▄▃▁▁▁  2
 *   Untracked: ▇▅▃▂▁▁▁  8%
 *   Coverage:  ▅▆▇██  95
 *   Hygiene:   ▃▅▆▇█  88
 *
 * Uses only Unicode block characters — no ANSI escape codes, no color.
 * Fixed-width sparkline (one char per data point). No terminal width detection.
 */
export function formatTrendAsSpark(
  result: TrendResult,
  options?: TrendFormatOptions,
): string {
  if (result.points.length === 0) {
    return 'No data points available.';
  }

  const { summary, points } = result;
  const { showScore, showCoverage, showHygiene } = resolveVisibleAxes(
    points,
    options?.axis,
  );

  const seriesLines: string[] = [];

  // Series 1: Health score (shown unless filtered to coverage/hygiene only)
  if (showScore) {
    const scoreSpark = points
      .map((p) => valueToBlock(p.score, summary.minScore, summary.maxScore))
      .join('');
    const dirEmoji = trendEmoji(summary.direction);
    const sign = summary.scoreChange >= 0 ? '+' : '';
    seriesLines.push(
      `Score:     ${scoreSpark}  ${summary.latestScore}/100 ${dirEmoji} ${summary.direction} (${sign}${summary.scoreChange}, ${summary.count} pts)`,
    );
  }

  // Series 2: Issue count (always shown when score is shown)
  if (showScore) {
    const issueValues = points.map((p) => p.issues);
    const issueSpark = buildSparkline(issueValues);
    const latestIssues = points[points.length - 1]!.issues;
    seriesLines.push(`Issues:    ${issueSpark}  ${latestIssues}`);
  }

  // Series 3: Untracked ratio (always shown when score is shown)
  if (showScore) {
    const untrackedValues = points.map((p) => {
      const total = p.annotations + p.candidates;
      return total > 0 ? (p.candidates / total) * 100 : 0;
    });
    const untrackedSpark = buildSparkline(untrackedValues);
    const latestUntracked = untrackedValues[untrackedValues.length - 1]!;
    seriesLines.push(
      `Untracked: ${untrackedSpark}  ${latestUntracked.toFixed(0)}%`,
    );
  }

  // Series 4: Coverage (ADR 024 Phase 2)
  if (showCoverage) {
    const coverageValues = points.map((p) => p.coverage ?? 0);
    const coverageSpark = buildSparkline(coverageValues);
    const latestCoverage = coverageValues[coverageValues.length - 1]!;
    seriesLines.push(`Coverage:  ${coverageSpark}  ${latestCoverage}`);
  }

  // Series 5: Hygiene (ADR 024 Phase 2)
  if (showHygiene) {
    const hygieneValues = points.map((p) => p.hygiene ?? 0);
    const hygieneSpark = buildSparkline(hygieneValues);
    const latestHygiene = hygieneValues[hygieneValues.length - 1]!;
    seriesLines.push(`Hygiene:   ${hygieneSpark}  ${latestHygiene}`);
  }

  return seriesLines.join('\n');
}

/**
 * Format TrendResult as CSV.
 */
export function formatTrendAsCsv(
  result: TrendResult,
  options?: TrendFormatOptions,
): string {
  const lines: string[] = [];
  const { showScore, showCoverage, showHygiene } = resolveVisibleAxes(
    result.points,
    options?.axis,
  );

  // Build header dynamically based on visible axes
  const headerCols = ['timestamp'];
  if (showScore) headerCols.push('score');
  if (showCoverage) headerCols.push('coverage');
  if (showHygiene) headerCols.push('hygiene');
  headerCols.push(
    'level',
    'issues',
    'annotations',
    'candidates',
    'registryEntries',
  );
  lines.push(headerCols.join(','));

  for (const p of result.points) {
    const dataCols = [p.timestamp];
    if (showScore) dataCols.push(`${p.score}`);
    if (showCoverage) dataCols.push(`${p.coverage ?? ''}`);
    if (showHygiene) dataCols.push(`${p.hygiene ?? ''}`);
    dataCols.push(
      p.level,
      `${p.issues}`,
      `${p.annotations}`,
      `${p.candidates}`,
      `${p.registryEntries}`,
    );
    lines.push(dataCols.join(','));
  }
  return lines.join('\n');
}

/**
 * Format trend result for output.
 */
export function formatTrend(
  result: TrendResult,
  format: TrendFormat,
  options?: TrendFormatOptions,
): string {
  switch (format) {
    case 'markdown':
      return formatTrendAsMarkdown(result, options);
    case 'csv':
      return formatTrendAsCsv(result, options);
    case 'spark':
      return formatTrendAsSpark(result, options);
    case 'json':
      return wrapOutputJson(result, {
        command: 'trend',
        schemaVersion: 1,
      });
    default:
      return assertNever(format);
  }
}
