/**
 * Unified fix command — plan and execute automatable remediation actions (EP-0118).
 *
 * Bridges verify issues and health prescriptions into a single fix pipeline.
 * Pure functions for fix planning.
 * Formatters live in formatters/fix-formatter.ts (EP-0126).
 * Actual execution (registry update, save) lives in fix-cli.ts to keep this module I/O-free.
 */

import type {
  ReportResult,
  VerifyIssueType,
  FixAction,
  ManualSuggestion,
  FixPlan,
} from '../core/types.ts';
import { VERIFY_ISSUE_TYPES } from '../core/types.ts';
import { ACTION_HINTS } from '../core/action-hints.ts';

// Re-export fix types from core for backward compatibility
export type {
  FixAction,
  ManualSuggestion,
  FixPlan,
  FixApplyResult,
} from '../core/types.ts';

/**
 * Issue types that are handled by automatable fix actions.
 * Manual suggestions are derived by excluding these from VERIFY_ISSUE_TYPES.
 *
 * Related: health-fix.ts defines AUTOMATABLE_ACTIONS (PrescriptionActionType level).
 * Both express "what can be auto-fixed" at different abstraction layers.
 * EP-0118 Phase 2 should unify these into a single automatability definition.
 */
const AUTOMATABLE_ISSUE_TYPES: ReadonlySet<VerifyIssueType> = new Set([
  'missing-in-registry',
]);

// ── Manual suggestion command mapping ────────────────────────

/**
 * Build a suggested CLI command for a manual-only issue type.
 * Mirrors prescriptions.ts buildCommand but scoped to fix suggestions.
 */
function buildSuggestionCommand(issueType: VerifyIssueType): string {
  switch (issueType) {
    case 'unused-in-source':
      return 'shiori resolve --ref <ref>';
    case 'expired':
      return 'shiori triage --expired-only';
    case 'expiring-soon':
      return 'shiori triage';
    case 'ref-status-closed':
      return 'shiori resolve --closed';
    case 'syntax-error':
    case 'ref-format':
    case 'ref-collision':
      return 'shiori verify';
    case 'unrouted-ref':
    case 'registry-routing-mismatch':
      return 'shiori doctor';
    case 'missing-in-registry':
      return 'shiori update';
  }
}

// ── Plan ─────────────────────────────────────────────────────

/**
 * Plan fix actions from a ReportResult.
 *
 * Examines verify issues and generates:
 * 1. Automatable actions (currently: update for missing-in-registry)
 * 2. Manual suggestions for everything else
 *
 * Pure function — no I/O.
 */
export function planFixActions(reportResult: ReportResult): FixPlan {
  const { byType, verifyResult } = reportResult;
  const actions: FixAction[] = [];
  const manualSuggestions: ManualSuggestion[] = [];

  // Check for missing-in-registry issues (automatable via update)
  const missingCount = byType['missing-in-registry'];
  if (missingCount > 0) {
    // Collect refs with missing-in-registry issues
    const missingRefs = verifyResult.issues
      .filter((issue) => issue.type === 'missing-in-registry')
      .map((issue) => issue.ref);

    // Deduplicate refs
    const uniqueRefs = [...new Set(missingRefs)];

    actions.push({
      type: 'update',
      description: `Add ${uniqueRefs.length} missing ref(s) to registry`,
      refs: uniqueRefs,
    });
  }

  // Build manual suggestions for non-automatable issue types.
  // Derived from VERIFY_ISSUE_TYPES minus AUTOMATABLE_ISSUE_TYPES so that
  // newly added issue types are never silently ignored.
  for (const issueType of VERIFY_ISSUE_TYPES) {
    if (AUTOMATABLE_ISSUE_TYPES.has(issueType)) continue;
    const count = byType[issueType];
    if (count === 0) continue;

    manualSuggestions.push({
      issueType,
      count,
      command: buildSuggestionCommand(issueType),
      message: `${count} ${issueType} issue(s): ${ACTION_HINTS[issueType]}`,
    });
  }

  return {
    actions,
    manualSuggestions,
    summary: {
      automatable: actions.length,
      manual: manualSuggestions.length,
    },
  };
}
