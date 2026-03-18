/**
 * Journal velocity aggregation — computes operation flow rates from journal entries.
 *
 * Aggregates CliJournalEntry[] into JournalVelocityPoint[] by time bucket (hour/day/week),
 * then produces a JournalVelocityResult with summary statistics.
 *
 * Pure functions — no I/O.
 *
 * @see EP-0080 for design rationale
 */

import type {
  CliJournalEntry,
  JournalVelocityPoint,
  JournalVelocityResult,
  VelocityBucket,
  VelocityDirection,
  TrendFormat,
} from '../core/types.ts';
import { buildSparkline } from './trend.ts';

/**
 * Truncate an ISO timestamp to the start of a bucket boundary.
 *
 * - hour: "2026-03-18T14:00:00.000Z"
 * - day:  "2026-03-18T00:00:00.000Z"
 * - week: Monday 00:00:00.000Z of the ISO week containing the timestamp
 */
export function truncateToBucket(
  isoTimestamp: string,
  bucket: VelocityBucket,
): string {
  const date = new Date(isoTimestamp);

  switch (bucket) {
    case 'hour':
      date.setUTCMinutes(0, 0, 0);
      return date.toISOString();
    case 'day':
      date.setUTCHours(0, 0, 0, 0);
      return date.toISOString();
    case 'week': {
      // ISO week starts on Monday (getUTCDay: 0=Sun, 1=Mon, ..., 6=Sat)
      const day = date.getUTCDay();
      const diff = day === 0 ? -6 : 1 - day; // adjust to Monday
      date.setUTCDate(date.getUTCDate() + diff);
      date.setUTCHours(0, 0, 0, 0);
      return date.toISOString();
    }
  }
}

/**
 * Aggregate journal entries into velocity points by time bucket.
 *
 * Entries are grouped by their truncated timestamp bucket.
 * Within each bucket, operations are counted and entries_added/entries_removed are summed.
 *
 * Returns points sorted by bucket timestamp (oldest first).
 */
export function aggregateJournalEntries(
  entries: CliJournalEntry[],
  bucket: VelocityBucket,
): JournalVelocityPoint[] {
  if (entries.length === 0) return [];

  const bucketMap = new Map<
    string,
    {
      operations: number;
      successes: number;
      failures: number;
      entriesAdded: number;
      entriesRemoved: number;
      refs: Set<string>;
    }
  >();

  for (const entry of entries) {
    const key = truncateToBucket(entry.timestamp, bucket);
    let agg = bucketMap.get(key);
    if (!agg) {
      agg = {
        operations: 0,
        successes: 0,
        failures: 0,
        entriesAdded: 0,
        entriesRemoved: 0,
        refs: new Set(),
      };
      bucketMap.set(key, agg);
    }

    agg.operations++;
    if (entry.success) {
      agg.successes++;
    } else {
      agg.failures++;
    }
    agg.entriesAdded += entry.entries_added ?? 0;
    agg.entriesRemoved += entry.entries_removed ?? 0;
    for (const ref of entry.refs) {
      agg.refs.add(ref);
    }
  }

  // Convert to sorted array
  return [...bucketMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucketKey, agg]) => ({
      bucket: bucketKey,
      operations: agg.operations,
      successes: agg.successes,
      failures: agg.failures,
      entriesAdded: agg.entriesAdded,
      entriesRemoved: agg.entriesRemoved,
      netChange: agg.entriesAdded - agg.entriesRemoved,
      refsCount: agg.refs.size,
    }));
}

/**
 * Compute a journal velocity result from aggregated points.
 *
 * Applies --last N limit after sorting. Computes summary statistics.
 * Pure function — no I/O.
 */
export function computeJournalVelocity(
  entries: CliJournalEntry[],
  options?: { bucket?: VelocityBucket; last?: number },
): JournalVelocityResult {
  const bucket = options?.bucket ?? 'day';

  let points = aggregateJournalEntries(entries, bucket);

  if (points.length === 0) {
    return {
      points: [],
      summary: {
        count: 0,
        oldest: '',
        newest: '',
        totalOperations: 0,
        successRate: 0,
        totalNetChange: 0,
        direction: 'neutral',
      },
    };
  }

  // Apply --last N limit (keep most recent N buckets)
  const last = options?.last;
  if (last !== undefined && last > 0 && points.length > last) {
    points = points.slice(points.length - last);
  }

  const totalOperations = points.reduce((sum, p) => sum + p.operations, 0);
  const totalSuccesses = points.reduce((sum, p) => sum + p.successes, 0);
  const totalNetChange = points.reduce((sum, p) => sum + p.netChange, 0);
  const successRate =
    totalOperations > 0
      ? Math.round((totalSuccesses / totalOperations) * 100)
      : 0;

  const direction: VelocityDirection =
    totalNetChange > 0
      ? 'growing'
      : totalNetChange < 0
        ? 'shrinking'
        : 'neutral';

  return {
    points,
    summary: {
      count: points.length,
      oldest: points[0]!.bucket,
      newest: points[points.length - 1]!.bucket,
      totalOperations,
      successRate,
      totalNetChange,
      direction,
    },
  };
}

