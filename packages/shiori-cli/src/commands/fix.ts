/**
 * Unified fix command — plan and execute automatable remediation actions (EP-0118).
 *
 * Bridges verify issues and health prescriptions into a single fix pipeline.
 * Pure functions for fix planning and formatting.
 * Actual execution (registry update, save) lives in fix-cli.ts to keep this module I/O-free.
 */

import type { ReportResult, VerifyIssueType } from "../core/types.ts";
import { VERIFY_ISSUE_TYPES } from "../core/types.ts";
import { ACTION_HINTS } from "../core/action-hints.ts";

// ── Types ────────────────────────────────────────────────────

/** A single automatable fix action */
export interface FixAction {
  /** Action type. Phase 1: "update" only; extensible for future actions */
  type: "update";
  /** Human-readable description of what this action does */
  description: string;
  /** Refs affected by this action */
  refs: string[];
}

/** A manual suggestion (not automatable) */
export interface ManualSuggestion {
  /** Issue type that triggers this suggestion */
  issueType: VerifyIssueType;
  /** Number of issues of this type */
  count: number;
  /** Suggested CLI command */
  command: string;
  /** Human-readable message */
  message: string;
}

/** Plan output (dry-run result) */
export interface FixPlan {
  /** Automatable actions to execute */
  actions: FixAction[];
  /** Manual suggestions (require human judgment) */
  manualSuggestions: ManualSuggestion[];
  /** Summary counts */
  summary: { automatable: number; manual: number };
}

/** Result of applying fix actions */
export interface FixApplyResult {
  /** Actions that were applied */
  applied: FixAction[];
  /** Registry changes made */
  registryChanges: { added: string[] };
  /** Health score before fix */
  scoreBefore: number;
  /** Health score after fix */
  scoreAfter: number;
}

/**
 * Issue types that are handled by automatable fix actions.
 * Manual suggestions are derived by excluding these from VERIFY_ISSUE_TYPES.
 */
const AUTOMATABLE_ISSUE_TYPES: ReadonlySet<VerifyIssueType> = new Set(["missing-in-registry"]);

// ── Manual suggestion command mapping ────────────────────────

/**
 * Build a suggested CLI command for a manual-only issue type.
 * Mirrors prescriptions.ts buildCommand but scoped to fix suggestions.
 */
function buildSuggestionCommand(issueType: VerifyIssueType): string {
  switch (issueType) {
    case "unused-in-source":
      return "shiori resolve --ref <ref>";
    case "expired":
      return "shiori triage --expired-only";
    case "expiring-soon":
      return "shiori triage";
    case "ref-status-closed":
      return "shiori resolve --closed";
    case "syntax-error":
    case "ref-format":
    case "ref-collision":
      return "shiori verify";
    case "unrouted-ref":
    case "registry-routing-mismatch":
      return "shiori doctor";
    case "missing-in-registry":
      return "shiori update";
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
  const missingCount = byType["missing-in-registry"];
  if (missingCount > 0) {
    // Collect refs with missing-in-registry issues
    const missingRefs = verifyResult.issues
      .filter((issue) => issue.type === "missing-in-registry")
      .map((issue) => issue.ref);

    // Deduplicate refs
    const uniqueRefs = [...new Set(missingRefs)];

    actions.push({
      type: "update",
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

// ── Format ───────────────────────────────────────────────────

/**
 * Format a fix plan for human-readable dry-run output.
 */
export function formatFixPlan(plan: FixPlan): string {
  const lines: string[] = [];

  if (plan.actions.length > 0) {
    lines.push("🔧 Fix Plan (dry-run):");
    for (const action of plan.actions) {
      lines.push(`  Action: ${action.type}`);
      lines.push(`  Detail: ${action.description}`);
      lines.push(`  Refs: ${action.refs.length} ref(s)`);
    }
    lines.push("");
    lines.push("  Run with --apply to execute.");
  } else {
    lines.push("No automatable fix actions available.");
  }

  if (plan.manualSuggestions.length > 0) {
    lines.push("");
    lines.push("📋 Manual actions (not automatable):");
    for (const suggestion of plan.manualSuggestions) {
      lines.push(`  - ${suggestion.command}: ${suggestion.message}`);
    }
  }

  return lines.join("\n");
}

/**
 * Format a fix plan as JSON.
 */
export function formatFixPlanJson(plan: FixPlan): string {
  return JSON.stringify(plan, null, 2);
}

/**
 * Format a fix apply result for human-readable output.
 */
export function formatFixApplyResult(result: FixApplyResult): string {
  const lines: string[] = [];
  const delta = result.scoreAfter - result.scoreBefore;
  const sign = delta >= 0 ? "+" : "";

  lines.push("✅ Fix applied:");
  for (const action of result.applied) {
    lines.push(`  ${action.type}: ${action.description}`);
  }
  lines.push(`  Score: ${result.scoreBefore} → ${result.scoreAfter} (${sign}${delta})`);

  if (result.registryChanges.added.length > 0) {
    lines.push(`  Added refs: ${result.registryChanges.added.join(", ")}`);
  }

  return lines.join("\n");
}

/**
 * Format a fix apply result as JSON.
 */
export function formatFixApplyResultJson(result: FixApplyResult): string {
  return JSON.stringify(result, null, 2);
}
