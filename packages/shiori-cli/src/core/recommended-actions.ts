/**
 * Recommended action generation logic (EP-0185).
 *
 * Extracted from commands/pitch.ts to core/ for reuse by
 * onboard, post-onboard guidance, and future consumers.
 * Pure function -- no I/O.
 */

import type { ReportResult, TrendResult, RecommendedAction } from './types.ts';

// ── Core logic ──────────────────────────────────────────────

/**
 * Build machine-readable recommended actions from report and trend data.
 *
 * Actions are priority-ordered (1 = highest) based on governance state:
 * 1. Expired annotations → triage
 * 2. Missing-in-registry refs → update
 * 3. Untracked candidates → adopt
 * 4. Healthy score (>= 80) → CI enforcement
 * 5. No trend data → start snapshots
 * Fallback: suggest health monitoring when no other actions apply.
 */
export function buildRecommendedActions(
  reportResult: ReportResult,
  trendResult?: TrendResult,
): RecommendedAction[] {
  const actions: RecommendedAction[] = [];
  const { score } = reportResult.health;
  const { candidates } = reportResult.totals;
  const expired = reportResult.byType['expired'];
  const missing = reportResult.byType['missing-in-registry'];
  let priority = 1;

  if (expired > 0) {
    actions.push({
      action: 'triage',
      command: 'shiori triage --expired-only',
      args: ['--expired-only'],
      reason: 'Review and resolve expired annotations',
      priority: priority++,
    });
  }

  if (missing > 0) {
    actions.push({
      action: 'update',
      command: 'shiori update',
      args: [],
      reason: 'Register untracked annotations',
      priority: priority++,
    });
  }

  if (candidates > 0) {
    actions.push({
      action: 'adopt',
      command: 'shiori adopt',
      args: [],
      reason: 'Convert lint disables to tracked annotations',
      priority: priority++,
    });
  }

  if (score >= 80) {
    actions.push({
      action: 'check',
      command: 'shiori check --fail-on expired,missing-in-registry',
      args: ['--fail-on', 'expired,missing-in-registry'],
      reason: 'Enforce in CI',
      priority: priority++,
    });
  }

  if (!trendResult || trendResult.points.length === 0) {
    actions.push({
      action: 'health',
      command: 'shiori health --snapshot',
      args: ['--snapshot'],
      reason: 'Start accumulating trend data',
      priority: priority++,
    });
  }

  // Fallback: suggest monitoring when no other actions apply
  if (actions.length === 0) {
    actions.push({
      action: 'health',
      command: 'shiori health --trend',
      args: ['--trend'],
      reason: 'Monitor governance trend',
      priority: 1,
    });
  }

  return actions;
}
