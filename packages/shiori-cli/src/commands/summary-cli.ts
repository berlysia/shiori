import { define } from 'gunshi';
import { resolve } from 'node:path';
import { scan } from './scan.ts';
import { CommentProvider } from '../core/providers/CommentProvider.ts';
import {
  summary,
  formatSummary,
  SUMMARY_FORMATS,
  type SummaryFormat,
} from './summary.ts';
import {
  parseAndValidateIssueTypes,
  createFormatValidator,
} from '../core/cli-validation.ts';
import { writeOutput } from '../core/cli-output.ts';
import { saveSnapshot, loadSnapshots } from '../core/snapshot.ts';
import {
  loadScanResultFromFile,
  loadScanResult,
} from '../core/scan-result-loader.ts';
import {
  isAtOrBelowLevel,
  type HealthLevel,
  type ScanResult,
} from '../core/types.ts';
import { assertWithinCwd, PathBoundaryError } from '../core/path-boundary.ts';
import { ScanResultNotFoundError } from '../core/errors.ts';
import {
  createBaseContext,
  withRegistry,
  resolveScanPatterns,
  resolveExpiringThreshold,
} from '../core/cli-context.ts';
import { ExitCode } from '../core/exit-codes.ts';

const validateSummaryFormat = createFormatValidator<SummaryFormat>(
  SUMMARY_FORMATS,
  'json',
);

const VALID_FAIL_ON_LEVELS: readonly string[] = [
  'critical',
  'warning',
  'healthy',
];

