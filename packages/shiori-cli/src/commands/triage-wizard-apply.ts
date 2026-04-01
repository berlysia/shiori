/**
 * Wizard apply logic for triage --wizard (EP-0157).
 *
 * Pure functions that plan, preview, and summarize wizard action execution.
 * The actual file I/O and registry save are performed by triage-cli.ts.
 */

import type { Registry, ScanResult, HealthLevel } from '../core/types.ts';
import type { WizardItemResult } from './triage-interactive.ts';
import {
  planBulkResolve,
  formatBulkResolvePreview,
  type BulkResolveResult,
} from './resolve.ts';
import { healthEmoji } from '../core/emoji.ts';

// ── Types ────────────────────────────────────────────────────

/** A planned expires extension for a single ref */
export interface WizardExtendEntry {
  ref: string;
  oldExpires: string;
  newExpires: string;
}

/** Result of planning wizard actions */
export interface WizardApplyPlan {
  /** Bulk resolve result for all refs marked for resolve */
  resolves: BulkResolveResult;
  /** Expires extensions for refs marked for extend */
  extends: WizardExtendEntry[];
  /** Registry state after applying all planned changes */
  registryAfter: Registry;
  /** Summary counts */
  summary: {
    resolveCount: number;
    extendCount: number;
    /** Items where user chose "act" but no executable action (non-actionable issue types) */
    manualCount: number;
  };
}

/** Options for planning wizard actions */
export interface WizardApplyOptions {
  /** Processed items from wizard session */
  processed: WizardItemResult[];
  /** Scan result for annotation lookup */
  scanResult: ScanResult;
  /** Current registry */
  registry: Registry;
  /** Pre-loaded file contents (relative path → content) */
  fileContents: Map<string, string>;
}

/** Options for formatting the completion summary */
export interface WizardCompletionSummaryOptions {
  beforeScore: number;
  afterScore: number;
  resolveCount: number;
  extendCount: number;
  /** Items that require manual follow-up (non-actionable "act" choices) */
  manualCount: number;
}

// ── Plan ─────────────────────────────────────────────────────

/**
 * Plan all wizard actions based on session results.
 *
 * Pure function — no I/O. Separates processed items into resolve and extend
 * buckets, plans bulk resolve via planBulkResolve(), and computes the
 * post-apply registry state.
 */
export function planWizardActions(
  options: WizardApplyOptions,
): WizardApplyPlan {
  const { processed, scanResult, registry, fileContents } = options;

  // Partition processed items by action type
  const resolveRefs: string[] = [];
  const extendEntries: WizardExtendEntry[] = [];
  let manualCount = 0;

  for (const item of processed) {
    if (item.choice !== 'act') continue;

    if (item.actionType === 'resolve') {
      resolveRefs.push(item.ref);
    } else if (item.actionType === 'extend' && item.newExpires) {
      const entry = registry[item.ref];
      if (entry?.expires) {
        extendEntries.push({
          ref: item.ref,
          oldExpires: entry.expires,
          newExpires: item.newExpires,
        });
      }
    } else {
      // "act" without actionType = non-actionable (informational marker)
      manualCount++;
    }
  }

  // Plan bulk resolve
  const resolves = planBulkResolve(resolveRefs, {
    annotations: scanResult.annotations,
    registry,
    fileContents,
  });

  // Build post-apply registry
  const registryAfter = { ...registry };

  // Remove resolved refs from registry
  for (const ref of resolves.allRegistryRemovals) {
    delete registryAfter[ref];
  }

  // Apply extends to registry
  for (const ext of extendEntries) {
    const entry = registryAfter[ext.ref];
    if (entry) {
      registryAfter[ext.ref] = { ...entry, expires: ext.newExpires };
    }
  }

  return {
    resolves,
    extends: extendEntries,
    registryAfter,
    summary: {
      resolveCount: resolveRefs.length,
      extendCount: extendEntries.length,
      manualCount,
    },
  };
}

// ── Format ───────────────────────────────────────────────────

/**
 * Format a dry-run preview of planned wizard actions.
 */
export function formatWizardApplyPreview(plan: WizardApplyPlan): string {
  const lines: string[] = [];
  const { resolves, extends: extendEntries, summary } = plan;

  const hasResolves =
    resolves.allActions.length > 0 || resolves.allRegistryRemovals.length > 0;
  const hasExtends = extendEntries.length > 0;

  if (!hasResolves && !hasExtends) {
    lines.push('No executable actions planned.');
    if (summary.manualCount > 0) {
      lines.push(`${summary.manualCount} item(s) require manual follow-up.`);
    }
    return lines.join('\n');
  }

  lines.push('--- Wizard Apply Preview ---');
  lines.push('');

  // Resolve section
  if (hasResolves) {
    lines.push(`Resolve (${summary.resolveCount} ref(s)):`);
    lines.push(formatBulkResolvePreview(resolves));
    lines.push('');
  }

  // Extend section
  if (hasExtends) {
    lines.push(`Extend expires (${summary.extendCount} ref(s)):`);
    for (const ext of extendEntries) {
      lines.push(`  ${ext.ref}: ${ext.oldExpires} → ${ext.newExpires}`);
    }
    lines.push('');
  }

  // Manual follow-up
  if (summary.manualCount > 0) {
    lines.push(`${summary.manualCount} item(s) require manual follow-up.`);
    lines.push('');
  }

  lines.push('--- End Preview ---');

  return lines.join('\n');
}

/**
 * Format a completion summary with before/after health score and action counts.
 */
export function formatWizardCompletionSummary(
  options: WizardCompletionSummaryOptions,
): string {
  const { beforeScore, afterScore, resolveCount, extendCount, manualCount } =
    options;

  const lines: string[] = [];

  const afterLevel: HealthLevel =
    afterScore >= 80 ? 'healthy' : afterScore >= 50 ? 'warning' : 'critical';
  const emoji = healthEmoji(afterLevel);

  const scoreDelta = afterScore - beforeScore;
  const sign = scoreDelta >= 0 ? '+' : '';

  lines.push('');
  lines.push(
    `${emoji} Governance: ${afterScore}/100 (${sign}${scoreDelta} from triage wizard)`,
  );

  const actionParts: string[] = [];
  if (resolveCount > 0) actionParts.push(`Resolved: ${resolveCount}`);
  if (extendCount > 0) actionParts.push(`Extended: ${extendCount}`);
  if (manualCount > 0) actionParts.push(`Manual follow-up: ${manualCount}`);
  if (actionParts.length > 0) {
    lines.push(`   ${actionParts.join(', ')}`);
  }

  return lines.join('\n');
}
