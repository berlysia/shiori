import type { ShioriCandidate, Registry } from '../core/types.ts';
import type { MigrateResult } from './migrate.ts';
import { planMigration, groupActionsByFile } from './migrate.ts';
import { healthEmoji } from '../core/emoji.ts';

/** Options for adopt planning */
export interface AdoptOptions {
  /** Candidates to adopt (from scan result) */
  candidates: ShioriCandidate[];
  /** Existing registry to check for ref collisions */
  existingRegistry: Registry;
  /** Ref prefix (default: "ADOPT") */
  prefix: string;
  /** Default reason for registry entries */
  reason: string;
  /** Default kind for registry entries */
  kind: string;
}

/** Summary of adoption plan grouped by pattern */
export interface AdoptGroupSummary {
  /** Candidate pattern (e.g., 'eslint', 'stylelint') */
  pattern: string;
  /** Directive (e.g., 'disable-next-line') */
  directive: string | undefined;
  /** Number of candidates in this group */
  count: number;
}

/** Result of adoption planning */
export interface AdoptResult {
  /** Underlying migration result (actions + registry) */
  migrate: MigrateResult;
  /** Summary grouped by candidate pattern */
  groups: AdoptGroupSummary[];
  /** Total number of files affected */
  filesAffected: number;
}

/**
 * Plan adoption of untracked candidates.
 *
 * Wraps planMigration with adopt-specific defaults and provides
 * grouped summaries for preview display.
 */
export function planAdoption(options: AdoptOptions): AdoptResult {
  const { candidates, existingRegistry, prefix, reason, kind } = options;

  const migrate = planMigration({ candidates, existingRegistry, prefix });

  // Override registry entry defaults (migrate uses 'auto-migrated' / 'migration')
  for (const entry of Object.values(migrate.registry)) {
    entry.reason = reason;
    entry.kind = kind;
  }

  const groups = buildGroupSummaries(candidates);
  const byFile = groupActionsByFile(migrate.actions);

  return {
    migrate,
    groups,
    filesAffected: byFile.size,
  };
}

/**
 * Build the group key for a candidate or group summary (pattern/directive or pattern alone).
 * Used by planAdoption grouping, filterCandidatesByGroups, and wizard group selection.
 */
export function buildGroupKey(
  item: Pick<ShioriCandidate, 'pattern' | 'directive'>,
): string {
  return item.directive ? `${item.pattern}/${item.directive}` : item.pattern;
}

/**
 * Build group summaries from candidates.
 * Extracted for reuse between planAdoption and wizard flow.
 */
export function buildGroupSummaries(
  candidates: ShioriCandidate[],
): AdoptGroupSummary[] {
  const groupMap = new Map<string, AdoptGroupSummary>();
  for (const candidate of candidates) {
    const key = buildGroupKey(candidate);
    const existing = groupMap.get(key);
    if (existing) {
      existing.count++;
    } else {
      groupMap.set(key, {
        pattern: candidate.pattern,
        directive: candidate.directive,
        count: 1,
      });
    }
  }
  return [...groupMap.values()];
}

/**
 * Filter candidates by selected group keys.
 * Returns only candidates whose pattern/directive match the selected groups.
 */
export function filterCandidatesByGroups(
  candidates: ShioriCandidate[],
  selectedKeys: Set<string>,
): ShioriCandidate[] {
  return candidates.filter((c) => selectedKeys.has(buildGroupKey(c)));
}

/**
 * Build a dynamic next-step CTA based on health score.
 *
 * Thresholds follow onboarding-guidance.ts's adopt → health → triage flow:
 * - score < 60  → direct triage for critical issues
 * - score 60-89 → combined health+triage for moderate issues
 * - score >= 90 → simple health check for confirmation
 */
export function buildNextStepCTA(score: number): {
  command: string;
  message: string;
} {
  if (score < 60) {
    return {
      command: 'shiori triage',
      message:
        'Score is low — run "shiori triage" to prioritize which annotations to address first.',
    };
  }
  if (score < 90) {
    return {
      command: 'shiori health --triage',
      message:
        'Run "shiori health --triage" to see your governance score with a prioritized action list.',
    };
  }
  return {
    command: 'shiori health',
    message: 'Run "shiori health" to confirm your governance status.',
  };
}

/** Options for formatAdoptCompletionSummary */
export interface AdoptCompletionSummaryOptions {
  result: AdoptResult;
  beforeScore: number;
  afterScore: number;
}

/**
 * Format a completion summary with before/after health score and next-step CTA.
 * Called from adopt-cli.ts after successful adoption apply.
 */
export function formatAdoptCompletionSummary(
  options: AdoptCompletionSummaryOptions,
): string {
  const { result, beforeScore, afterScore } = options;
  const lines: string[] = [];

  // Score level for emoji: reuse thresholds from report.ts
  const afterLevel =
    afterScore >= 80 ? 'healthy' : afterScore >= 50 ? 'warning' : 'critical';
  const emoji = healthEmoji(afterLevel);

  const scoreDelta = afterScore - beforeScore;
  const sign = scoreDelta >= 0 ? '+' : '';

  lines.push('');
  lines.push(
    `${emoji} Governance: ${afterScore}/100 (${sign}${scoreDelta} from adoption)`,
  );
  lines.push(
    `   Adopted ${result.migrate.actions.length} annotation(s) across ${result.filesAffected} file(s)`,
  );

  // Dynamic CTA
  const cta = buildNextStepCTA(afterScore);
  lines.push('');
  lines.push(`💡 Next step: ${cta.message}`);

  return lines.join('\n');
}

/**
 * Format adoption result as a human-readable preview.
 */
export function formatAdoptPreview(result: AdoptResult): string {
  const lines: string[] = [];
  const { migrate, groups, filesAffected } = result;

  if (migrate.actions.length === 0) {
    lines.push('No candidates to adopt.');
    return lines.join('\n');
  }

  lines.push(
    `Found ${migrate.actions.length} candidate(s) across ${filesAffected} file(s).`,
  );
  lines.push('');

  // Group summary
  lines.push('By pattern:');
  for (const group of groups) {
    const label = group.directive
      ? `  ${group.pattern} / ${group.directive}`
      : `  ${group.pattern}`;
    lines.push(`${label}: ${group.count}`);
  }
  lines.push('');

  // File-by-file detail
  const byFile = groupActionsByFile(migrate.actions);
  for (const [file, actions] of byFile) {
    lines.push(`${file} (${actions.length}):`);
    for (const action of actions) {
      const rule =
        action.rules.length > 0 ? ` [${action.rules.join(', ')}]` : '';
      lines.push(`  L${action.line}: ${action.ref}${rule}`);
    }
  }

  return lines.join('\n');
}
