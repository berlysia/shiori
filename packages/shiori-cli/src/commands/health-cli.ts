import { define } from 'gunshi';
import { scan } from './scan.ts';
import { CommentProvider } from '../core/providers/CommentProvider.ts';
import { report } from './report.ts';
import { computeTrend } from './trend.ts';
import {
  buildHealthResult,
  formatHealthSummary,
  HEALTH_FORMATS,
  type HealthFormat,
} from './health.ts';
import { formatHealthAsGitHubSummary } from '../formatters/github-summary-formatter.ts';
import { assertNever } from '../core/types.ts';
import { wrapOutputJson } from '../core/schema-envelope.ts';
import {
  triage,
  formatTriageOutput,
  TRIAGE_FORMATS,
  type TriageFormat,
} from './triage.ts';
import {
  parseAndValidateIssueTypes,
  createFormatValidator,
} from '../core/cli-validation.ts';
import {
  saveSnapshot,
  loadSnapshots,
  DEFAULT_REPORTS_DIR,
} from '../core/snapshot.ts';
import { writeOutput } from '../core/cli-output.ts';
import { isAtOrBelowLevel, type HealthLevel } from '../core/types.ts';
import {
  createBaseContext,
  withRegistry,
  saveRegistryRouted,
  resolveScanPatterns,
  resolveExpiringThreshold,
} from '../core/cli-context.ts';
import { initRegistry } from './registry-generator.ts';
import { recordJournalEvent } from '../core/journal.ts';
import { ExitCode } from '../core/exit-codes.ts';
import {
  planFix,
  formatFixPreview,
  formatFixResult,
  type HealthFixApplyResult,
} from './health-fix.ts';

export function formatHealth(
  result: import('../core/types.ts').HealthResult,
  format: HealthFormat,
): string {
  switch (format) {
    case 'summary':
      return formatHealthSummary(result);
    case 'github-summary':
      return formatHealthAsGitHubSummary(result);
    case 'json':
      return wrapOutputJson(result, {
        command: 'health',
        schemaVersion: 1,
      });
    default:
      return assertNever(format);
  }
}

const validateHealthFormat = createFormatValidator<HealthFormat>(
  HEALTH_FORMATS,
  'summary',
);