// ── Formatting ───────────────────────────────────────────────

/**
 * Direction emoji for velocity trends.
 */
function velocityEmoji(direction: VelocityDirection): string {
  switch (direction) {
    case 'growing':
      return '📈';
    case 'shrinking':
      return '📉';
    case 'neutral':
      return '➡️';
  }
}

/**
 * Format JournalVelocityResult as Markdown.
 */
export function formatVelocityAsMarkdown(
  result: JournalVelocityResult,
): string {
  const lines: string[] = [];
  lines.push('# Shiori Journal Velocity');
  lines.push('');

  if (result.points.length === 0) {
    lines.push('No journal data available.');
    return lines.join('\n');
  }

  const { summary } = result;
  const dirEmoji = velocityEmoji(summary.direction);

  lines.push(`## Summary: ${dirEmoji} ${summary.direction}`);
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Buckets | ${summary.count} |`);
  lines.push(`| Period | ${summary.oldest} → ${summary.newest} |`);
  lines.push(`| Total operations | ${summary.totalOperations} |`);
  lines.push(`| Success rate | ${summary.successRate}% |`);
  lines.push(
    `| Net change | ${summary.totalNetChange >= 0 ? '+' : ''}${summary.totalNetChange} |`,
  );
  lines.push('');

  // Timeline table
  lines.push('## Timeline');
  lines.push('');
  lines.push('| Bucket | Ops | OK | Fail | +Added | -Removed | Net | Refs |');
  lines.push('|--------|-----|----|------|--------|----------|-----|------|');
  for (const p of result.points) {
    lines.push(
      `| ${p.bucket} | ${p.operations} | ${p.successes} | ${p.failures} | ${p.entriesAdded} | ${p.entriesRemoved} | ${p.netChange >= 0 ? '+' : ''}${p.netChange} | ${p.refsCount} |`,
    );
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Format JournalVelocityResult as CSV.
 */
export function formatVelocityAsCsv(result: JournalVelocityResult): string {
  const lines: string[] = [];
  lines.push(
    'bucket,operations,successes,failures,entriesAdded,entriesRemoved,netChange,refsCount',
  );
  for (const p of result.points) {
    lines.push(
      `${p.bucket},${p.operations},${p.successes},${p.failures},${p.entriesAdded},${p.entriesRemoved},${p.netChange},${p.refsCount}`,
    );
  }
  return lines.join('\n');
}

/**
 * Format JournalVelocityResult as Unicode sparkline.
 *
 * Renders three series:
 *   Ops:     ▁▃▅▇█  12 ops, 92% OK 📈 growing
 *   Added:   ▃▅▇██  +15
 *   Removed: ▁▁▃▅▇  -8
 */
export function formatVelocityAsSpark(result: JournalVelocityResult): string {
  if (result.points.length === 0) {
    return 'No journal data available.';
  }

  const { summary, points } = result;
  const dirEmoji = velocityEmoji(summary.direction);

  // Series 1: Operations
  const opsSpark = buildSparkline(points.map((p) => p.operations));
  const opsLine = `Ops:     ${opsSpark}  ${summary.totalOperations} ops, ${summary.successRate}% OK ${dirEmoji} ${summary.direction}`;

  // Series 2: Entries added
  const addedSpark = buildSparkline(points.map((p) => p.entriesAdded));
  const totalAdded = points.reduce((s, p) => s + p.entriesAdded, 0);
  const addedLine = `Added:   ${addedSpark}  +${totalAdded}`;

  // Series 3: Entries removed
  const removedSpark = buildSparkline(points.map((p) => p.entriesRemoved));
  const totalRemoved = points.reduce((s, p) => s + p.entriesRemoved, 0);
  const removedLine = `Removed: ${removedSpark}  -${totalRemoved}`;

  return [opsLine, addedLine, removedLine].join('\n');
}

/**
 * Format journal velocity result for output.
 */
export function formatJournalVelocity(
  result: JournalVelocityResult,
  format: TrendFormat,
): string {
  switch (format) {
    case 'markdown':
      return formatVelocityAsMarkdown(result);
    case 'csv':
      return formatVelocityAsCsv(result);
    case 'spark':
      return formatVelocityAsSpark(result);
    default:
      return JSON.stringify(result, null, 2);
  }
}
