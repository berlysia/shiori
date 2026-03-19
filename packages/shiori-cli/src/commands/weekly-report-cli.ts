import { define } from 'gunshi';
import {
  loadConfigAndRegistry,
  reportRegistryIssues,
} from '../core/registry-loader.ts';
import { scan } from './scan.ts';
import { report } from './report.ts';
import { CommentProvider } from '../core/providers/CommentProvider.ts';
import { readJournalEntries, resolveJournalPath } from '../core/journal.ts';
import { computeJournalVelocity } from './journal-velocity.ts';
import {
  collectReportData,
  analyzeReportData,
  formatWeeklyReport,
} from '../core/report-generator.ts';
import type { WeeklyReportPreset, WeeklyReportFormat } from '../core/types.ts';
import { createFormatValidator } from '../core/cli-validation.ts';
import { writeOutput } from '../core/cli-output.ts';
import { resolveExpiringThreshold } from '../core/cli-context.ts';
import {
  DEFAULT_SCAN_PATTERNS,
  DEFAULT_SCAN_IGNORE,
} from '../core/scan-defaults.ts';

const VALID_PRESETS: readonly WeeklyReportPreset[] = [
  'weekly',
  'health',
  'custom',
] as const;

const validateFormat = createFormatValidator<WeeklyReportFormat>([
  'markdown',
  'html',
  'json',
] as const);

export const weeklyReportCommand = define({
  name: 'weekly-report',
  description:
    'Generate a periodic governance report (weekly/health/custom preset)',
  examples: `  # Generate weekly Markdown report to stdout
  shiori weekly-report

  # Generate weekly HTML report to file
  shiori weekly-report --format html -o weekly.html

  # Health snapshot in JSON
  shiori weekly-report --preset health --format json

  # Custom date range report
  shiori weekly-report --preset custom --since 2026-01-01 --until 2026-03-01 -o q1.md

  # Weekly report as JSON for automation
  shiori weekly-report --format json | jq '.activity'`,
  rendering: { header: null },
  args: {
    preset: {
      type: 'string',
      description:
        'Report preset: "weekly" (past 7 days), "health" (current snapshot), "custom" (explicit range). Default: "weekly"',
      default: 'weekly',
    },
    format: {
      type: 'string',
      short: 'f',
      description:
        'Output format: "markdown", "html", "json". Default: "markdown"',
      default: 'markdown',
    },
    output: {
      type: 'string',
      short: 'o',
      description: 'Output file path. If omitted, writes to stdout',
    },
    since: {
      type: 'string',
      description:
        'Start date (YYYY-MM-DD, inclusive). Default depends on preset',
    },
    until: {
      type: 'string',
      description: 'End date (YYYY-MM-DD, inclusive). Default: today',
    },
    cwd: {
      type: 'string',
      description: 'Working directory. Default: process.cwd()',
    },
    config: {
      type: 'string',
      short: 'c',
      description: 'Path to config directory. Default: <cwd>/.config/shiori',
    },
    registry: {
      type: 'string',
      short: 'r',
      description: 'Path to registry file (auto-detected from config)',
    },
    expiringThreshold: {
      type: 'string',
      toKebab: true,
      description:
        'Days before expiration to trigger expiring-soon warning. Default: 14',
    },
  },
  run: async (ctx) => {
    // Validate preset
    const preset = ctx.values.preset as string;
    if (!VALID_PRESETS.includes(preset as WeeklyReportPreset)) {
      console.error(
        `Error: Invalid --preset value "${preset}". Valid values: ${VALID_PRESETS.join(', ')}`,
      );
      process.exitCode = 1;
      return;
    }
    const validatedPreset = preset as WeeklyReportPreset;

    // Validate format
    const format = validateFormat(ctx.values.format);
    if (format === null) return;

    const cwd = ctx.values.cwd ?? process.cwd();

    // Load config and registry
    const configAndRegistry = await loadConfigAndRegistry({
      cwd,
      configDir: ctx.values.config,
      registryPath: ctx.values.registry,
    });
    reportRegistryIssues(configAndRegistry);
    const { config, registry } = configAndRegistry;

    // Scan source files for current governance state
    const patterns = config.scanPatterns ?? DEFAULT_SCAN_PATTERNS;
    const ignore = [...DEFAULT_SCAN_IGNORE, ...(config.scanIgnore ?? [])];

    const provider = new CommentProvider();
    const scanResult = await scan({
      patterns,
      ignore,
      provider,
      cwd,
      providerOptions: { candidatePatterns: config.candidatePatterns },
    });

    console.error(
      `Scanned ${scanResult.filesScanned} files, found ${scanResult.annotations.length} annotation(s)`,
    );

    // Generate governance report
    const expiringThresholdDays = resolveExpiringThreshold(
      ctx.values.expiringThreshold,
      config,
    );

    const reportResult = report({
      scanResult,
      registry,
      failOn: [],
      warnOn: [],
      duplicates: configAndRegistry.duplicates,
      refPatterns: config.refPatterns,
      refOrigins: configAndRegistry.refOrigins,
      expiringThresholdDays,
    });

    // Load journal entries
    const journalPath = resolveJournalPath(cwd);
    const journalEntries = journalPath
      ? readJournalEntries(journalPath, {
          onReadError: (msg) => console.error(`Warning: ${msg}`),
          onSkipped: (count) =>
            console.error(
              `Warning: ${count} malformed journal entry(ies) skipped`,
            ),
        })
      : [];

    // Compute velocity
    const velocity = computeJournalVelocity(journalEntries);

    // Pipeline: collect → analyze → format
    const collected = collectReportData({
      journalEntries,
      registry,
      reportResult,
      velocity,
      preset: validatedPreset,
      since: ctx.values.since,
      until: ctx.values.until,
    });

    const metrics = analyzeReportData(collected);
    const output = formatWeeklyReport(metrics, format, validatedPreset);

    const written = await writeOutput(output, {
      outputPath: ctx.values.output,
      cwd,
      label: `${validatedPreset.charAt(0).toUpperCase() + validatedPreset.slice(1)} report`,
    });
    if (!written) return;

    // Report health to stderr for CI visibility
    console.error(
      `Health: ${metrics.health.level} (${metrics.health.score}/100)`,
    );
  },
});
