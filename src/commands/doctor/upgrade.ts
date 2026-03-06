/**
 * Upgrade wizard logic for `shiori doctor --upgrade`.
 *
 * Generates executable upgrade steps based on current maturity level
 * and missing signals. Each step maps to an init-steps function or
 * a CLI template generator that can be invoked programmatically.
 *
 * Pure functions — no I/O or console output.
 */

import type {
  MaturityLevel,
  MaturityResult,
  MaturitySignal,
} from '../../core/types.ts';
import type { CiTemplateKind } from '../init-ci-templates.ts';

// ── Types ────────────────────────────────────────────────────

/** Kind of upgrade action that maps to an executable operation */
export type UpgradeActionKind =
  | 'init'
  | 'ci-workflow'
  | 'badge-workflow'
  | 'snapshot-setup'
  | 'scheduled-workflow';

/** Badge workflow mode: artifacts-only (no secrets) or gist (requires PAT + Gist ID) */
export type BadgeMode = 'artifacts' | 'gist';

/** A concrete upgrade step the wizard can execute */
export interface UpgradeAction {
  /** Action identifier */
  kind: UpgradeActionKind;
  /** Target maturity level this action contributes to */
  targetLevel: MaturityLevel;
  /** Human-readable title */
  title: string;
  /** Detailed description of what this action does */
  description: string;
  /** CLI command equivalent (for display and --yes mode logging) */
  command: string;
  /** CI template kind (only for ci-workflow / badge-workflow actions) */
  ciTemplateKind?: CiTemplateKind;
  /** Badge mode (only for badge-workflow actions) */
  badgeMode?: BadgeMode;
}

/** Result of upgrade plan generation */
export interface UpgradePlan {
  /** Current maturity level */
  currentLevel: MaturityLevel;
  /** Target maturity level after all actions */
  targetLevel: MaturityLevel;
  /** Ordered list of upgrade actions */
  actions: UpgradeAction[];
}

/** Result of a single action execution */
export interface UpgradeActionResult {
  kind: UpgradeActionKind;
  /** Whether the action was executed (false = skipped/already done) */
  executed: boolean;
  /** Human-readable status message */
  message: string;
}

/** Overall upgrade execution result */
export interface UpgradeResult {
  /** The plan that was executed */
  plan: UpgradePlan;
  /** Results for each action */
  actionResults: UpgradeActionResult[];
  /** Maturity level after upgrade (re-assessed) */
  newLevel: MaturityLevel;
}

// ── Plan generation ──────────────────────────────────────────

/** Options for building an upgrade plan */
export interface BuildUpgradePlanOptions {
  /** Badge mode for Level 2→3 upgrade. Default: 'artifacts' (no secrets needed) */
  badgeMode?: BadgeMode;
}

/**
 * Build an upgrade plan based on current maturity assessment.
 *
 * Only includes actions for the NEXT level (incremental upgrade).
 * Users run `--upgrade` repeatedly to climb levels progressively.
 */
export function buildUpgradePlan(
  maturity: MaturityResult,
  options?: BuildUpgradePlanOptions,
): UpgradePlan {
  const currentLevel = maturity.level;
  const actions: UpgradeAction[] = [];
  const badgeMode = options?.badgeMode ?? 'artifacts';

  const has = (name: string): boolean =>
    maturity.signals.some((s) => s.name === name && s.detected);

  if (currentLevel < 1) {
    // Level 0 → 1: Basic setup via shiori init
    actions.push({
      kind: 'init',
      targetLevel: 1,
      title: 'Initialize shiori',
      description:
        'Create config, scan source files, generate registry, and update .gitignore',
      command: 'shiori init',
    });
  } else if (currentLevel < 2) {
    // Level 1 → 2: Add CI workflow
    actions.push({
      kind: 'ci-workflow',
      targetLevel: 2,
      title: 'Add CI governance check',
      description:
        'Generate a GitHub Actions workflow that runs shiori check on every push and PR',
      command: 'shiori init --ci basic',
      ciTemplateKind: 'basic',
    });
  } else if (currentLevel < 3) {
    // Level 2 → 3: Add badge workflow (artifacts-only or gist)
    const ciTemplateKind: CiTemplateKind =
      badgeMode === 'gist' ? 'badge-gist' : 'badge';
    actions.push({
      kind: 'badge-workflow',
      targetLevel: 3,
      title:
        badgeMode === 'gist'
          ? 'Add governance badge (Gist mode)'
          : 'Add governance badge (Artifacts-only)',
      description:
        badgeMode === 'gist'
          ? 'Generate a badge workflow that uploads governance score to GitHub Gist for stable badge URL'
          : 'Generate a badge workflow using GitHub Actions Artifacts (no secrets required)',
      command: `shiori init --ci ${ciTemplateKind}`,
      ciTemplateKind,
      badgeMode,
    });
  } else if (currentLevel < 4) {
    // Level 3 → 4: Snapshot history + scheduled workflow
    if (!has('snapshot-history')) {
      actions.push({
        kind: 'snapshot-setup',
        targetLevel: 4,
        title: 'Enable snapshot history',
        description:
          'Create a snapshots directory and take the first health snapshot for trend analysis',
        command: 'shiori health --snapshot .config/shiori/snapshots',
      });
    }
    if (!has('scheduled-workflow')) {
      actions.push({
        kind: 'scheduled-workflow',
        targetLevel: 4,
        title: 'Add scheduled monitoring',
        description:
          'Generate a scheduled GitHub Actions workflow for continuous governance monitoring',
        command: 'Add cron trigger to .github/workflows/',
      });
    }
  }

  const targetLevel =
    actions.length > 0
      ? actions[actions.length - 1]!.targetLevel
      : currentLevel;

  return { currentLevel, targetLevel, actions };
}

// ── Formatting ───────────────────────────────────────────────

/** Format the upgrade plan as human-readable text for interactive display */
export function formatUpgradePlan(plan: UpgradePlan): string {
  const lines: string[] = [];

  if (plan.actions.length === 0) {
    lines.push(
      `Governance Maturity: Level ${plan.currentLevel}/4 — already at maximum!`,
    );
    lines.push('');
    lines.push('No upgrade actions needed.');
    return lines.join('\n');
  }

  lines.push(
    `Governance Maturity: Level ${plan.currentLevel}/4 → Level ${plan.targetLevel}/4`,
  );
  lines.push('');
  lines.push('Upgrade actions:');

  for (let i = 0; i < plan.actions.length; i++) {
    const action = plan.actions[i]!;
    lines.push(`  ${i + 1}. ${action.title}`);
    lines.push(`     ${action.description}`);
    lines.push(`     Command: ${action.command}`);
  }

  return lines.join('\n');
}

/** Format the upgrade result as human-readable text */
export function formatUpgradeResult(result: UpgradeResult): string {
  const lines: string[] = [];

  lines.push('Upgrade complete:');
  for (const ar of result.actionResults) {
    const icon = ar.executed ? '✓' : '·';
    lines.push(`  ${icon} ${ar.message}`);
  }

  lines.push('');
  lines.push(
    `Governance Maturity: Level ${result.plan.currentLevel}/4 → Level ${result.newLevel}/4`,
  );

  if (result.newLevel < 4) {
    lines.push('');
    lines.push(`Run "shiori doctor --upgrade" again to reach the next level.`);
  }

  return lines.join('\n');
}
