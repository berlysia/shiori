import { define } from 'gunshi';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import {
  loadConfigAndRegistry,
  reportRegistryIssues,
} from '../core/registry-loader.ts';
import { scan } from './scan.ts';
import { CommentProvider } from '../core/providers/CommentProvider.ts';
import { report } from './report.ts';
import { computeTrend } from './trend.ts';
import {
  health,
  buildHealthResult,
  formatHealth,
  formatHealthSummary,
  type HealthFormat,
} from './health.ts';
import { parseAndValidateIssueTypes } from '../core/cli-validation.ts';
import {
  DEFAULT_SCAN_PATTERNS,
  DEFAULT_SCAN_IGNORE,
} from '../core/scan-defaults.ts';
import { assertWithinCwd, PathBoundaryError } from '../core/path-boundary.ts';
import type { HealthLevel, ReportResult } from '../core/types.ts';

const VALID_HEALTH_FORMATS: readonly string[] = ['json', 'summary'];

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
  shiori health --fail-on expired --fail-on-level critical`,
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
  },
  run: async (ctx) => {
    // Validate options early
    const failOn = parseAndValidateIssueTypes(ctx.values.failOn, '--fail-on');
    if (failOn === null) return;
    const warnOn = parseAndValidateIssueTypes(ctx.values.warnOn, '--warn-on');
    if (warnOn === null) return;

    const formatValue = ctx.values.format ?? 'summary';
    if (!VALID_HEALTH_FORMATS.includes(formatValue)) {
      console.error(
        `Error: Invalid --format value "${formatValue}". Valid values: ${VALID_HEALTH_FORMATS.join(', ')}`,
      );
      process.exitCode = 1;
      return;
    }
    // shiori: DEV-013 reason="validated by VALID_HEALTH_FORMATS.includes() but type not narrowed by control flow"
    const format = formatValue as HealthFormat;

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

    const cwd = ctx.values.cwd ?? process.cwd();

    const configAndRegistry = await loadConfigAndRegistry({
      cwd,
      configDir: ctx.values.config,
      registryPath: ctx.values.registry,
    });
    reportRegistryIssues(configAndRegistry);
    const { config, registry, duplicates, refOrigins } = configAndRegistry;

    const patterns = ctx.values.patterns
      ? ctx.values.patterns.split(',').map((s: string) => s.trim())
      : (config.scanPatterns ?? DEFAULT_SCAN_PATTERNS);

    const ignore = ctx.values.ignore
      ? ctx.values.ignore.split(',').map((s: string) => s.trim())
      : (config.scanIgnore ?? DEFAULT_SCAN_IGNORE);

    // Scan
    const provider = new CommentProvider();
    const scanResult = await scan({
      patterns,
      ignore,
      provider,
      cwd,
      providerOptions: { candidatePatterns: config.candidatePatterns },
    });

    console.error(
      `Scanned ${scanResult.filesScanned} files, found ${scanResult.annotations.length} annotation(s), ${scanResult.candidates.length} candidate(s)`,
    );

    // Generate report (health composes this)
    const expiringThresholdDays = ctx.values.expiringThreshold
      ? Number(ctx.values.expiringThreshold)
      : config.verify.expiringThresholdDays;

    const reportResult = report({
      scanResult,
      registry,
      failOn,
      warnOn,
      duplicates,
      refPatterns: config.refPatterns,
      refOrigins,
      expiringThresholdDays,
    });

    // Save snapshot if requested
    if (ctx.values.snapshot) {
      const snapshotDir = resolve(cwd, ctx.values.snapshot);
      const snapshotFile = join(
        snapshotDir,
        `${reportResult.timestamp.replace(/[:.]/g, '-')}.json`,
      );
      try {
        await assertWithinCwd(snapshotFile, cwd);
      } catch (err) {
        if (err instanceof PathBoundaryError) {
          console.error(`Error: ${err.message}`);
          process.exitCode = 1;
          return;
        }
        throw err;
      }
      await mkdir(snapshotDir, { recursive: true });
      await writeFile(
        snapshotFile,
        JSON.stringify(reportResult, null, 2) + '\n',
        'utf-8',
      );
      console.error(`Snapshot saved to ${snapshotFile}`);
    }

    // Load trend data if --history is provided
    let trendResult = undefined;
    if (ctx.values.history) {
      const historyDir = resolve(cwd, ctx.values.history);
      const reports = await loadReportFiles(historyDir);
      if (reports !== null) {
        trendResult = computeTrend(reports);
      }
    }

    // Build health result
    const result = buildHealthResult(reportResult, trendResult);

    // Output
    const output = formatHealth(result, format);

    if (ctx.values.output) {
      const outputPath = resolve(cwd, ctx.values.output);
      try {
        await assertWithinCwd(outputPath, cwd);
      } catch (err) {
        if (err instanceof PathBoundaryError) {
          console.error(`Error: ${err.message}`);
          process.exitCode = 1;
          return;
        }
        throw err;
      }
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, output + '\n', 'utf-8');
      console.error(`Health report written to ${outputPath}`);
    } else {
      console.log(output);
    }

    // Always show summary box on stderr (for CI visibility)
    if (format !== 'summary') {
      console.error(formatHealthSummary(result));
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
function isAtOrBelowLevel(
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

/**
 * Load ReportResult JSON files from a directory.
 * Returns null if directory cannot be read or no valid files found.
 */
async function loadReportFiles(dir: string): Promise<ReportResult[] | null> {
  let files: string[];
  try {
    const entries = await readdir(dir);
    files = entries.filter((f) => f.endsWith('.json'));
  } catch (err) {
    console.error(
      `Warning: Cannot read history directory: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }

  if (files.length === 0) {
    console.error(`Warning: No JSON files found in ${dir}`);
    return null;
  }

  const reports: ReportResult[] = [];
  for (const file of files) {
    const filePath = join(dir, file);
    try {
      const content = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content) as Record<string, unknown>;

      if (
        typeof parsed.timestamp === 'string' &&
        parsed.health &&
        typeof (parsed.health as Record<string, unknown>).score === 'number'
      ) {
        // shiori: DEV-014 reason="runtime JSON shape validated above but static type requires assertion"
        reports.push(parsed as unknown as ReportResult);
      }
    } catch {
      // Skip invalid files silently
    }
  }

  if (reports.length === 0) {
    return null;
  }

  console.error(`Loaded ${reports.length} report(s) from ${dir}`);
  return reports;
}
