/**
 * Compute category-level diff between two governance report snapshots.
 *
 * Compares a base and head ReportResult to produce a SnapshotDiff
 * with numeric deltas for each tracked metric category.
 * Pure function — no I/O.
 */

import type { ReportResult, HealthLevel, TrendDirection } from './types.ts';

// ── Types ────────────────────────────────────────────────────

/** A numeric change in a single metric category */
export interface CategoryDelta {
  /** Metric name (e.g. "annotations", "issues") */
  category: string;
  /** Value in the base snapshot */
  base: number;
  /** Value in the head snapshot */
  head: number;
  /** Absolute change: head - base */
  delta: number;
}

/** Health level transition between two snapshots */
export interface HealthTransition {
  /** Base health level */
  base: HealthLevel;
  /** Head health level */
  head: HealthLevel;
  /** Base health score */
  baseScore: number;
  /** Head health score */
  headScore: number;
  /** Score change: head - base */
  scoreDelta: number;
  /** Transition direction */
  direction: TrendDirection;
}

/** Result of comparing two report snapshots */
export interface SnapshotDiff {
  /** Base snapshot timestamp */
  baseTimestamp: string;
  /** Head snapshot timestamp */
  headTimestamp: string;
  /** Per-category deltas */
  categories: CategoryDelta[];
  /** Health level transition */
  health: HealthTransition;
}

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
