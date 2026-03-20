import type { FixPlan, FixApplyResult } from "../core/types.ts";

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
 * Format a fix plan as GitHub-flavored markdown for PR comments (EP-0121).
 * Wraps content in a collapsed `<details>` block to minimize noise.
 * Returns empty string when there are no actions and no suggestions,
 * so the caller can skip rendering the section entirely.
 */
export function formatFixPlanMarkdown(plan: FixPlan): string {
  const hasActions = plan.actions.length > 0;
  const hasSuggestions = plan.manualSuggestions.length > 0;

  if (!hasActions && !hasSuggestions) {
    return "";
  }

  const lines: string[] = [];

  lines.push("<details>");
  lines.push("<summary>🔧 Fix Preview</summary>");
  lines.push("");

  if (hasActions) {
    lines.push("#### Automatable Fixes");
    lines.push("");
    lines.push("| Action | Description | Refs |");
    lines.push("|--------|-------------|------|");
    for (const action of plan.actions) {
      lines.push(`| ${action.type} | ${action.description} | ${action.refs.length} |`);
    }
    lines.push("");
    lines.push("Run `shiori fix --apply` to execute these fixes.");
  }

  if (hasSuggestions) {
    if (hasActions) {
      lines.push("");
    }
    lines.push("#### Manual Actions Required");
    lines.push("");
    for (const suggestion of plan.manualSuggestions) {
      lines.push(`- \`${suggestion.command}\`: ${suggestion.message}`);
    }
  }

  lines.push("");
  lines.push("</details>");

  return lines.join("\n");
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
