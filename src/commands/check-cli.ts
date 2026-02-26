import { define } from 'gunshi';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  loadConfigAndRegistry,
  reportRegistryIssues,
} from '../core/registry-loader.ts';
import { scan } from './scan.ts';
import { CommentProvider } from '../core/providers/CommentProvider.ts';
import { check } from './check.ts';
import { formatActionHints } from './verify.ts';
import { formatVerifyOutput } from '../formatters/index.ts';
import {
  parseAndValidateIssueTypes,
  validateOutputFormat,
} from '../core/cli-validation.ts';
import {
  DEFAULT_SCAN_PATTERNS,
  DEFAULT_SCAN_IGNORE,
} from '../core/scan-defaults.ts';

export const checkCommand = define({
  name: 'check',
  description: 'Scan and verify in one step (no intermediate files)',
  examples: `  # One-shot scan + verify
  shiori check

  # Fail on specific issue types
  shiori check --fail-on missing-in-registry,expired

  # Save scan result while checking
  shiori check --save-scan

  # Markdown output
  shiori check -f markdown -o report.md`,
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
        'Output format: "json", "markdown", "sarif", "summary", "jsonl". Default: "json"',
      default: 'json',
    },
    output: {
      type: 'string',
      short: 'o',
      description: 'Output file path. If omitted, writes to stdout',
    },
    saveScan: {
      type: 'boolean',
      toKebab: true,
      description:
        'Also save scan result to .config/shiori/scan-result.json (or config path)',
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
  },
  run: async (ctx) => {
    // Validate options early
    const failOn = parseAndValidateIssueTypes(ctx.values.failOn, '--fail-on');
    if (failOn === null) return;
    const warnOn = parseAndValidateIssueTypes(ctx.values.warnOn, '--warn-on');
    if (warnOn === null) return;
    const format = validateOutputFormat(ctx.values.format);
    if (format === null) return;

    const cwd = ctx.values.cwd ?? process.cwd();

    const configAndRegistry = await loadConfigAndRegistry({
      cwd,
      configDir: ctx.values.config,
      registryPath: ctx.values.registry,
    });
    reportRegistryIssues(configAndRegistry);
    const { config, registry } = configAndRegistry;

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

    // Optionally save scan result
    if (ctx.values.saveScan) {
      const scanOutputPath = join(cwd, config.paths.scanResult);
      await mkdir(dirname(scanOutputPath), { recursive: true });
      await writeFile(
        scanOutputPath,
        JSON.stringify(scanResult, null, 2) + '\n',
        'utf-8',
      );
      console.error(`Scan result saved to ${config.paths.scanResult}`);
    }

    // Verify
    const { verifyResult } = check({
      scanResult,
      registry,
      failOn,
      warnOn,
    });

    const output = formatVerifyOutput({
      format,
      verifyResult,
      annotations: scanResult.annotations,
      candidates: scanResult.candidates,
      registry,
    });

    if (ctx.values.output) {
      await writeFile(ctx.values.output, output + '\n', 'utf-8');
      console.error(`Report written to ${ctx.values.output}`);
    } else {
      console.log(output);
    }

    for (const hint of formatActionHints(verifyResult)) {
      console.error(hint);
    }

    if (verifyResult.summary.errors > 0) {
      process.exitCode = 1;
    }
  },
});
