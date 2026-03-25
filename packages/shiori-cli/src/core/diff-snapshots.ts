/**
 * Compute category-level diff between two governance report snapshots.
 *
 * Compares a base and head ReportResult to produce a SnapshotDiff
 * with numeric deltas for each tracked metric category.
 * Pure function — no I/O.
 */

import type {
  ReportResult,
  TrendDirection,
  SnapshotDiff,
  CategoryDelta,
  HealthTransition,
} from './types.ts';

// Re-export types for backward compatibility
export type { SnapshotDiff, CategoryDelta, HealthTransition } from './types.ts';

// ── Core function ────────────────────────────────────────────

/**
 * Compute a structured diff between base and head ReportResult snapshots.
 *
 * Extracts numeric metrics from `totals` and `byType` fields,
 * computes deltas, and captures health transition.
 */
export function computeSnapshotDiff(
  base: ReportResult,
  head: ReportResult,
): SnapshotDiff {
  const categories: CategoryDelta[] = [];

  // Compare totals fields
  const totalsKeys = [
    'annotations',
    'candidates',
    'registryEntries',
    'issues',
    'errors',
    'warnings',
  ] as const;

  for (const key of totalsKeys) {
    const baseVal = base.totals[key];
    const headVal = head.totals[key];
    categories.push({
      category: key,
      base: baseVal,
      head: headVal,
      delta: headVal - baseVal,
    });
  }

  // Compare byType fields (issue type breakdown)
  const allIssueTypes = new Set([
    ...Object.keys(base.byType),
    ...Object.keys(head.byType),
  ]);

  for (const issueType of allIssueTypes) {
    const baseVal = base.byType[issueType as keyof typeof base.byType] ?? 0;
    const headVal = head.byType[issueType as keyof typeof head.byType] ?? 0;
    // Only include if there was any change or non-zero value
    if (baseVal !== 0 || headVal !== 0) {
      categories.push({
        category: `byType.${issueType}`,
        base: baseVal,
        head: headVal,
        delta: headVal - baseVal,
      });
    }
  }

  // Health transition
  const scoreDelta = head.health.score - base.health.score;
  const direction: TrendDirection =
    scoreDelta > 0 ? 'improving' : scoreDelta < 0 ? 'declining' : 'stable';

  const health: HealthTransition = {
    base: base.health.level,
    head: head.health.level,
    baseScore: base.health.score,
    headScore: head.health.score,
    scoreDelta,
    direction,
  };

  return {
    baseTimestamp: base.timestamp,
    headTimestamp: head.timestamp,
    categories,
    health,
  };
}
