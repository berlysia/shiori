import { assertNever } from '../core/types.ts';
import { wrapOutputJson } from '../core/schema-envelope.ts';
import type {
  TrendPoint,
  TrendDirection,
  TrendResult,
  TrendFormat,
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

  // Timeline table — add coverage/hygiene columns when any point has them
  const hasDualAxis = result.points.some(
    (p) => p.coverage !== undefined || p.hygiene !== undefined,
  );
  lines.push('## Timeline');
  lines.push('');
  if (hasDualAxis) {
    lines.push(
      '| Timestamp | Score | Coverage | Hygiene | Level | Issues | Annotations | Candidates |',
    );
    lines.push(
      '|-----------|-------|----------|---------|-------|--------|-------------|------------|',
    );
    for (const p of result.points) {
      const levelEmoji = healthEmoji(p.level);
      lines.push(
        `| ${p.timestamp} | ${p.score}/100 | ${p.coverage ?? '-'} | ${p.hygiene ?? '-'} | ${levelEmoji} ${p.level} | ${p.issues} | ${p.annotations} | ${p.candidates} |`,
      );
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
 * Renders three series (one per line):
 *   Score:   ▁▃▅▇█▆▄  85/100 📈 improving (+15, 7 pts)
 *   Issues:  █▆▄▃▁▁▁  2
 *   Untracked: ▇▅▃▂▁▁▁  8%
 *
 * Uses only Unicode block characters — no ANSI escape codes, no color.
 * Fixed-width sparkline (one char per data point). No terminal width detection.
 */
export function formatTrendAsSpark(result: TrendResult): string {
  if (result.points.length === 0) {
    return 'No data points available.';
  }

  const { summary, points } = result;

  // Series 1: Health score (existing behavior)
  const scoreSpark = points
    .map((p) => valueToBlock(p.score, summary.minScore, summary.maxScore))
    .join('');
  const dirEmoji = trendEmoji(summary.direction);
  const sign = summary.scoreChange >= 0 ? '+' : '';
  const scoreLine = `Score:     ${scoreSpark}  ${summary.latestScore}/100 ${dirEmoji} ${summary.direction} (${sign}${summary.scoreChange}, ${summary.count} pts)`;

  // Series 2: Issue count
  const issueValues = points.map((p) => p.issues);
  const issueSpark = buildSparkline(issueValues);
  const latestIssues = points[points.length - 1]!.issues;
  const issueLine = `Issues:    ${issueSpark}  ${latestIssues}`;

  // Series 3: Untracked ratio (candidates / (annotations + candidates))
  const untrackedValues = points.map((p) => {
    const total = p.annotations + p.candidates;
    return total > 0 ? (p.candidates / total) * 100 : 0;
  });
  const untrackedSpark = buildSparkline(untrackedValues);
  const latestUntracked = untrackedValues[untrackedValues.length - 1]!;
  const untrackedLine = `Untracked: ${untrackedSpark}  ${latestUntracked.toFixed(0)}%`;

  const seriesLines = [scoreLine, issueLine, untrackedLine];

  // Series 4-5: Coverage/Hygiene (ADR 024 Phase 2, shown when available)
  const hasDualAxis = points.some(
    (p) => p.coverage !== undefined || p.hygiene !== undefined,
  );
  if (hasDualAxis) {
    const coverageValues = points.map((p) => p.coverage ?? 0);
    const coverageSpark = buildSparkline(coverageValues);
    const latestCoverage = coverageValues[coverageValues.length - 1]!;
    seriesLines.push(`Coverage:  ${coverageSpark}  ${latestCoverage}`);

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
export function formatTrendAsCsv(result: TrendResult): string {
  const lines: string[] = [];
  const hasDualAxis = result.points.some(
    (p) => p.coverage !== undefined || p.hygiene !== undefined,
  );
  if (hasDualAxis) {
    lines.push(
      'timestamp,score,coverage,hygiene,level,issues,annotations,candidates,registryEntries',
    );
    for (const p of result.points) {
      lines.push(
        `${p.timestamp},${p.score},${p.coverage ?? ''},${p.hygiene ?? ''},${p.level},${p.issues},${p.annotations},${p.candidates},${p.registryEntries}`,
      );
    }
  } else {
    lines.push(
      'timestamp,score,level,issues,annotations,candidates,registryEntries',
    );
    for (const p of result.points) {
      lines.push(
        `${p.timestamp},${p.score},${p.level},${p.issues},${p.annotations},${p.candidates},${p.registryEntries}`,
      );
    }
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
    case 'spark':
      return formatTrendAsSpark(result);
    case 'json':
      return wrapOutputJson(result, {
        command: 'trend',
        schemaVersion: 1,
      });
    default:
      return assertNever(format);
  }
}
