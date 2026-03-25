/**
 * Narrative command logic (EP-0146).
 *
 * Generates a human-readable governance narrative from a SnapshotDiff.
 * Template-based text generation — depends only on diff-snapshots.ts (core).
 * Pure function — no I/O.
 */

import type {
  SnapshotDiff,
  CategoryDelta,
  HealthTransition,
} from '../core/diff-snapshots.ts';

// ── Types ────────────────────────────────────────────────────

/** A single observation about a metric change */
export interface NarrativeObservation {
  /** Category that changed */
  category: string;
  /** Human-readable description of the change */
  message: string;
  /** Magnitude of importance (higher = more significant) */
  significance: number;
}

/** Result of computing a narrative */
export interface NarrativeResult {
  /** Headline summary of the governance transition */
  headline: string;
  /** Health transition description */
  healthSummary: string;
  /** Individual observations about metric changes, sorted by significance */
  observations: NarrativeObservation[];
  /** Base snapshot timestamp */
  baseTimestamp: string;
  /** Head snapshot timestamp */
  headTimestamp: string;
  /** Underlying diff data (for JSON output) */
  diff: SnapshotDiff;
}

// ── Helpers ──────────────────────────────────────────────────

function describeDirection(delta: number): string {
  if (delta > 0) return 'increased';
  if (delta < 0) return 'decreased';
  return 'unchanged';
}

function signPrefix(value: number): string {
  return value >= 0 ? '+' : '';
}

/** Category display names for human-readable output */
const CATEGORY_LABELS: Record<string, string> = {
  annotations: 'Annotations',
  candidates: 'Untracked candidates',
  registryEntries: 'Registry entries',
  issues: 'Issues',
  errors: 'Errors',
  warnings: 'Warnings',
};

function categoryLabel(category: string): string {
  // Handle byType.* categories
  if (category.startsWith('byType.')) {
    const issueType = category.slice('byType.'.length);
    return issueType;
  }
  return CATEGORY_LABELS[category] ?? category;
}

/** Compute significance score for a category delta */
function computeSignificance(cat: CategoryDelta): number {
  const absDelta = Math.abs(cat.delta);
  if (absDelta === 0) return 0;

  // Weight by category importance
  const weights: Record<string, number> = {
    issues: 10,
    errors: 10,
    warnings: 5,
    annotations: 3,
    candidates: 3,
    registryEntries: 2,
  };
  const weight = cat.category.startsWith('byType.')
    ? 4
    : (weights[cat.category] ?? 1);

  return absDelta * weight;
}

// ── Core function ────────────────────────────────────────────

function describeHealthTransition(health: HealthTransition): string {
  const { base, head, baseScore, headScore, scoreDelta, direction } = health;

  if (base === head && scoreDelta === 0) {
    return `Health remains ${head} at ${headScore}/100.`;
  }

  const scoreStr = `${signPrefix(scoreDelta)}${scoreDelta}`;
  if (base !== head) {
    return `Health transitioned from ${base} (${baseScore}/100) to ${head} (${headScore}/100, ${scoreStr}).`;
  }

  return `Health score ${describeDirection(scoreDelta)} from ${baseScore} to ${headScore} (${scoreStr}), remaining at ${head} level.`;
}

function generateHeadline(
  health: HealthTransition,
  significantChanges: NarrativeObservation[],
): string {
  const { direction, scoreDelta } = health;

  if (significantChanges.length === 0 && scoreDelta === 0) {
    return 'Governance state is stable — no significant changes detected.';
  }

  const directionWord =
    direction === 'improving'
      ? 'Governance health improved'
      : direction === 'declining'
        ? 'Governance health declined'
        : 'Governance health is stable';

  const changeCount = significantChanges.length;
  const changeSuffix =
    changeCount > 0
      ? ` with ${changeCount} notable metric change${changeCount > 1 ? 's' : ''}`
      : '';

  return `${directionWord}${changeSuffix}.`;
}

/**
 * Compute a governance narrative from a SnapshotDiff.
 *
 * Analyzes category deltas and health transition to produce
 * a structured narrative with headline, observations, and summary.
 */
export function computeNarrative(diff: SnapshotDiff): NarrativeResult {
  const observations: NarrativeObservation[] = [];

  for (const cat of diff.categories) {
    if (cat.delta === 0) continue;

    const label = categoryLabel(cat.category);
    const direction = describeDirection(cat.delta);
    const message = `${label} ${direction} from ${cat.base} to ${cat.head} (${signPrefix(cat.delta)}${cat.delta}).`;
    const significance = computeSignificance(cat);

    observations.push({ category: cat.category, message, significance });
  }

  // Sort by significance descending
  observations.sort((a, b) => b.significance - a.significance);

  const healthSummary = describeHealthTransition(diff.health);
  const headline = generateHeadline(diff.health, observations);

  return {
    headline,
    healthSummary,
    observations,
    baseTimestamp: diff.baseTimestamp,
    headTimestamp: diff.headTimestamp,
    diff,
  };
}