export const summaryCommand = define({
  name: 'summary',
  description:
    'Aggregated governance summary combining health, delta, trend, and triage (for PR comments and dashboards)',
  examples: `  # Generate governance summary as JSON (default)
  shiori summary

  # Compact TTY dashboard (pulse format)
  shiori summary --format pulse

  # Markdown output for PR comments
  shiori summary --format markdown

  # Slack Block Kit JSON (for webhook integration)
  shiori summary --format slack
  shiori summary --format slack | curl -X POST -H 'Content-Type: application/json' -d @- "$SLACK_WEBHOOK_URL"

  # Use pre-computed scan result (avoids re-scanning in CI)
  shiori summary --scan head-scan.json

  # Include delta (compare against base scan result)
  shiori summary --base base-scan.json

  # Include trend from historical snapshots
  shiori summary --history ./reports/

  # Full summary with delta + trend + snapshot
  shiori summary --scan head-scan.json --base base-scan.json --history ./reports/ --snapshot ./reports/

  # Tag with repository name for multi-repo aggregation
  shiori summary --repository my-org/my-repo

  # CI gate: fail if health is critical
  shiori summary --fail-on-level critical

  # Treat missing base file as empty (initial PR)
  shiori summary --base base-scan.json --base-fallback-empty`,
  rendering: { header: null },
  args: {
    scan: {
      type: 'string',
      description:
        'Path to pre-computed scan result JSON. When provided, skips live scanning. Use "-" for stdin.',
    },
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
        'Fail (exit code 1) if health level is at or below this threshold: "critical", "warning", "healthy"',
    },
    format: {
      type: 'string',
      short: 'f',
      description:
        'Output format: "json", "markdown", "pulse" (compact TTY dashboard), "slack" (Block Kit JSON). Default: "json"',
      default: 'json',
    },
    output: {
      type: 'string',
      short: 'o',
      description: 'Output file path. If omitted, writes to stdout',
    },
    base: {
      type: 'string',
      short: 'b',
      description:
        'Path to base scan result JSON for delta computation. If omitted, delta is skipped.',
    },
    baseFallbackEmpty: {
      type: 'boolean',
      toKebab: true,
      description:
        'If the base file does not exist, treat it as an empty scan result instead of failing.',
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
    repository: {
      type: 'string',
      description:
        'Repository identifier for multi-repo aggregation (e.g. "my-org/my-repo")',
    },
    skipTriage: {
      type: 'boolean',
      toKebab: true,
      description: 'Skip triage computation even when issues exist',
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
  },
  run: async (ctx) => {
    // Validate options early
    const failOn = parseAndValidateIssueTypes(ctx.values.failOn, '--fail-on');
    if (failOn === null) return;
    const warnOn = parseAndValidateIssueTypes(ctx.values.warnOn, '--warn-on');
    if (warnOn === null) return;

    let format = validateSummaryFormat(ctx.values.format);
    if (format === null) return;

    // Pulse format requires TTY output — fall back to json when piped
    if (format === 'pulse' && !ctx.values.output && !process.stdout.isTTY) {
      console.error(
        'Warning: pulse format requires TTY output. Falling back to "json".',
      );
      format = 'json';
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

    // Scan (head): use pre-computed scan result if --scan is provided, otherwise live scan
    let scanResult: ScanResult;
    if (ctx.values.scan !== undefined) {
      try {
        scanResult = await loadScanResult({
          explicitPath: ctx.values.scan,
          config: regCtx.config,
          cwd: base.cwd,
        });
        console.error(
          `Loaded scan result: ${scanResult.annotations.length} annotation(s), ${scanResult.candidates.length} candidate(s)`,
        );
      } catch (err) {
        console.error(
          `Error loading scan result: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = ExitCode.ENVIRONMENT_ERROR;
        return;
      }
    } else {
      const provider = new CommentProvider();
      scanResult = await scan({
        patterns,
        ignore,
        provider,
        cwd: base.cwd,
        providerOptions: { candidatePatterns: regCtx.config.candidatePatterns },
      });
      console.error(
        `Scanned ${scanResult.filesScanned} files, found ${scanResult.annotations.length} annotation(s), ${scanResult.candidates.length} candidate(s)`,
      );
    }

    const expiringThresholdDays = resolveExpiringThreshold(
      ctx.values.expiringThreshold,
      regCtx.config,
    );

    // Load base scan for delta (optional)
    let baseScanResult: ScanResult | undefined;
    if (ctx.values.base) {
      const basePath = resolve(base.cwd, ctx.values.base);
      try {
        await assertWithinCwd(basePath, base.cwd);
      } catch (err) {
        if (err instanceof PathBoundaryError) {
          console.error(`Error: ${err.message}`);
          process.exitCode = ExitCode.ENVIRONMENT_ERROR;
          return;
        }
        throw err;
      }

      const emptyScanResult: ScanResult = {
        annotations: [],
        candidates: [],
        filesScanned: 0,
      };

      try {
        baseScanResult = await loadScanResultFromFile(basePath);
      } catch (err) {
        if (
          ctx.values.baseFallbackEmpty &&
          err instanceof ScanResultNotFoundError
        ) {
          baseScanResult = emptyScanResult;
          console.error(
            `Base file not found: ${basePath} — using empty scan result as fallback`,
          );
        } else {
          console.error(
            `Error loading base scan result: ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exitCode = ExitCode.ENVIRONMENT_ERROR;
          return;
        }
      }
    }

    // Load trend snapshots (optional)
    let trendReports = undefined;
    if (ctx.values.history) {
      const reports = await loadSnapshots(ctx.values.history, base.cwd, {
        onDirectoryError: (msg) => console.error(`Warning: ${msg}`),
        onNoFiles: (dir) =>
          console.error(`Warning: No JSON files found in ${dir}`),
        onLoaded: (count, dir) =>
          console.error(`Loaded ${count} report(s) from ${dir}`),
        onSkipped: (file, reason) =>
          console.error(`Warning: Skipped ${file}: ${reason}`),
      });
      if (reports !== null) {
        trendReports = reports;
      }
    }

    // Build summary
    const result = summary({
      scanResult,
      registry: regCtx.registry,
      failOn,
      warnOn,
      duplicates: regCtx.duplicates,
      refPatterns: regCtx.config.refPatterns,
      refOrigins: regCtx.refOrigins,
      expiringThresholdDays,
      baseScanResult,
      trendReports,
      repository: ctx.values.repository,
      skipTriage: ctx.values.skipTriage,
    });

    // Save snapshot if requested (reuse reportResult from summary to avoid timestamp drift)
    if (ctx.values.snapshot) {
      const snapshotResult = await saveSnapshot(
        result._reportResult,
        ctx.values.snapshot,
        base.cwd,
      );
      if (!snapshotResult.ok) {
        console.error(`Error: ${snapshotResult.error}`);
        process.exitCode = ExitCode.ENVIRONMENT_ERROR;
        return;
      }
      console.error(`Snapshot saved to ${snapshotResult.path}`);
    }

    // Output
    const output = formatSummary(result, format);

    const written = await writeOutput(output, {
      outputPath: ctx.values.output,
      cwd: base.cwd,
      label: 'Governance summary',
    });
    if (!written) return;

    // Log summary to stderr for CI visibility (skip for pulse — already visual)
    if (format !== 'pulse') {
      const emoji =
        result.health.health.level === 'healthy'
          ? '🟢'
          : result.health.health.level === 'warning'
            ? '🟡'
            : '🔴';
      console.error(
        `${emoji} Health: ${result.health.health.score}/100 (${result.health.health.level})` +
          (result.delta
            ? ` | Delta: +${result.delta.summary.added}/-${result.delta.summary.removed}`
            : '') +
          (result.trend ? ` | Trend: ${result.trend.summary.direction}` : '') +
          (result.triage
            ? ` | Triage: ${result.triage.summary.total} items`
            : ''),
      );
    }

    // Exit code: --fail-on (errors > 0) OR --fail-on-level
    const hasIssueFailure = result.health.issues.errors > 0;
    const hasLevelFailure = failOnLevel
      ? isAtOrBelowLevel(result.health.health.level, failOnLevel)
      : false;

    if (hasIssueFailure || hasLevelFailure) {
      process.exitCode = ExitCode.GOVERNANCE_VIOLATION;
    }
  },
});
