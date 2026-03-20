/**
 * Health fix bridge — plan and execute automatable prescription actions (EP-0112).
 *
 * Pure functions for fix planning and formatting.
 * The actual execution (registry update) lives in the CLI layer (health-cli.ts)
 * to keep this module I/O-free.
 */

import type { HealthPrescription, PrescriptionActionType } from "../core/types.ts";

// ── Types ────────────────────────────────────────────────────

/** Preview of what a fix will do (dry-run output) */
export interface FixPreview {
  /** The prescription being fixed */
  target: HealthPrescription;
  /** Whether this action can be executed automatically */
  automatable: boolean;
  /** Human-readable description of what will happen */
  description: string;
  /** Non-automatable prescriptions shown as suggestions */
  manualPrescriptions: HealthPrescription[];
}

/** Result of applying a fix */
export interface HealthFixApplyResult {
  /** Whether the fix succeeded */
  success: boolean;
  /** Which action type was executed */
  action: PrescriptionActionType;
  /** Human-readable description of what happened */
  description: string;
  /** Health score before fix */
  beforeScore: number;
  /** Health score after fix */
  afterScore: number;
  /** Score change (afterScore - beforeScore) */
  scoreDelta: number;
}

// ── Plan ─────────────────────────────────────────────────────

/**
 * Action types that can be executed without human judgment.
 *
 * Related: fix.ts defines AUTOMATABLE_ISSUE_TYPES (VerifyIssueType level).
 * Both express "what can be auto-fixed" at different abstraction layers.
 * EP-0118 Phase 2 should unify these into a single automatability definition.
 */
const AUTOMATABLE_ACTIONS: ReadonlySet<PrescriptionActionType> = new Set(["update"]);

/**
 * Find the first automatable prescription and build a fix preview.
 * Returns null when no automatable action exists.
 */
export function planFix(prescriptions: HealthPrescription[]): FixPreview | null {
  const automatable = prescriptions.find((p) => AUTOMATABLE_ACTIONS.has(p.actionType));

  if (!automatable) return null;

  const manualPrescriptions = prescriptions.filter((p) => !AUTOMATABLE_ACTIONS.has(p.actionType));

  return {
    target: automatable,
    automatable: true,
    description: `Auto-fix: ${automatable.command} (${automatable.message})`,
    manualPrescriptions,
  };
}

// ── Format ───────────────────────────────────────────────────

/**
 * Format a fix preview for human-readable dry-run output.
 */
export function formatFixPreview(preview: FixPreview): string {
  const lines: string[] = [];
  lines.push("🔧 Fix Preview (dry-run):");
  lines.push(`  Action: ${preview.target.command}`);
  lines.push(`  Impact: +${preview.target.scoreImpact}pt estimated`);
  lines.push(`  Detail: ${preview.target.message}`);
  lines.push("");
  lines.push("  Run with --fix --apply to execute.");

  if (preview.manualPrescriptions.length > 0) {
    lines.push("");
    lines.push("📋 Manual actions (not automatable):");
    for (const rx of preview.manualPrescriptions) {
      lines.push(`  - ${rx.command}: ${rx.message}`);
    }
  }

  return lines.join("\n");
}

/**
 * Format a fix result for human-readable output after apply.
 */
export function formatFixResult(result: HealthFixApplyResult): string {
  const lines: string[] = [];

  if (result.success) {
    const sign = result.scoreDelta >= 0 ? "+" : "";
    lines.push("✅ Fix applied:");
    lines.push(`  ${result.description}`);
    lines.push(
      `  Score: ${result.beforeScore} → ${result.afterScore} (${sign}${result.scoreDelta})`,
    );
  } else {
    lines.push("❌ Fix failed:");
    lines.push(`  ${result.description}`);
  }

  return lines.join("\n");
}
