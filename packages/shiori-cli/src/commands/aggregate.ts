import type {
  AggregateFormat,
  AggregateRepositoryEntry,
  AggregateResult,
} from '../core/types.ts';
import { healthEmoji } from '../core/emoji.ts';
import type { SummaryResult } from './summary.ts';

export type { AggregateFormat, AggregateResult };

// ── Types ────────────────────────────────────────────────────

/** A single input to the aggregate function */
export interface AggregateInput {
  /** Parsed SummaryResult from a JSON file */
  summaryResult: SummaryResult;
  /** Fallback repository name when summaryResult.repository is undefined (typically the filename without extension) */
  fallbackRepository: string;
}

// ── Main function ────────────────────────────────────────────

/**
 * Aggregate multiple repository summaries into an organization-level report.
 *
 * Pure function — no I/O. Expects at least one input (caller must validate).
 * Repository keys are derived from summaryResult.repository ?? fallbackRepository.
 */
export function aggregate(inputs: AggregateInput[]): AggregateResult {
  if (inputs.length === 0) {
    throw new Error(
      'aggregate() requires at least one input. Caller must validate that inputs is non-empty.',
    );
  }

  const repositories: AggregateRepositoryEntry[] = inputs.map((input) => {
    const { summaryResult, fallbackRepository } = input;
    const { health } = summaryResult;

    return {
      repository: summaryResult.repository ?? fallbackRepository,
      score: health.health.score,
      level: health.health.level,
      issues: {
        total: health.issues.total,
        errors: health.issues.errors,
        warnings: health.issues.warnings,
      },
      expired: health.expiring.expired,
      expiringSoon: health.expiring.expiringSoon,
    };
  });

  // Sort: score ascending (worst first), then repository name for determinism
  repositories.sort(
    (a, b) => a.score - b.score || a.repository.localeCompare(b.repository),
  );

  // Overall metrics
  const repositoryCount = repositories.length;
  const averageScore = Math.round(
    repositories.reduce((sum, r) => sum + r.score, 0) / repositoryCount,
  );

  // Worst repository: first element after sort (lowest score, lexicographically smallest on tie)
  const worstRepository = repositories[0]!.repository;
  const worstScore = repositories[0]!.score;

  const totalIssues = repositories.reduce((sum, r) => sum + r.issues.total, 0);
  const totalErrors = repositories.reduce((sum, r) => sum + r.issues.errors, 0);
  const totalWarnings = repositories.reduce(
    (sum, r) => sum + r.issues.warnings,
    0,
  );

  return {
    timestamp: new Date().toISOString(),
    repositories,
    overall: {
      repositoryCount,
      averageScore,
      worstRepository,
      worstScore,
      totalIssues,
      totalErrors,
      totalWarnings,
    },
  };
}

// ── Formatters ───────────────────────────────────────────────

/**
 * Format AggregateResult as a Markdown table for human consumption.
 */
export function formatAggregateAsMarkdown(result: AggregateResult): string {
  const lines: string[] = [];

  lines.push('## Shiori Organization Governance Report');
  lines.push('');

  // Repository table
  lines.push('### Repositories');
  lines.push('');
  lines.push(
    '| Repository | Score | Level | Issues | Errors | Warnings | Expired | Expiring |',
  );
  lines.push(
    '|------------|-------|-------|--------|--------|----------|---------|----------|',
  );

  for (const repo of result.repositories) {
    const emoji = healthEmoji(repo.level);
    lines.push(
      `| ${repo.repository} | ${emoji} ${repo.score} | ${repo.level} | ${repo.issues.total} | ${repo.issues.errors} | ${repo.issues.warnings} | ${repo.expired} | ${repo.expiringSoon} |`,
    );
  }
  lines.push('');

  // Overall summary
  lines.push('### Overall');
  lines.push('');
  lines.push(`- **Repositories:** ${result.overall.repositoryCount}`);
  lines.push(`- **Average Score:** ${result.overall.averageScore}/100`);
  lines.push(
    `- **Worst:** ${result.overall.worstRepository} (${result.overall.worstScore}/100)`,
  );
  lines.push(
    `- **Total Issues:** ${result.overall.totalIssues} (${result.overall.totalErrors} errors, ${result.overall.totalWarnings} warnings)`,
  );
  lines.push('');

  return lines.join('\n');
}
