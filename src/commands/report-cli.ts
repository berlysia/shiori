import { define } from 'gunshi';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  loadConfigAndRegistry,
  reportRegistryIssues,
} from '../core/registry-loader.ts';
import { scan } from './scan.ts';
import { CommentProvider } from '../core/providers/CommentProvider.ts';
import { report, formatReport, type ReportFormat } from './report.ts';
import { parseAndValidateIssueTypes } from '../core/cli-validation.ts';
import {
  DEFAULT_SCAN_PATTERNS,
  DEFAULT_SCAN_IGNORE,
} from '../core/scan-defaults.ts';
import { assertWithinCwd, PathBoundaryError } from '../core/path-boundary.ts';

const VALID_REPORT_FORMATS: readonly string[] = ['json', 'markdown', 'badge'];

export const reportCommand = define({
  name: 'report',
  description: 'Generate a governance health report (scan + verify + insights)',
  examples: `  # Generate JSON report to stdout
  shiori report

  # Generate Markdown report to file
  shiori report -f markdown -o report.md

  # Generate shields.io badge JSON
  shiori report -f badge -o badge.json

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
        'Output format: "json", "markdown", "badge" (shields.io endpoint). Default: "json"',
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
  },
  run: async (ctx) => {
    // Validate options early
    const failOn = parseAndValidateIssueTypes(ctx.values.failOn, '--fail-on');
    if (failOn === null) return;
    const warnOn = parseAndValidateIssueTypes(ctx.values.warnOn, '--warn-on');
    if (warnOn === null) return;

    const formatValue = ctx.values.format ?? 'json';
    if (!VALID_REPORT_FORMATS.includes(formatValue)) {
      console.error(
        `Error: Invalid --format value "${formatValue}". Valid values: ${VALID_REPORT_FORMATS.join(', ')}`,
      );
      process.exitCode = 1;
      return;
    }
    // shiori: DEV-006 reason="validated by VALID_REPORT_FORMATS.includes() but type not narrowed by control flow"
    const format = formatValue as ReportFormat;

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

    // Generate report
    const expiringThresholdDays = ctx.values.expiringThreshold
      ? Number(ctx.values.expiringThreshold)
      : config.verify.expiringThresholdDays;

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

    const output = formatReport(result, format);

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
      console.error(`Report written to ${outputPath}`);
    } else {
      console.log(output);
    }

    // Report health to stderr for CI visibility
    console.error(
      `Health: ${result.health.level} (${result.health.score}/100)`,
    );

    if (result.verifyResult.summary.errors > 0) {
      process.exitCode = 1;
    }
  },
});
