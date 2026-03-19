import { define } from 'gunshi';
import { readFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import fg from 'fast-glob';
import {
  aggregate,
  formatAggregate,
  type AggregateFormat,
} from './aggregate.ts';
import type { SummaryResult } from './summary.ts';
import { createFormatValidator } from '../core/cli-validation.ts';
import { writeOutput } from '../core/cli-output.ts';
import { isAtOrBelowLevel, type HealthLevel } from '../core/types.ts';

const validateAggregateFormat = createFormatValidator<AggregateFormat>(
  ['json', 'markdown', 'html'] as const,
  'json',
);

const VALID_FAIL_ON_LEVELS: readonly string[] = [
  'critical',
  'warning',
  'healthy',
];

/**
 * Runtime shape check for SummaryResult JSON.
 * Validates the minimum fields required by aggregate() without importing full schema.
 */
function isSummaryShape(value: Record<string, unknown>): boolean {
  if (typeof value.timestamp !== 'string') return false;

  const health = value.health as Record<string, unknown> | undefined;
  if (!health) return false;

  const healthInner = health.health as Record<string, unknown> | undefined;
  if (!healthInner) return false;
  if (typeof healthInner.score !== 'number') return false;
  if (typeof healthInner.level !== 'string') return false;

  const issues = health.issues as Record<string, unknown> | undefined;
  if (!issues) return false;
  if (typeof issues.total !== 'number') return false;
  if (typeof issues.errors !== 'number') return false;
  if (typeof issues.warnings !== 'number') return false;

  const expiring = health.expiring as Record<string, unknown> | undefined;
  if (!expiring) return false;
  if (typeof expiring.expired !== 'number') return false;
  if (typeof expiring.expiringSoon !== 'number') return false;

  return true;
}

export const aggregateCommand = define({
  name: 'aggregate',
  description:
    'Aggregate multiple repository summary JSONs into an organization-level governance report',
  examples: `  # Aggregate all summary JSONs in a directory
  shiori aggregate --files "reports/*.json"

  # Aggregate specific files
  shiori aggregate --files "repo-a.json,repo-b.json,repo-c.json"

  # Markdown output for dashboards
  shiori aggregate --files "reports/*.json" --format markdown

  # HTML dashboard for CI artifacts
  shiori aggregate --files "reports/*.json" --format html -o dashboard.html

  # CI gate: fail if any repository score is at or below critical
  shiori aggregate --files "reports/*.json" --fail-on-level critical`,
  rendering: { header: null },
  args: {
    files: {
      type: 'string',
      short: 'f',
      description:
        'Glob pattern or comma-separated file paths to summary JSON files (required)',
    },
    format: {
      type: 'string',
      description: 'Output format: "json", "markdown", "html". Default: "json"',
      default: 'json',
    },
    output: {
      type: 'string',
      short: 'o',
      description: 'Output file path. If omitted, writes to stdout',
    },
    failOnLevel: {
      type: 'string',
      toKebab: true,
      description:
        'Fail (exit code 1) if any repository health level is at or below this threshold: "critical", "warning", "healthy"',
    },
    cwd: {
      type: 'string',
      description: 'Working directory. Default: process.cwd()',
    },
  },
  run: async (ctx) => {
    // Validate --files (required)
    if (!ctx.values.files) {
      console.error(
        'Error: --files is required. Provide a glob pattern or comma-separated file paths.',
      );
      process.exitCode = 1;
      return;
    }

    // Validate --format
    const format = validateAggregateFormat(ctx.values.format);
    if (format === null) return;

    // Validate --fail-on-level
    const failOnLevelValue = ctx.values.failOnLevel;
    if (failOnLevelValue !== undefined) {
      if (!VALID_FAIL_ON_LEVELS.includes(failOnLevelValue)) {
        console.error(
          `Error: Invalid --fail-on-level value "${failOnLevelValue}". Valid values: ${VALID_FAIL_ON_LEVELS.join(', ')}`,
        );
        process.exitCode = 1;
        return;
      }
    }
    const failOnLevel = failOnLevelValue as HealthLevel | undefined;

    const cwd = ctx.values.cwd ? resolve(ctx.values.cwd) : process.cwd();

    // Resolve file paths: try glob first, then comma-separated
    const filesArg = ctx.values.files;
    let filePaths: string[];

    // Split comma-separated patterns and expand each via glob
    const patterns = filesArg.split(',').map((p: string) => p.trim());
    const expanded = await fg(patterns, { cwd, absolute: true });
    filePaths = expanded.sort();

    if (filePaths.length === 0) {
      console.error(
        `Error: No input files found matching "${filesArg}". Provide valid file paths or glob patterns.`,
      );
      process.exitCode = 1;
      return;
    }

    // Load and validate each file
    const inputs: Array<{
      summaryResult: SummaryResult;
      fallbackRepository: string;
    }> = [];
    for (const filePath of filePaths) {
      let content: string;
      try {
        content = await readFile(filePath, 'utf-8');
      } catch (err) {
        console.error(
          `Error: Cannot read file "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
        return;
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(content) as Record<string, unknown>;
      } catch (err) {
        console.error(
          `Error: Invalid JSON in "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
        return;
      }

      if (!isSummaryShape(parsed)) {
        console.error(
          `Error: File "${filePath}" does not contain a valid SummaryResult JSON.`,
        );
        process.exitCode = 1;
        return;
      }

      // shiori: DEV-019 reason="runtime JSON shape validated by isSummaryShape but static type requires assertion"
      const summaryResult = parsed as unknown as SummaryResult;
      const fallbackRepository = basename(filePath, '.json');

      inputs.push({ summaryResult, fallbackRepository });
    }

    // Check for duplicate repository keys
    const repoKeys = inputs.map(
      (i) => i.summaryResult.repository ?? i.fallbackRepository,
    );
    const seen = new Set<string>();
    for (const key of repoKeys) {
      if (seen.has(key)) {
        console.error(
          `Error: Duplicate repository "${key}". Each summary must have a unique repository identifier.`,
        );
        process.exitCode = 1;
        return;
      }
      seen.add(key);
    }

    // Aggregate
    const result = aggregate(inputs);

    console.error(
      `Aggregated ${result.overall.repositoryCount} repositories, average score: ${result.overall.averageScore}/100`,
    );

    // Output
    const output = formatAggregate(result, format);

    const written = await writeOutput(output, {
      outputPath: ctx.values.output,
      cwd,
      label: 'Aggregate report',
    });
    if (!written) return;

    // CI summary on stderr
    const emoji =
      result.overall.worstScore >= 80
        ? '🟢'
        : result.overall.worstScore >= 50
          ? '🟡'
          : '🔴';
    console.error(
      `${emoji} Worst: ${result.overall.worstRepository} (${result.overall.worstScore}/100) | Total issues: ${result.overall.totalIssues}`,
    );

    // --fail-on-level check: based on worst repository's level
    if (failOnLevel) {
      const worstEntry = result.repositories[0];
      if (worstEntry && isAtOrBelowLevel(worstEntry.level, failOnLevel)) {
        console.error(
          `Failing: Repository "${worstEntry.repository}" health level "${worstEntry.level}" is at or below threshold "${failOnLevel}"`,
        );
        process.exitCode = 1;
      }
    }
  },
});
