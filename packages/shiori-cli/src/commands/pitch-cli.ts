import { basename } from 'node:path';
import { define } from 'gunshi';
import { scan } from './scan.ts';
import { CommentProvider } from '../core/providers/CommentProvider.ts';
import { report } from './report.ts';
import { computeTrend } from './trend.ts';
import { triage } from './triage.ts';
import {
  pitch,
  formatPitchAsMarkdown,
  PITCH_FORMATS,
  type PitchFormat,
} from './pitch.ts';
import { assertNever } from '../core/types.ts';
import { wrapOutputJson } from '../core/schema-envelope.ts';
import { createFormatValidator } from '../core/cli-validation.ts';
import { loadSnapshots, DEFAULT_REPORTS_DIR } from '../core/snapshot.ts';
import { writeOutput } from '../core/cli-output.ts';
import {
  createBaseContext,
  withRegistry,
  resolveScanPatterns,
  resolveExpiringThreshold,
} from '../core/cli-context.ts';

export function formatPitch(
  result: import('../core/types.ts').PitchResult,
  format: PitchFormat,
): string {
  switch (format) {
    case 'markdown':
      return formatPitchAsMarkdown(result);
    case 'json':
      return wrapOutputJson(result, {
        command: 'pitch',
        schemaVersion: 1,
      });
    default:
      return assertNever(format);
  }
}

const validatePitchFormat = createFormatValidator<PitchFormat>(
  PITCH_FORMATS,
  'markdown',
);

export const pitchCommand = define({
  name: 'pitch',
  description: 'Generate a data-driven governance adoption pitch for your team',
  examples: `  # Generate a pitch report (Markdown)
  shiori pitch

  # JSON output for automation
  shiori pitch -f json

  # With team name
  shiori pitch --team "Frontend Team"

  # Include trend data from snapshots
  shiori pitch --trend

  # Save pitch to file
  shiori pitch -o pitch-report.md`,
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
    format: {
      type: 'string',
      short: 'f',
      description: 'Output format: "json", "markdown". Default: "markdown"',
      default: 'markdown',
    },
    output: {
      type: 'string',
      short: 'o',
      description: 'Output file path. If omitted, writes to stdout',
    },
    team: {
      type: 'string',
      short: 't',
      description:
        'Team or project name for the pitch headline. Default: directory name',
    },
    history: {
      type: 'string',
      short: 'H',
      description:
        'Directory containing ReportResult JSON files for trend analysis',
    },
    trend: {
      type: 'boolean',
      description:
        'Include score trend from auto-accumulated snapshots in .config/shiori/reports/',
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
        'Days before expiration to trigger expiring-soon warning. Default: 14',
    },
  },
  run: async (ctx) => {
    const format = validatePitchFormat(ctx.values.format);
    if (format === null) return;

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

    // Report
    const expiringThresholdDays = resolveExpiringThreshold(
      ctx.values.expiringThreshold,
      regCtx.config,
    );

    const reportResult = report({
      scanResult,
      registry: regCtx.registry,
      failOn: [],
      warnOn: [],
      duplicates: regCtx.duplicates,
      refPatterns: regCtx.config.refPatterns,
      refOrigins: regCtx.refOrigins,
      expiringThresholdDays,
    });

    // Trend (optional)
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

    // Triage (for priority distribution in pitch)
    // Inject reportResult.verifyResult to avoid duplicate verify() execution
    const triageResult = triage({
      scanResult,
      registry: regCtx.registry,
      failOn: [],
      warnOn: [],
      duplicates: regCtx.duplicates,
      refPatterns: regCtx.config.refPatterns,
      refOrigins: regCtx.refOrigins,
      expiringThresholdDays,
      verifyResult: reportResult.verifyResult,
    });

    // Team name: --team flag, or cwd basename
    const teamName = ctx.values.team || basename(base.cwd);

    // Compute pitch
    const result = pitch({
      reportResult,
      trendResult,
      triageResult,
      teamName,
    });

    // Output
    const output = formatPitch(result, format);

    const written = await writeOutput(output, {
      outputPath: ctx.values.output,
      cwd: base.cwd,
      label: 'Pitch report',
    });
    if (!written) return;

    // Summary on stderr
    console.error(
      `Pitch generated for "${teamName}" — score: ${result.health.score}/100 (${result.health.level}), ${result.highlights.length} highlight(s), ${result.nextSteps.length} next step(s)`,
    );
  },
});
