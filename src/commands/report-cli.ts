import { resolve } from 'node:path';
import { define } from 'gunshi';
import {
  loadConfigAndRegistry,
  reportRegistryIssues,
} from '../core/registry-loader.ts';
import { scan } from './scan.ts';
import { CommentProvider } from '../core/providers/CommentProvider.ts';
import { report } from './report.ts';
import type { ReportFormat } from '../core/types.ts';
import { formatReportOutput } from '../formatters/report-formatter.ts';
import {
  parseAndValidateIssueTypes,
  createFormatValidator,
} from '../core/cli-validation.ts';
import {
  DEFAULT_SCAN_PATTERNS,
  DEFAULT_SCAN_IGNORE,
} from '../core/scan-defaults.ts';
import { writeOutput } from '../core/cli-output.ts';
import { resolveExpiringThreshold } from '../core/cli-context.ts';
import { loadScanResultFromFile } from '../core/scan-result-loader.ts';
import { computeDelta } from './delta.ts';
import { enrichWithProvenance } from '../core/provenance.ts';
import { buildChronicle } from '../core/chronicle.ts';
import { collectUniqueRefs, resolveRefStatuses } from '../core/ref-status.ts';

const validateReportFormat = createFormatValidator<ReportFormat>([
  'json',
  'markdown',
  'badge',
  'html',
] as const);

export const reportCommand = define({
  name: 'report',
  description: 'Generate a governance health report (scan + verify + insights)',
  examples: `  # Generate JSON report to stdout
  shiori report

  # Generate Markdown report to file
  shiori report -f markdown -o report.md

  # Generate shields.io badge JSON
  shiori report -f badge -o badge.json

  # Generate self-contained HTML dashboard
  shiori report -f html -o report.html

  # Generate HTML dashboard with diff overlay from previous scan
  shiori report -f html --diff-base .tmp/prev-scan.json -o report.html

  # Generate HTML dashboard with git blame provenance
  shiori report -f html --provenance -o report.html

  # Generate HTML dashboard with annotation chronicle timeline
  shiori report -f html --timeline -o report.html

  # Chronicle with external ref status integration
  shiori report -f html --timeline --ref-status-command "scripts/check-status.sh" -o report.html

  # Include issue types in fail-on for exit code
  shiori report --fail-on expired,missing-in-registry`,
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
        'Issue types to fail on (comma-separated). Example: "missing-in-registry,expired"',
    },
    warnOn: {
      type: 'string',
      toKebab: true,
      description:
        'Issue types to warn on (comma-separated). Example: "unused-in-source"',
    },
    format: {
      type: 'string',
      short: 'f',
      description:
        'Output format: "json", "markdown", "badge" (shields.io endpoint), "html" (self-contained dashboard). Default: "json"',
      default: 'json',
    },
    output: {
      type: 'string',
      short: 'o',
      description: 'Output file path. If omitted, writes to stdout',
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
    diffBase: {
      type: 'string',
      toKebab: true,
      description:
        'Path to previous scan result JSON for diff overlay (used with --format html)',
    },
    provenance: {
      type: 'boolean',
      description:
        'Enrich annotations with git blame provenance (author, date, commit). Used with --format html',
      default: 'false',
    },
    timeline: {
      type: 'boolean',
      description:
        'Show annotation chronicle timeline (per-ref lifecycle events). Implies --provenance. Used with --format html',
      default: 'false',
    },
    refStatusCommand: {
      type: 'string',
      toKebab: true,
      description:
        'External command for ref status lookup (stdin: refs, stdout: JSONL). Used with --timeline. Note: command path must not contain spaces',
    },
  },
  run: async (ctx) => {
    // Validate options early
    const failOn = parseAndValidateIssueTypes(ctx.values.failOn, '--fail-on');
    if (failOn === null) return;
    const warnOn = parseAndValidateIssueTypes(ctx.values.warnOn, '--warn-on');
    if (warnOn === null) return;

    const format = validateReportFormat(ctx.values.format);
    if (format === null) return;

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
      : [...DEFAULT_SCAN_IGNORE, ...(config.scanIgnore ?? [])];

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

    // Generate report
    const expiringThresholdDays = resolveExpiringThreshold(
      ctx.values.expiringThreshold,
      config,
    );

    const result = report({
      scanResult,
      registry,
      failOn,
      warnOn,
      duplicates,
      refPatterns: config.refPatterns,
      refOrigins,
      expiringThresholdDays,
    });

    // --timeline implies --provenance
    const useTimeline = ctx.values.timeline === true;
    const useProvenance = ctx.values.provenance === true || useTimeline;
    let enrichedAnnotations = scanResult.annotations;
    if (useProvenance) {
      console.error('Enriching annotations with git blame provenance...');
      enrichedAnnotations = await enrichWithProvenance(
        scanResult.annotations,
        cwd,
      );
      const enrichedCount = enrichedAnnotations.filter(
        (a) => a.provenance,
      ).length;
      console.error(
        `Provenance: ${enrichedCount}/${enrichedAnnotations.length} annotation(s) enriched`,
      );
    }

    // Build annotation chronicle when --timeline is set
    let chronicle;
    if (useTimeline) {
      console.error('Building annotation chronicle...');
      // Resolve external ref statuses if --ref-status-command is provided
      let refStatuses;
      const refStatusCommand = ctx.values.refStatusCommand;
      if (refStatusCommand) {
        try {
          const uniqueRefs = collectUniqueRefs(enrichedAnnotations);
          console.error(
            `Resolving ref statuses for ${uniqueRefs.length} ref(s)...`,
          );
          refStatuses = await resolveRefStatuses(refStatusCommand, uniqueRefs);
          console.error(`Ref status: ${refStatuses.size} status(es) resolved`);
        } catch (error) {
          console.error(
            `Warning: ref-status-command failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          // Graceful degradation: continue without ref statuses
        }
      }

      chronicle = buildChronicle({
        annotations: enrichedAnnotations,
        registry,
        refStatuses,
      });
      console.error(
        `Chronicle: ${chronicle.summary.totalRefs} ref(s), ${chronicle.summary.withProvenance} with provenance`,
      );
    }

    // Compute governance diff overlay when --diff-base is provided
    const diffBasePath = ctx.values.diffBase;
    const delta = diffBasePath
      ? computeDelta({
          base: await loadScanResultFromFile(resolve(cwd, diffBasePath)),
          head: scanResult,
        })
      : undefined;

    const output = formatReportOutput(result, format, {
      delta,
      annotations: useProvenance ? enrichedAnnotations : undefined,
      chronicle,
    });

    const written = await writeOutput(output, {
      outputPath: ctx.values.output,
      cwd,
      label: 'Report',
    });
    if (!written) return;

    // Report health to stderr for CI visibility
    console.error(
      `Health: ${result.health.level} (${result.health.score}/100)`,
    );

    if (result.verifyResult.summary.errors > 0) {
      process.exitCode = 1;
    }
  },
});