const validateTriageFormat =
  createFormatValidator<TriageFormat>(TRIAGE_FORMATS);

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

  # Health with score trend sparkline (auto-loads from .config/shiori/reports/)
  shiori health --trend

  # JSON output for CI integration
  shiori health -f json

  # Fail CI if health is critical
  shiori health --fail-on-level critical

  # Include trend from historical reports (explicit path)
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
      description:
        'Output format: "json", "summary", "github-summary". Default: "summary"',
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
    trend: {
      type: 'boolean',
      description:
        'Show score trend sparkline from auto-accumulated snapshots in .config/shiori/reports/. Overridden by --history if both are specified.',
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
    fix: {
      type: 'boolean',
      description:
        'Auto-fix the top-priority automatable prescription (dry-run by default)',
    },
    apply: {
      type: 'boolean',
      short: 'a',
      description:
        'With --fix, actually execute the action (default: dry-run preview)',
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

    // Validate --apply requires --fix
    if (ctx.values.apply && !ctx.values.fix) {
      console.error(
        'Error: --apply requires --fix. Use --fix --apply to execute fixes.',
      );
      process.exitCode = ExitCode.USAGE_ERROR;
      return;
    }

    // Validate --fail-on-level
    const failOnLevelValue = ctx.values.failOnLevel;
    if (failOnLevelValue !== undefined) {
      if (!VALID_FAIL_ON_LEVELS.includes(failOnLevelValue)) {
        console.error(
          `Error: Invalid --fail-on-level value "${failOnLevelValue}". Valid values: ${VALID_FAIL_ON_LEVELS.join(', ')}`,
        );
        process.exitCode = ExitCode.USAGE_ERROR;
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
        process.exitCode = ExitCode.ENVIRONMENT_ERROR;
        return;
      }
      console.error(`Snapshot saved to ${result.path}`);
    }

    // Load trend data: --history (explicit path) takes precedence over --trend (default path)
    let trendResult = undefined;
    const trendDir =
      ctx.values.history ??
      (ctx.values.trend ? DEFAULT_REPORTS_DIR : undefined);
    if (trendDir) {
      const reports = await loadSnapshots(trendDir, base.cwd, {
        onDirectoryError: ctx.values.history
          ? (msg) => console.error(`Warning: ${msg}`)
          : () => {
              /* --trend: silently skip when no history yet */
            },
        onNoFiles: ctx.values.history
          ? (dir) => console.error(`Warning: No JSON files found in ${dir}`)
          : undefined,
        onLoaded: (count, dir) =>
          console.error(`Loaded ${count} report(s) from ${dir}`),
        onSkipped: ctx.values.history
          ? (file, reason) =>
              console.error(`Warning: Skipped ${file}: ${reason}`)
          : undefined,
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
      // Validate --triage-format: explicit value is validated, undefined falls back to parent format
      let triageFormat: TriageFormat;
      if (ctx.values.triageFormat !== undefined) {
        const validated = validateTriageFormat(ctx.values.triageFormat);
        if (validated === null) return;
        triageFormat = validated;
      } else {
        triageFormat = format === 'json' ? 'json' : 'markdown';
      }

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

    // --fix: auto-fix the top-priority automatable prescription (EP-0112)
    if (ctx.values.fix) {
      const prescriptions = result.prescriptions ?? [];
      const preview = planFix(prescriptions);

      if (!preview) {
        console.error(
          'No automatable fix available. All prescriptions require manual action.',
        );
      } else if (!ctx.values.apply) {
        // Dry-run: show preview only
        console.error('');
        console.error(formatFixPreview(preview));
      } else {
        // Apply: execute the update logic
        const beforeScore = result.health.score;

        const updatedRegistry = initRegistry({
          records: scanResult.annotations,
          existingRegistry: regCtx.registry,
        });

        // Count new entries
        const newRefs = Object.keys(updatedRegistry).filter(
          (ref) => !(ref in regCtx.registry),
        );

        if (newRefs.length === 0) {
          console.error('Registry is already up to date (no new refs to add).');
        } else {
          // Save registry
          const saved = await saveRegistryRouted({
            registry: updatedRegistry,
            registryPath: regCtx.registryPath,
            cwd: base.cwd,
            refPatterns: regCtx.config.refPatterns,
            label: 'Fixed',
          });
          if (!saved) {
            // Structured error output for failed save
            const failResult: HealthFixApplyResult = {
              success: false,
              action: preview.target.actionType,
              description: 'Registry save failed (path boundary error)',
              beforeScore,
              afterScore: beforeScore,
              scoreDelta: 0,
            };
            console.error('');
            console.error(formatFixResult(failResult));
            return;
          }

          // Journal event
          recordJournalEvent({
            cwd: base.cwd,
            eventType: 'cli.update',
            refs: newRefs,
            success: true,
            entriesAdded: newRefs.length,
          });

          // Re-run health to get after score
          const afterReportResult = report({
            scanResult,
            registry: updatedRegistry,
            failOn,
            warnOn,
            duplicates: regCtx.duplicates,
            refPatterns: regCtx.config.refPatterns,
            refOrigins: regCtx.refOrigins,
            expiringThresholdDays,
          });
          const afterResult = buildHealthResult(afterReportResult, trendResult);
          const afterScore = afterResult.health.score;

          const fixResult: HealthFixApplyResult = {
            success: true,
            action: preview.target.actionType,
            description: `Added ${newRefs.length} ref(s) to registry`,
            beforeScore,
            afterScore,
            scoreDelta: afterScore - beforeScore,
          };

          console.error('');
          console.error(formatFixResult(fixResult));
        }
      }
    }

    // Exit code: --fail-on (errors > 0) OR --fail-on-level
    const hasIssueFailure = reportResult.verifyResult.summary.errors > 0;
    const hasLevelFailure = failOnLevel
      ? isAtOrBelowLevel(result.health.level, failOnLevel)
      : false;

    if (hasIssueFailure || hasLevelFailure) {
      process.exitCode = ExitCode.GOVERNANCE_VIOLATION;
    }
  },
});
