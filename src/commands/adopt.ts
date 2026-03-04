import type { ShioriCandidate, Registry } from '../core/types.ts';
import type { MigrateResult } from './migrate.ts';
import { planMigration, groupActionsByFile } from './migrate.ts';

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

  // Build group summaries
  const groupMap = new Map<string, AdoptGroupSummary>();
  for (const candidate of candidates) {
    const key = candidate.directive
      ? `${candidate.pattern}/${candidate.directive}`
      : candidate.pattern;
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

  const byFile = groupActionsByFile(migrate.actions);

  return {
    migrate,
    groups: [...groupMap.values()],
    filesAffected: byFile.size,
  };
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
