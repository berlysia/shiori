import type {
  TrendPoint,
  TrendDirection,
  TrendResult,
  TrendFormat,
  ReportResult,
} from '../core/types.ts';
import { healthEmoji, trendEmoji } from '../core/emoji.ts';

/**
 * Extract a TrendPoint from a ReportResult.
 * Uses the timestamp field as the canonical key (no filename dependency).
 */
export function extractTrendPoint(report: ReportResult): TrendPoint {
  return {
    timestamp: report.timestamp,
    score: report.health.score,
    level: report.health.level,
    issues: report.totals.issues,
    annotations: report.totals.annotations,
    candidates: report.totals.candidates,
    registryEntries: report.totals.registryEntries,
  };
}

/**
 * Compute a governance score trend from an array of ReportResult JSON objects.
 *
 * - Sorts by timestamp (oldest first)
 * - Deduplicates by timestamp (keeps first occurrence)
 * - Applies --last N limit after sorting
 *
 * Pure function — no I/O.
 */
export function computeTrend(
  reports: ReportResult[],
  options?: { last?: number },
): TrendResult {
  if (reports.length === 0) {
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

  // Extract and sort by timestamp ascending (oldest first)
  let points = reports
    .map(extractTrendPoint)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

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
 * Format TrendResult as Markdown.
 */
export function formatTrendAsMarkdown(result: TrendResult): string {
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

  // Timeline table
  lines.push('## Timeline');
  lines.push('');
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
  lines.push('');

  return lines.join('\n');
}

/**
 * Format TrendResult as CSV.
 */
export function formatTrendAsCsv(result: TrendResult): string {
  const lines: string[] = [];
  lines.push(
    'timestamp,score,level,issues,annotations,candidates,registryEntries',
  );
  for (const p of result.points) {
    lines.push(
      `${p.timestamp},${p.score},${p.level},${p.issues},${p.annotations},${p.candidates},${p.registryEntries}`,
    );
  }
  return lines.join('\n');
}

/**
 * Format trend result for output.
 */
export function formatTrend(result: TrendResult, format: TrendFormat): string {
  switch (format) {
    case 'markdown':
      return formatTrendAsMarkdown(result);
    case 'csv':
      return formatTrendAsCsv(result);
    default:
      return JSON.stringify(result, null, 2);
  }
}
