import { define } from 'gunshi';
import { scan } from './scan.ts';
import { CommentProvider } from '../core/providers/CommentProvider.ts';
import { report } from './report.ts';
import { computeTrend } from './trend.ts';
import {
  buildHealthResult,
  formatHealth,
  formatHealthSummary,
  type HealthFormat,
} from './health.ts';
import { triage, formatTriageOutput, type TriageFormat } from './triage.ts';
import {
  parseAndValidateIssueTypes,
  createFormatValidator,
} from '../core/cli-validation.ts';
import { saveSnapshot, loadSnapshots } from '../core/snapshot.ts';
import { writeOutput } from '../core/cli-output.ts';
import type { HealthLevel } from '../core/types.ts';
import {
  createBaseContext,
  withRegistry,
  resolveScanPatterns,
  resolveExpiringThreshold,
} from '../core/cli-context.ts';

const validateHealthFormat = createFormatValidator<HealthFormat>(
  ['json', 'summary'] as const,
  'summary',
);

const VALID_FAIL_ON_LEVELS: readonly string[] = [
  'critical',
  'warning',
  'healthy',
];

export const healthCommand = define({
  name: 'health',
  description:
    'Show a quick governance health summary (score, expiring-soon, trend)',
  examples: `  # Quick health check
  shiori health

  # JSON output for CI integration
  shiori health -f json

  # Fail CI if health is critical
  shiori health --fail-on-level critical

  # Include trend from historical reports
  shiori health --history ./reports/

  # Save current report as snapshot for later trend analysis
  shiori health --snapshot ./reports/

  # Combine fail-on issue types and fail-on-level (OR evaluation)
  shiori health --fail-on expired --fail-on-level critical

  # Show health + triage action list together
  shiori health --triage

  # Health + triage with markdown output
  shiori health --triage --triage-format markdown`,
  rendering: { header: null },
  args: {
    patterns: {
      type: 'string',
      short: 'p',
      description:
        'Glob patterns to scan (comma-separated). Default: "**/*.{css,scss,pcss,js,ts,tsx,jsx}"',
    },
    ignore: {
      type: 'string',
      short: 'i',
      description:
        'Patterns to ignore (comma-separated). Default: "**/node_modules/**,**/dist/**,**/.git/**"',
    },
    registry: {
      type: 'string',
      short: 'r',
      description:
        'Path to registry file (auto-detected from config or .config/shiori/registry.json)',
    },
    failOn: {
      type: 'string',
      toKebab: true,
      description:
        'Issue types to fail on (comma-separated). Example: "expired,missing-in-registry"',
    },
    warnOn: {
      type: 'string',
      toKebab: true,
      description:
        'Issue types to warn on (comma-separated). Example: "unused-in-source"',
    },
    failOnLevel: {
      type: 'string',
      toKebab: true,
      description:
        'Fail (exit code 1) if health level is at or below this threshold: "critical", "warning", "healthy". Evaluated OR with --fail-on.',
    },
    format: {
      type: 'string',
      short: 'f',
      description: 'Output format: "json", "summary". Default: "summary"',
      default: 'summary',
    },
    output: {
      type: 'string',
      short: 'o',
      description: 'Output file path. If omitted, writes to stdout',
    },
    history: {
      type: 'string',
      short: 'H',
      description:
        'Directory containing ReportResult JSON files for trend analysis',
    },
    snapshot: {
      type: 'string',
      short: 's',
      description:
        'Directory to save the current ReportResult JSON for future trend analysis',
    },
    cwd: {
      type: 'string',
      description: 'Working directory. Default: process.cwd()',
    },
    config: {
      type: 'string',
      short: 'c',
      description:
        'Path to config directory (YAML/JSON auto-detected). Default: <cwd>/.config/shiori',
    },
    expiringThreshold: {
      type: 'string',
      toKebab: true,
      description:
        'Days before expiration to trigger expiring-soon warning. Overrides config. Default: 14',
    },
    triage: {
      type: 'boolean',
      short: 't',
      description:
        'Also run triage and append a prioritized action list after health output',
    },
    triageFormat: {
      type: 'string',
      toKebab: true,
      description:
        'Output format for triage section: "json", "markdown". Default: "markdown" (for summary) or "json" (for json)',
    },
  },
  run: async (ctx) => {
    // Validate options early
    const failOn = parseAndValidateIssueTypes(ctx.values.failOn, '--fail-on');
    if (failOn === null) return;
    const warnOn = parseAndValidateIssueTypes(ctx.values.warnOn, '--warn-on');
    if (warnOn === null) return;

    const format = validateHealthFormat(ctx.values.format);
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

    const base = createBaseContext(ctx.values.cwd);
    const regCtx = await withRegistry(base, {
      configDir: ctx.values.config,
      registryPath: ctx.values.registry,
    });

    const { patterns, ignore } = resolveScanPatterns(
      ctx.values.patterns,
      ctx.values.ignore,
      regCtx.config,
    );

    // Scan
    const provider = new CommentProvider();
    const scanResult = await scan({
      patterns,
      ignore,
      provider,
      cwd: base.cwd,
      providerOptions: { candidatePatterns: regCtx.config.candidatePatterns },
    });

    console.error(
      `Scanned ${scanResult.filesScanned} files, found ${scanResult.annotations.length} annotation(s), ${scanResult.candidates.length} candidate(s)`,
    );

    // Generate report (health composes this)
    const expiringThresholdDays = resolveExpiringThreshold(
      ctx.values.expiringThreshold,
      regCtx.config,
    );

    const reportResult = report({
      scanResult,
      registry: regCtx.registry,
      failOn,
      warnOn,
      duplicates: regCtx.duplicates,
      refPatterns: regCtx.config.refPatterns,
      refOrigins: regCtx.refOrigins,
      expiringThresholdDays,
    });

    // Save snapshot if requested
    if (ctx.values.snapshot) {
      const result = await saveSnapshot(
        reportResult,
        ctx.values.snapshot,
        base.cwd,
      );
      if (!result.ok) {
        console.error(`Error: ${result.error}`);
        process.exitCode = 1;
        return;
      }
      console.error(`Snapshot saved to ${result.path}`);
    }

    // Load trend data if --history is provided
    let trendResult = undefined;
    if (ctx.values.history) {
      const reports = await loadSnapshots(ctx.values.history, base.cwd, {
        onDirectoryError: (msg) => console.error(`Warning: ${msg}`),
        onNoFiles: (dir) =>
          console.error(`Warning: No JSON files found in ${dir}`),
        onLoaded: (count, dir) =>
          console.error(`Loaded ${count} report(s) from ${dir}`),
      });
      if (reports !== null) {
        trendResult = computeTrend(reports);
      }
    }

    // Build health result
    const result = buildHealthResult(reportResult, trendResult);

    // Output
    const output = formatHealth(result, format);

    const written = await writeOutput(output, {
      outputPath: ctx.values.output,
      cwd: base.cwd,
      label: 'Health report',
    });
    if (!written) return;

    // Always show summary box on stderr (for CI visibility)
    if (format !== 'summary') {
      console.error(formatHealthSummary(result));
    }

    // --triage: run triage reusing the same scanResult (no duplicate scan)
    if (ctx.values.triage) {
      const triageFormat: TriageFormat =
        (ctx.values.triageFormat as TriageFormat) ??
        (format === 'json' ? 'json' : 'markdown');

      const triageResult = triage({
        scanResult,
        registry: regCtx.registry,
        failOn,
        warnOn,
        duplicates: regCtx.duplicates,
        refPatterns: regCtx.config.refPatterns,
        refOrigins: regCtx.refOrigins,
        expiringThresholdDays,
      });

      const triageOutput = formatTriageOutput(triageResult, triageFormat);

      // Separator between health and triage output
      console.log('');
      console.log(triageOutput);

      console.error(
        `Triage: ${triageResult.summary.total} item(s) — critical: ${triageResult.summary.byPriority.critical}, high: ${triageResult.summary.byPriority.high}, medium: ${triageResult.summary.byPriority.medium}, low: ${triageResult.summary.byPriority.low}`,
      );
    }

    // Exit code: --fail-on (errors > 0) OR --fail-on-level
    const hasIssueFailure = reportResult.verifyResult.summary.errors > 0;
    const hasLevelFailure = failOnLevel
      ? isAtOrBelowLevel(result.health.level, failOnLevel)
      : false;

    if (hasIssueFailure || hasLevelFailure) {
      process.exitCode = 1;
    }
  },
});

/**
 * Check if actual level is at or below the threshold level.
 * Level ordering: critical < warning < healthy
 */
export function isAtOrBelowLevel(
  actual: HealthLevel,
  threshold: HealthLevel,
): boolean {
  const levelOrder: Record<HealthLevel, number> = {
    critical: 0,
    warning: 1,
    healthy: 2,
  };
  return levelOrder[actual] <= levelOrder[threshold];
}
