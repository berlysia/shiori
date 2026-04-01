/**
 * Coach diff utilities for sprint-over-sprint governance comparison (EP-0207).
 *
 * Collects CoachSnapshotData from HealthResult, computes deltas between
 * two snapshots, and generates one-liner summaries for template injection.
 * Pure functions — no I/O.
 */

import type {
  HealthResult,
  CoachSnapshotData,
  CoachDiffContext,
  StageTransition,
  HealthMaturityStage,
} from './types.ts';

// ── Maturity stage ordering (for transition detection) ───────

const MATURITY_STAGE_ORDER: Record<HealthMaturityStage, number> = {
  Foundation: 0,
  Tracking: 1,
  Maintained: 2,
  Autonomous: 3,
};

/**
 * Format a signed number for display (e.g. +5, -3, ±0).
 * Shared by coach-diff and coach template rendering.
 */
export function formatSigned(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `${n}`;
  return '±0';
}

/**
 * Collect a CoachSnapshotData from a HealthResult.
 * Extracts the governance metrics relevant for sprint diff comparison.
 */
export function collectCoachSnapshot(
  healthResult: HealthResult,
): CoachSnapshotData {
  return {
    timestamp: healthResult.timestamp,
    totalIssues: healthResult.issues.total,
    expiredRefs: healthResult.expiring.expired,
    healthScore: healthResult.health.score,
    coverage: healthResult.health.coverage,
    hygiene: healthResult.health.hygiene,
    maturityStage: healthResult.maturityStage,
  };
}

/**
 * Compute numeric deltas between two snapshots.
 */
function computeDeltas(
  previous: CoachSnapshotData,
  current: CoachSnapshotData,
): CoachDiffContext['deltas'] {
  return {
    totalIssues: current.totalIssues - previous.totalIssues,
    expiredRefs: current.expiredRefs - previous.expiredRefs,
    healthScore: current.healthScore - previous.healthScore,
    coverage: current.coverage - previous.coverage,
    hygiene: current.hygiene - previous.hygiene,
  };
}

/**
 * Detect stage transition between two snapshots.
 * Returns StageTransition only when the stage actually changed.
 */
function detectStageTransition(
  previous: CoachSnapshotData,
  current: CoachSnapshotData,
): StageTransition | undefined {
  if (previous.maturityStage == null || current.maturityStage == null) {
    return undefined;
  }
  if (previous.maturityStage === current.maturityStage) {
    return undefined;
  }
  return {
    from: previous.maturityStage,
    to: current.maturityStage,
  };
}

/**
 * Generate a one-line summary of the diff for template header.
 * When no previous snapshot exists, returns a baseline message.
 */
export function buildDiffSummaryOneLiner(
  current: CoachSnapshotData,
  previous?: CoachSnapshotData,
): string {
  if (previous == null) {
    return `ベースラインスナップショット（健康スコア: ${current.healthScore}/100, カバレッジ: ${current.coverage}, 衛生度: ${current.hygiene}）`;
  }

  const scoreDelta = current.healthScore - previous.healthScore;
  const parts: string[] = [
    `健康スコア: ${previous.healthScore} → ${current.healthScore}（${formatSigned(scoreDelta)}）`,
  ];

  const covDelta = current.coverage - previous.coverage;
  if (covDelta !== 0) {
    parts.push(`カバレッジ: ${formatSigned(covDelta)}`);
  }

  const hygDelta = current.hygiene - previous.hygiene;
  if (hygDelta !== 0) {
    parts.push(`衛生度: ${formatSigned(hygDelta)}`);
  }

  return parts.join(', ');
}

/**
 * Build a CoachDiffContext from the current HealthResult and an optional
 * previous snapshot. When previous is undefined (first run), only the
 * current snapshot and baseline one-liner are populated.
 */
export function buildCoachDiffContext(
  healthResult: HealthResult,
  previousSnapshot?: CoachSnapshotData,
): CoachDiffContext {
  const current = collectCoachSnapshot(healthResult);
  const diffSummaryOneLiner = buildDiffSummaryOneLiner(
    current,
    previousSnapshot,
  );

  if (previousSnapshot == null) {
    return {
      current,
      diffSummaryOneLiner,
    };
  }

  return {
    current,
    previous: previousSnapshot,
    deltas: computeDeltas(previousSnapshot, current),
    stageTransition: detectStageTransition(previousSnapshot, current),
    diffSummaryOneLiner,
  };
}

/**
 * Check if a stage transition represents an advancement (higher stage).
 */
export function isStageAdvancement(transition: StageTransition): boolean {
  return (
    MATURITY_STAGE_ORDER[transition.to] > MATURITY_STAGE_ORDER[transition.from]
  );
}

/**
 * Format a CoachSnapshotData as a JSON string for snapshot file persistence.
 */
export function serializeCoachSnapshot(snapshot: CoachSnapshotData): string {
  return JSON.stringify(snapshot, null, 2) + '\n';
}

/**
 * Parse a JSON string back into CoachSnapshotData.
 * Returns undefined if parsing fails or required fields are missing.
 * Applies defaults for optional fields to handle older snapshots gracefully.
 */
export function deserializeCoachSnapshot(
  json: string,
): CoachSnapshotData | undefined {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (
      typeof parsed.timestamp !== 'string' ||
      typeof parsed.healthScore !== 'number' ||
      typeof parsed.coverage !== 'number' ||
      typeof parsed.hygiene !== 'number'
    ) {
      return undefined;
    }
    return {
      timestamp: parsed.timestamp,
      // Support both old 'totalRefs' and new 'totalIssues' field names
      totalIssues:
        typeof parsed.totalIssues === 'number'
          ? parsed.totalIssues
          : typeof parsed.totalRefs === 'number'
            ? parsed.totalRefs
            : 0,
      expiredRefs:
        typeof parsed.expiredRefs === 'number' ? parsed.expiredRefs : 0,
      healthScore: parsed.healthScore,
      coverage: parsed.coverage,
      hygiene: parsed.hygiene,
      maturityStage: parsed.maturityStage as HealthMaturityStage | undefined,
    };
  } catch {
    return undefined;
  }
}

/**
 * Generate an ISO8601-based filename for a coach snapshot.
 * Replaces characters that are problematic in filenames (: and .)
 */
export function coachSnapshotFilename(timestamp: string): string {
  return `coach-${timestamp.replace(/[:.]/g, '-')}.json`;
}

/** Default maximum number of coach snapshots to retain (EP-0208). */
export const DEFAULT_MAX_SNAPSHOTS = 30;

/**
 * Determine which snapshot files to delete for auto-rotation (EP-0208).
 *
 * Accepts a list of filenames (not full paths), sorts lexicographically
 * (oldest first because ISO8601 timestamps sort naturally), and returns
 * the filenames that exceed the retention limit.
 *
 * Pure function — caller handles actual file deletion.
 */
export function selectSnapshotsToDelete(
  files: readonly string[],
  maxSnapshots: number,
): string[] {
  if (maxSnapshots <= 0 || files.length <= maxSnapshots) {
    return [];
  }
  const sorted = [...files].sort();
  return sorted.slice(0, sorted.length - maxSnapshots);
}
